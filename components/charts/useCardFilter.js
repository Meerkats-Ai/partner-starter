/**
 * useCardFilter — per-user, per-card table filter, persisted to the backend so it
 * survives refresh and follows the user across browsers (meerkats.card_filters).
 *
 * The two-people-one-brand case: person A saves "campaign name starts with DT_"
 * on the Ad Campaign Table; person B saves their own. Each filter is private to
 * the user within the workspace.
 *
 * Design mirrors chartSpec.js: an in-memory cache loaded ONCE per workspace (so
 * many table cards on one page share a single GET), invalidated on workspace
 * switch. A card calls useCardFilter(cardId) and gets { filter, setFilter,
 * loaded }. setFilter updates the cache immediately (so typing is instant) and
 * debounce-saves to the server; an empty query DELETEs the row so a cleared
 * filter doesn't linger.
 *
 * A card WITHOUT a cardId (the chat render_table card) gets a purely local,
 * non-persisted filter — same API shape, no network — so the shared table
 * component works in both places unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import cardFiltersApi from '@/lib/cardFilters'

export const DEFAULT_FILTER = { q: '', mode: 'contains', rules: [] }

// A filter is "empty" (nothing to persist → DELETE the row) only when it has no
// free-text AND no active per-column rules. Rules-only filters MUST persist.
const hasAnyFilter = (f) =>
    !!(f && (String(f.q || '').trim() || (Array.isArray(f.rules) && f.rules.some(
        (r) => r && r.key && r.value != null && String(r.value).trim() !== '',
    ))))
const SAVE_DEBOUNCE_MS = 500

// ── module cache (shared across all card instances on a page) ────────────────
let cache = new Map()          // Map<card_id, { q, mode }>
let loaded = false
let loadPromise = null
let loadedWorkspace = null

const currentWs = () => {
    try { return localStorage.getItem('currentWorkspaceId') || '' } catch { return '' }
}

const CHANGED_EVENT = 'cockpit:card-filters-changed'
function emit() {
    try { window.dispatchEvent(new CustomEvent(CHANGED_EVENT)) } catch { /* SSR */ }
}

/** Load every saved filter for this user+workspace into the cache (once). */
function loadFilters({ force = false } = {}) {
    const ws = currentWs()
    if (!force && loaded && loadedWorkspace === ws) return Promise.resolve(cache)
    if (loadPromise && loadedWorkspace === ws && !force) return loadPromise
    loadedWorkspace = ws
    loadPromise = (async () => {
        try {
            const res = await cardFiltersApi.list()
            const map = res.data?.data || {}
            cache = new Map(Object.entries(map))
            loaded = true
            emit()
            return cache
        } catch {
            // On failure keep whatever we had; don't wipe filters the user sees.
            loaded = true
            return cache
        } finally {
            loadPromise = null
        }
    })()
    return loadPromise
}

const getCached = (cardId) => cache.get(cardId) || DEFAULT_FILTER

/**
 * @param {string|null} cardId  stable table id (ChartSpec id). null/undefined →
 *   ephemeral local-only filter (the chat table).
 * @returns {{ filter:{q,mode}, setFilter:(f)=>void, loaded:boolean }}
 */
export function useCardFilter(cardId) {
    const persisted = !!cardId
    const [filter, setLocal] = useState(() => (persisted ? getCached(cardId) : DEFAULT_FILTER))
    const [ready, setReady] = useState(() => (persisted ? loaded && loadedWorkspace === currentWs() : true))
    const saveTimer = useRef(null)

    // Load the cache once, then sync this card's value from it. Also re-sync when
    // any card writes (keeps two instances of the same card id in agreement).
    useEffect(() => {
        if (!persisted) return undefined
        let alive = true
        const sync = () => { if (alive) { setLocal(getCached(cardId)); setReady(true) } }
        loadFilters().then(sync)
        window.addEventListener(CHANGED_EVENT, sync)
        return () => { alive = false; window.removeEventListener(CHANGED_EVENT, sync) }
    }, [cardId, persisted])

    const setFilter = useCallback((next) => {
        const val = { q: '', mode: 'contains', rules: [], ...(next || {}) }
        setLocal(val)
        if (!persisted) return
        cache.set(cardId, val)
        // Debounce the write so typing doesn't fire a request per keystroke.
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
            // Nothing set (no text AND no active rules) → forget the row entirely
            // (clean state, no lingering empty blob). Otherwise persist q + rules.
            const req = hasAnyFilter(val) ? cardFiltersApi.save(cardId, val) : cardFiltersApi.clear(cardId)
            req.catch(() => { /* best-effort; the cache still holds the value locally */ })
        }, SAVE_DEBOUNCE_MS)
    }, [cardId, persisted])

    // Flush a pending save if the component unmounts mid-debounce.
    useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

    return { filter, setFilter, loaded: ready }
}

/** Force a reload (e.g. after a workspace switch elsewhere). */
export function reloadCardFilters() { return loadFilters({ force: true }) }
