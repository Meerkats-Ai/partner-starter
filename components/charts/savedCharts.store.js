/**
 * savedCharts.store — client cache + mutations for the chat-generated chart library
 * (meerkats.saved_charts, shared workspace-wide). Mirrors chartSpec.js in shape but
 * carries the FULL library (pinned + unpinned), because the artifact is durable now:
 * unpin flips is_pinned (chart stays), so we never drop it from the cache.
 *
 * Surfaces:
 *   • Chat "Pin to Cockpit"      → saveChart(spec)          (save + is_pinned:true)
 *   • Cockpit strip              → getPinnedSaved()         (is_pinned === true)
 *   • Explore "Chat charts" tab  → getSavedCharts()         (all)
 *   • un/re-pin from either      → setSavedPinned(id, bool)
 *   • delete from the library    → removeSavedChart(id)
 *
 * Every mutation is OPTIMISTIC (update cache + emit, reconcile with the API, revert
 * on failure) and fires SAVED_CHARTS_CHANGED_EVENT so all three surfaces re-render.
 * A workspace switch invalidates the cache (mirrors chartSpec.js).
 */

import savedChartsApi from '@/lib/savedCharts'

export const SAVED_CHARTS_CHANGED_EVENT = 'cockpit:saved-charts-changed'

// In-memory cache of the workspace's saved charts. Map<spec_id, savedChart>.
let cache = new Map()
let loaded = false
let loadPromise = null
let loadedWorkspace = null

const currentWs = () => {
    try { return localStorage.getItem('currentWorkspaceId') || '' } catch { return '' }
}

function emit() {
    try {
        window.dispatchEvent(new CustomEvent(SAVED_CHARTS_CHANGED_EVENT, { detail: { specs: getSavedCharts() } }))
    } catch { /* SSR / no window */ }
}

/** All saved charts (array), pinned first. Synchronous (from cache). */
export function getSavedCharts() {
    return Array.from(cache.values()).sort((a, b) => (Number(b.is_pinned) - Number(a.is_pinned)))
}

/** Only the pinned saved charts — for the Cockpit strip. Synchronous. */
export function getPinnedSaved() {
    return getSavedCharts().filter((s) => s.is_pinned)
}

/** Is this saved chart currently pinned? Synchronous. */
export function isSavedPinned(id) {
    return !!cache.get(id)?.is_pinned
}

/** Does the library already hold this spec id? Synchronous. */
export function isSaved(id) {
    return cache.has(id)
}

/**
 * Load the workspace's saved charts into the cache (once per workspace). Returns the
 * specs. De-dupes in-flight loads + re-fetches on workspace switch. Components call
 * this on mount.
 */
export async function loadSavedCharts({ force = false } = {}) {
    const ws = currentWs()
    if (!force && loaded && loadedWorkspace === ws) return getSavedCharts()
    if (loadPromise && loadedWorkspace === ws && !force) return loadPromise
    loadedWorkspace = ws
    loadPromise = (async () => {
        try {
            const res = await savedChartsApi.list()
            const specs = res.data?.data || []
            cache = new Map(specs.filter((s) => s && s.id).map((s) => [s.id, s]))
            loaded = true
            emit()
            return getSavedCharts()
        } catch {
            loaded = true
            return getSavedCharts()
        } finally {
            loadPromise = null
        }
    })()
    return loadPromise
}

/**
 * Save a chat chart to the library (and pin it). `spec` is the self-describing agent
 * spec (must carry `id`). Optimistic. Returns the (optimistic) saved chart.
 */
export function saveChart(spec, { thread_id = null } = {}) {
    if (!spec?.id) return null
    const prev = cache.get(spec.id)
    const optimistic = { ...spec, is_pinned: true, thread_id: thread_id || spec.thread_id || null }
    cache.set(spec.id, optimistic)
    emit()
    savedChartsApi.save(spec, { thread_id, is_pinned: true }).catch(() => {
        // rollback: restore prior state (or drop if it wasn't there before)
        if (prev) cache.set(spec.id, prev); else cache.delete(spec.id)
        emit()
    })
    return optimistic
}

/** Flip pin state (un/re-pin) WITHOUT removing the artifact. Optimistic. */
export function setSavedPinned(id, isPinned) {
    const prev = cache.get(id)
    if (!prev) return
    cache.set(id, { ...prev, is_pinned: !!isPinned })
    emit()
    savedChartsApi.setPinned(id, !!isPinned).catch(() => { cache.set(id, prev); emit() })
}

/** Convenience: toggle pin for a spec. Saves-then-pins if it's not in the library. */
export function toggleSavedPin(spec) {
    const id = spec?.id
    if (!id) return false
    if (!cache.has(id)) { saveChart(spec); return true }
    const next = !isSavedPinned(id)
    setSavedPinned(id, next)
    return next
}

/** Permanently remove a saved chart from the library. Optimistic. */
export function removeSavedChart(id) {
    const prev = cache.get(id)
    if (!prev) return
    cache.delete(id)
    emit()
    savedChartsApi.remove(id).catch(() => { cache.set(id, prev); emit() })
}
