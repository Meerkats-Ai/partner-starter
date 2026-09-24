import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownTrayIcon } from '@heroicons/react/20/solid'
import { Tooltip2 } from '@/components/pages/Tooltip'
import { ChatChart } from './ChatChart'
import WindowSelector, { useWindow } from './WindowSelector'
import { lastNDays, monthWindow } from './dateWindows'
import { downloadChartPng, slugify } from './exportUtils'
import { useDataSyncedAt, syncedLabel, platformFromQuery, dataSpineUrl } from './useDataSyncedAt'
import metricsApi from '@/lib/businessMetrics'

/**
 * RenderedChartCard — the inline chart card for a render_chart tool result, WITH
 * the SAME date-range picker the Cockpit uses (WindowSelector + useWindow).
 *
 * The agent's render_chart returns { chart: { spec, rows }, query } — `query` is the
 * exact semantic-layer spec (metrics/group_by/order_by/limit + the window it used).
 * We render the frozen `rows` initially; when the user picks a new range in the
 * shared WindowSelector we RE-RUN that same query against /api/v1/metrics/query (the
 * same endpoint + picker the dashboards use, workspace-scoped) and swap in fresh
 * rows — so the picture updates live without going back to the agent.
 *
 * If `query` is missing (older results), the picker is hidden and we show the frozen
 * chart as-is.
 */

// Presets offered in the picker (WindowSelector appends its own "Custom"). Labels
// only — the resolver below maps each to a { startDate, endDate }.
const PRESETS = [
    { value: 'last_7_days', label: 'Last 7 days' },
    { value: 'last_14_days', label: 'Last 14 days' },
    { value: 'last_30_days', label: 'Last 30 days' },
    { value: 'last_90_days', label: 'Last 90 days' },
    { value: 'last_month', label: 'Last month' },
]

// Map a preset value → concrete window. Mirrors CanonicalAdsTable's resolver.
function resolvePreset(win) {
    if (win === 'last_7_days') return lastNDays(7)
    if (win === 'last_14_days') return lastNDays(14)
    if (win === 'last_90_days') return lastNDays(90)
    if (win === 'last_month') {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
        return monthWindow(d)
    }
    return lastNDays(30)
}

// The agent's query window → an initial { startDate, endDate } to seed the picker,
// so it opens showing exactly the range the chart was generated for.
function initialWindowFrom(query) {
    if (query?.start_date && query?.end_date) {
        return { startDate: query.start_date, endDate: query.end_date }
    }
    // Preset windows: resolve to concrete dates so the picker + re-query agree.
    if (query?.date_range) {
        const map = { last_7_days: 7, last_30_days: 30, last_90_days: 90 }
        if (map[query.date_range]) return lastNDays(map[query.date_range])
    }
    return null // fall back to the picker's default preset
}

export function RenderedChartCard({ chart, headerAction = null, refreshOnMount = false }) {
    const { spec, query } = chart
    const [rows, setRows] = useState(chart.rows || [])
    const [loading, setLoading] = useState(false)
    const firstRun = useRef(true)
    const chartRef = useRef(null)
    const syncedText = syncedLabel(useDataSyncedAt())  // "Data synced 3h ago" footer
    const spineUrl = dataSpineUrl(platformFromQuery(query))  // deep-link to the platform's Data Spine

    const downloadPng = () => downloadChartPng(chartRef.current, `${slugify(spec?.title, 'chart')}.png`)

    const canFilter = !!(query && Array.isArray(query.metrics) && query.metrics.length)
    const initialWindow = useMemo(() => initialWindowFrom(query), [query])

    // Re-run the chart's query for a { startDate, endDate } window; swap in rows.
    const refetch = useCallback(async ({ startDate, endDate }) => {
        if (!canFilter || !startDate || !endDate) return
        setLoading(true)
        try {
            // The agent's query spec is snake_case (group_by/order_by), but the
            // backend /metrics/query endpoint reads camelCase (groupBy/orderBy/
            // startDate/endDate) — the same shape the cockpit's useMetrics sends.
            const { metrics, group_by, order_by, limit, name_filter } = query
            const res = await metricsApi.metrics.query({
                metrics,
                ...(group_by?.length ? { groupBy: group_by } : {}),
                ...(order_by?.length ? { orderBy: order_by } : {}),
                ...(limit != null ? { limit } : {}),
                // Carry the agent's server-side name filter through the re-query
                // (snake_case query → camelCase nameFilter) so a date-change / refresh
                // keeps the chart filtered instead of re-plotting everything.
                ...(name_filter?.value ? { nameFilter: name_filter } : {}),
                startDate, endDate,
            })
            const data = res.data || {}
            if (data.success === false) throw new Error(data.error || 'query failed')
            setRows(data.rows || [])
        } catch (e) {
            // Match useMetrics: a failed re-query renders as empty; keep detail in console.
            // eslint-disable-next-line no-console
            console.warn('[RenderedChartCard] re-query failed (shown as empty):', e?.response?.data?.error || e.message)
            setRows([])
        } finally {
            setLoading(false)
        }
    }, [canFilter, query])

    // useWindow owns the picker state; onWindowChange fires whenever the applied
    // window changes. Skip the very first fire (frozen rows already match the
    // agent's window — no need to re-query on mount).
    const winCtrl = useWindow(resolvePreset, 'last_30_days', initialWindow, (w) => {
        if (firstRun.current) { firstRun.current = false; return }
        refetch(w)
    })

    // Pinned Cockpit / Explore charts: re-query the current window ONCE on mount so
    // they never show stale generation-time seed rows (the frozen `chart.rows` are
    // only a first-paint placeholder). The chat card omits refreshOnMount — its rows
    // were just generated, so they're already fresh.
    useEffect(() => {
        if (refreshOnMount) refetch(winCtrl.window_)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className="mb-2 w-full rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    {spec?.title && (
                        <h4 className="truncate text-sm font-semibold text-foreground" title={spec.title}>{spec.title}</h4>
                    )}
                    {spec?.subtitle && <p className="text-xs text-muted-foreground/70">{spec.subtitle}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {headerAction}
                    {canFilter && <WindowSelector presets={PRESETS} ctrl={winCtrl} suffix="" />}
                    <Tooltip2 description="Download PNG">
                        <button
                            type="button"
                            onClick={downloadPng}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent"
                        >
                            <ArrowDownTrayIcon className="h-4 w-4" />
                        </button>
                    </Tooltip2>
                </div>
            </div>
            <div className="relative" style={{ height: 240 }}>
                {loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60 text-xs text-muted-foreground/70">
                        Updating…
                    </div>
                )}
                <ChatChart spec={spec} rows={rows} chartRef={chartRef} />
            </div>
            {syncedText && (
                <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                    {spineUrl ? (
                        <a href={spineUrl} target="_blank" rel="noopener noreferrer"
                            className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground" title="View this platform's data (Data Spine)">
                            {syncedText}
                        </a>
                    ) : syncedText}
                </p>
            )}
        </div>
    )
}

export default RenderedChartCard
