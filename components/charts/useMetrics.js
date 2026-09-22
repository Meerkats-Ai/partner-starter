/**
 * useMetrics — fetch business metrics from backend-api (dbt/MetricFlow service).
 *
 * Calls /api/v1/metrics/query (workspace-scoped) or the admin variant, via the
 * businessMetrics api client. Returns { rows, loading, error, refetch }. The body
 * is memoised by JSON so charts re-fetch only when their query actually changes.
 *
 * A `platform` opt (meta|google|flipkart) adds the backend's whitelisted
 * `where` equality — but ONLY to queries that are actually platform-scoped (ad-
 * or campaign-grain). Cross-platform queries (blended revenue, orders,
 * inventory) are left untouched, since those models have no platform dimension.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import metricsApi from '@/lib/businessMetrics'

// Does this query reference the ad/campaign models (so a platform filter applies)?
// Classify a single metric/dimension as 'campaign' | 'ad' | 'other'.
// Only the ad/campaign models carry a platform dimension; everything else
// (revenue, orders, margin, RTO, inventory, blended roas/cac, …) is cross-platform.
function grainOf(name) {
    if (typeof name !== 'string') return 'other'
    if (name.startsWith('campaign_')) return 'campaign'
    if (name.startsWith('ad_') || name.startsWith('total_ad_') || name.startsWith('ad_row__')
        || name === 'ctr' || name === 'cpm' || name === 'avg_frequency'
        || name === 'ad_impressions' || name === 'ad_conversions'
        // platform_reported_roas is ad-grain (ad_conversions_value / total_ad_spend);
        // it just doesn't share the ad_ prefix. Without this it reads as 'other', so
        // a ROAS-only chart silently loses its platform filter → blends all platforms.
        || name === 'platform_reported_roas') return 'ad'
    return 'other'
}

/**
 * The platform where-clause for a query — but ONLY when the query is ENTIRELY
 * platform-scoped on a single model. A query that mixes a platform metric with a
 * cross-platform one (e.g. net_revenue + total_ad_spend) CANNOT be filtered on
 * ad_row__platform — MetricFlow has no join path and errors — so we return null
 * and leave that query unfiltered. Dimensions (groupBy) are advisory only; the
 * decision is driven by the METRICS.
 */
function platformWhere(body, platform) {
    if (!platform) return null
    const metrics = body?.metrics || []
    if (metrics.length === 0) return null
    const grains = new Set(metrics.map(grainOf))
    // Every metric must be the SAME platform-scoped grain, with nothing cross-platform.
    if (grains.size === 1 && grains.has('campaign')) return `{{ Dimension('campaign_row__platform') }} = '${platform}'`
    if (grains.size === 1 && grains.has('ad')) return `{{ Dimension('ad_row__platform') }} = '${platform}'`
    return null // mixed or non-platform query → don't filter (avoids invalid joins)
}

export function useMetrics(body, { admin = false, workspaceId, platform } = {}) {
    // Merge the platform where-clause into the body (memoised so key is stable).
    const effBody = useMemo(() => {
        const where = platformWhere(body, platform)
        if (!where) return body
        return { ...body, where: body?.where ? `${body.where} AND ${where}` : where }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(body), platform])
    const key = JSON.stringify(effBody) + '|' + (admin ? `admin:${workspaceId || 'all'}` : 'ws')
    const [state, setState] = useState({ rows: [], loading: true, error: null })

    const run = useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null }))
        try {
            const res = await metricsApi.metrics.query(effBody)
            const data = res.data || {}
            if (data.success === false) throw new Error(data.error || 'metrics query failed')
            setState({ rows: data.rows || [], loading: false, error: null })
        } catch (e) {
            // Never surface raw query errors in the UI — a failed query just renders
            // as empty ("No data"). Keep the detail in the console for debugging.
            const detail = e.response?.data?.error || e.message || 'failed'
            // eslint-disable-next-line no-console
            console.warn('[useMetrics] query failed (shown as empty):', detail)
            setState({ rows: [], loading: false, error: null })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])

    useEffect(() => { run() }, [run])

    // Global refresh signal — e.g. when the onboarding import finishes populating the
    // marts, the import banner fires `mk-metrics-refresh` so every metrics-driven
    // chart re-pulls at once (no page reload). Any code can dispatch it:
    //   window.dispatchEvent(new Event('mk-metrics-refresh'))
    useEffect(() => {
        const onRefresh = () => run()
        window.addEventListener('mk-metrics-refresh', onRefresh)
        return () => window.removeEventListener('mk-metrics-refresh', onRefresh)
    }, [run])

    return { ...state, refetch: run }
}

export default useMetrics
