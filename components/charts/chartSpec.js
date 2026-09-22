/**
 * chartSpec — the pin/unpin store for Cockpit charts, backed by the API + DB
 * (meerkats.pinned_charts), scoped to the current WORKSPACE (shared by everyone
 * with access to it, incl. clients the workspace is shared with).
 *
 * A spec is a serialisable, workspace-AGNOSTIC ChartSpec (query shape + chart
 * type + formatting) — see SpecChart.jsx. It re-runs against whatever workspace
 * the viewer is in, so the same pinned chart renders in the Cockpit against the
 * live workspace.
 *
 * Persistence moved from localStorage → server, and pins are WORKSPACE-WIDE (not
 * per-user). To keep the render path simple, we hold an in-memory cache of the
 * pinned specs (loaded once per workspace via loadPins) so isPinned()/
 * getPinnedSpecs() stay SYNCHRONOUS for the button + strip. Mutations are
 * OPTIMISTIC: update the cache + fire PINS_CHANGED_EVENT immediately, then
 * reconcile with the API (revert on failure). Any change fires PINS_CHANGED_EVENT
 * so the Explore gallery and the Cockpit strip stay in sync.
 */

import pinnedChartsApi from '@/lib/pinnedCharts'

export const PINS_CHANGED_EVENT = 'cockpit:pins-changed'

// In-memory cache of the current user+workspace pins. Map<spec_id, spec>.
let cache = new Map()
// Ids of DEFAULT cockpit charts this user has hidden (Set<spec_id>).
let hiddenSet = new Set()
let loaded = false
let loadPromise = null
// The workspace the cache was loaded for — a workspace switch invalidates it.
let loadedWorkspace = null

const currentWs = () => {
    try { return localStorage.getItem('currentWorkspaceId') || '' } catch { return '' }
}

function emit() {
    try {
        window.dispatchEvent(new CustomEvent(PINS_CHANGED_EVENT, { detail: { specs: getPinnedSpecs() } }))
    } catch { /* SSR / no window */ }
}

/** All pinned specs (array) from the in-memory cache. Synchronous. */
export function getPinnedSpecs() {
    return Array.from(cache.values())
}

export function isPinned(id) {
    return cache.has(id)
}

/**
 * Load pins from the server into the cache (once per workspace). Returns the
 * specs. Safe to call repeatedly — de-dupes in-flight loads and re-fetches when
 * the workspace changed. Components call this on mount.
 */
export async function loadPins({ force = false } = {}) {
    const ws = currentWs()
    if (!force && loaded && loadedWorkspace === ws) return getPinnedSpecs()
    if (loadPromise && loadedWorkspace === ws && !force) return loadPromise
    loadedWorkspace = ws
    loadPromise = (async () => {
        try {
            const res = await pinnedChartsApi.list()
            const specs = res.data?.data || []
            cache = new Map(specs.filter((s) => s && s.id).map((s) => [s.id, s]))
            hiddenSet = new Set(res.data?.hidden || [])
            loaded = true
            emit()
            return getPinnedSpecs()
        } catch {
            // On failure keep whatever we had; don't wipe the UI.
            loaded = true
            return getPinnedSpecs()
        } finally {
            loadPromise = null
        }
    })()
    return loadPromise
}

/** Pin a spec (optimistic). Returns true. */
export function pinSpec(spec) {
    if (!spec?.id || cache.has(spec.id)) return true
    cache.set(spec.id, spec)
    emit()
    pinnedChartsApi.pin(spec).catch(() => {
        // rollback on failure
        cache.delete(spec.id)
        emit()
    })
    return true
}

/** Unpin a spec by id (optimistic). Returns false. */
export function unpinSpec(id) {
    const prev = cache.get(id)
    if (!prev) return false
    cache.delete(id)
    emit()
    pinnedChartsApi.unpin(id).catch(() => {
        // rollback on failure
        cache.set(id, prev)
        emit()
    })
    return false
}

/** Toggle pin state for a spec. Returns the resulting boolean (pinned?). */
export function togglePin(spec) {
    if (cache.has(spec.id)) { unpinSpec(spec.id); return false }
    pinSpec(spec); return true
}

// ── Hidden DEFAULT cockpit charts ────────────────────────────────────────────
// A persona's built-in charts render by default; a user can hide the ones they
// don't want. Hidden ids persist server-side (kind='hidden' in pinned_charts).

/** Is this default chart id hidden for the current user? Synchronous. */
export function isHidden(id) {
    return hiddenSet.has(id)
}

/** All hidden default chart ids (array). */
export function getHiddenIds() {
    return Array.from(hiddenSet)
}

/** Hide a default cockpit chart (optimistic). */
export function hideDefault(id) {
    if (!id || hiddenSet.has(id)) return
    hiddenSet.add(id)
    emit()
    pinnedChartsApi.hideDefault(id).catch(() => { hiddenSet.delete(id); emit() })
}

/** Restore a hidden default cockpit chart (optimistic). */
export function unhideDefault(id) {
    if (!hiddenSet.has(id)) return
    hiddenSet.delete(id)
    emit()
    pinnedChartsApi.unhideDefault(id).catch(() => { hiddenSet.add(id); emit() })
}
