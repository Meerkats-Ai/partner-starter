import { useEffect, useState } from 'react'
import cdpApi from '@/lib/cdpApi'

/**
 * useDataSyncedAt — the workspace's FRESHEST data-sync time, for the small
 * "Data synced …" footer on agent-rendered charts/tables. The metrics a chart/table
 * shows are only as fresh as the last CDP sync, so we surface that here.
 *
 * Reads /cdp/connector-stats (per-connector last_synced_at, which now falls back to
 * the data table's MAX(fetched_at) for CSV/cookie platforms like Flipkart) and takes
 * the most recent across all connected sources. Fetched ONCE per session and shared
 * via a module cache, so N cards in a thread don't each hit the endpoint.
 */

let _cache = null          // ISO string | null (resolved value)
let _promise = null        // in-flight fetch shared across cards

async function fetchLatest() {
  if (_promise) return _promise
  _promise = cdpApi.cdp.getConnectorStats()
    .then(({ data }) => {
      const stats = data?.stats || {}
      let latest = null
      for (const v of Object.values(stats)) {
        const t = v?.last_synced_at ? Date.parse(v.last_synced_at) : NaN
        if (!Number.isNaN(t) && (latest == null || t > latest)) latest = t
      }
      _cache = latest != null ? new Date(latest).toISOString() : null
      return _cache
    })
    .catch(() => { _cache = null; return null })
  return _promise
}

export function useDataSyncedAt() {
  const [syncedAt, setSyncedAt] = useState(_cache)
  useEffect(() => {
    let alive = true
    if (_cache !== null) { setSyncedAt(_cache); return undefined }
    fetchLatest().then((v) => { if (alive) setSyncedAt(v) })
    return () => { alive = false }
  }, [])
  // The module cache is per-workspace stale — on a workspace switch, drop it and
  // re-pull so the "Data synced" footer reflects the new workspace.
  useEffect(() => {
    const onRefresh = () => {
      _cache = null; _promise = null
      fetchLatest().then((v) => setSyncedAt(v))
    }
    window.addEventListener('mk-metrics-refresh', onRefresh)
    return () => window.removeEventListener('mk-metrics-refresh', onRefresh)
  }, [])
  return syncedAt
}

// Infer which platform a chart/table's data belongs to, from its query's metric +
// dimension names, so the "Data synced" footer can deep-link to that platform's Data
// Spine page (/dashboard/crm/<platform>). Returns a platform key or null when it's
// cross-platform / can't be inferred (footer stays non-clickable then).
export function platformFromQuery(query) {
  const names = [
    ...((query?.metrics) || []),
    ...((query?.group_by) || query?.groupBy || []),
  ].map((s) => String(s).toLowerCase())
  const any = (re) => names.some((n) => re.test(n))
  if (any(/^fk_|fkcamp_|fk_keyword_|flipkart/)) return 'flipkart'
  if (any(/^amazon_|^amz|amzcamp_|amzst_|amzplc_/)) return 'amazon'
  if (any(/^meta_|meta_creative_|meta_demo_|meta_geo_|meta_hourly_|meta_placement_/)) return 'meta'
  if (any(/^google_|google_kw_|google_st_/)) return 'google'
  if (any(/shopify|order__|customer__|net_revenue|new_customers/)) return 'shopify'
  // Cross-platform metric that carries a platform dimension → not a single platform.
  return null
}

// Data Spine URL for a platform key (all exist under /dashboard/crm/<key>).
export function dataSpineUrl(platform) {
  return platform ? `/dashboard/crm/${platform}` : null
}

// Compact "synced 3h ago" / "synced on 27 Aug".
export function syncedLabel(iso) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 90) return 'Data synced just now'
  const m = Math.floor(s / 60); if (m < 60) return `Data synced ${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `Data synced ${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `Data synced ${d}d ago`
  return `Data synced ${new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
}

export default useDataSyncedAt
