import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronUpIcon, ChevronDownIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid'
import WindowSelector, { useWindow } from './WindowSelector'
import { lastNDays, monthWindow } from './dateWindows'
import { downloadRowsCsv, slugify } from './exportUtils'
import { useDataSyncedAt, syncedLabel, platformFromQuery, dataSpineUrl } from './useDataSyncedAt'
import metricsApi from '@/lib/businessMetrics'
import { useTableToolbar, TableToolbar } from './TableToolbar'

// Collapsed tables cap the scroll area at this height (px) so a long table doesn't
// push the next chat message far down the page; a "Show all" toggle expands it.
const COLLAPSED_MAX_H = 320

/**
 * RenderedTableCard — the ONE interactive table used everywhere: the inline
 * render_table chat result AND (via SpecTable / DataTableCard) every Cockpit /
 * Explore data table. Sortable columns + a filter box + the SAME date-range
 * picker the cockpit uses (WindowSelector + useWindow) + CSV export + fullscreen,
 * plus an optional Refresh and "Ask about this" (AI) control.
 *
 * render_table returns { table: { spec: { title, subtitle, columns:[{key,label,fmt}] },
 * rows }, query }. We render the frozen rows initially; a new date range re-queries
 * (server-side) and swaps rows; sort + filter are client-side on whatever rows are
 * currently loaded.
 *
 * Props beyond `table` (all optional — the chat card passes none and is unchanged):
 *   • rows          — externally-controlled rows (Cockpit cards own their own
 *                     useMetrics query and pass rows in; when given we render these
 *                     instead of re-querying on date change).
 *   • loading       — external loading flag (shown as the "Updating…" overlay).
 *   • onWindowChange(win) — called when the date range changes, so an external
 *                     owner can re-run ITS query (Cockpit cards); when present we
 *                     do NOT self-refetch.
 *   • cardId        — stable id → PERSISTS the filter per user+workspace to the
 *                     backend (meerkats.card_filters). Omit for an ephemeral,
 *                     local-only filter (the chat card).
 *   • showAsk       — render the "Ask about this" button (non-chat tables only).
 *   • onRefresh, refreshing — render a Refresh button wired to the owner's refetch.
 *   • workspaceLabel — passed to launchChartChat for the Ask-about context.
 *   • initialWindowLabel — preset/label to seed the date chip (e.g. 'last_90_days').
 */

// ── date-picker plumbing (shared shape with RenderedChartCard) ───────────────
const PRESETS = [
    { value: 'last_7_days', label: 'Last 7 days' },
    { value: 'last_14_days', label: 'Last 14 days' },
    { value: 'last_30_days', label: 'Last 30 days' },
    { value: 'last_90_days', label: 'Last 90 days' },
    { value: 'last_month', label: 'Last month' },
]
function resolvePreset(win) {
    if (win === 'last_7_days') return lastNDays(7)
    if (win === 'last_14_days') return lastNDays(14)
    if (win === 'last_90_days') return lastNDays(90)
    if (win === 'last_month') { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return monthWindow(d) }
    return lastNDays(30)
}
function initialWindowFrom(query) {
    if (query?.start_date && query?.end_date) return { startDate: query.start_date, endDate: query.end_date }
    if (query?.date_range) {
        const map = { last_7_days: 7, last_30_days: 30, last_90_days: 90 }
        if (map[query.date_range]) return lastNDays(map[query.date_range])
    }
    return null
}

// ── cell formatting (matches render_table's `fmt` values) ────────────────────
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: Number(n) % 1 === 0 ? 0 : 2 })}`
// A metric_time__* column (or a value that IS an ISO datetime) should always render
// as a clean date — NOT the raw "2026-08-31T00:00:00+00:00" string. Some saved specs
// tagged the time column fmt:'text' (agent-supplied), so we can't rely on fmt alone.
const isTimeKey = (key) => typeof key === 'string' && key.startsWith('metric_time__')
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}[T ]/
const fmtDateCell = (v) => { const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString() }
function fmtCell(v, fmt, key) {
    if (v == null || v === '') return <span className="text-muted-foreground/60">—</span>
    // Time columns / ISO-datetime strings → formatted date, whatever the stored fmt.
    if (fmt === 'date' || isTimeKey(key) || (typeof v === 'string' && ISO_DATE_RE.test(v))) {
        return fmtDateCell(v)
    }
    const n = Number(v)
    switch (fmt) {
        case 'money': return Number.isFinite(n) ? inr(n) : String(v)
        case 'roas': return Number.isFinite(n) ? `${n.toFixed(2)}×` : String(v)
        case 'pct': return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : String(v)
        case 'int': return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : String(v)
        case 'num': return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v)
        default: return String(v)
    }
}
const isNumericFmt = (fmt) => fmt === 'money' || fmt === 'roas' || fmt === 'pct' || fmt === 'int' || fmt === 'num'

export function RenderedTableCard({
    table,
    rows: externalRows = null,
    loading: externalLoading = null,
    onWindowChange = null,
    cardId = null,
    showAsk = false,
    onRefresh = null,
    refreshing = false,
    workspaceLabel = null,
    headerAction = null,
    // Cockpit/Explore pass this so a pinned card RE-QUERIES its window on mount
    // instead of showing the (possibly days-old) frozen seed rows. The chat card
    // omits it — there the seed rows were just generated, so they're already fresh.
    refreshOnMount = false,
}) {
    const { spec, query } = table
    const columns = spec?.columns || []
    const syncedText = syncedLabel(useDataSyncedAt())  // "Data synced 3h ago" footer
    const spineUrl = dataSpineUrl(platformFromQuery(query))  // deep-link to the platform's Data Spine
    // When an owner controls the rows (Cockpit cards), we mirror them; otherwise
    // (the chat card) we hold + re-query rows ourselves.
    const externallyControlled = externalRows != null || onWindowChange != null
    const [selfRows, setSelfRows] = useState(table.rows || [])
    const [selfLoading, setSelfLoading] = useState(false)
    const rows = externalRows != null ? externalRows : selfRows
    const loading = externalLoading != null ? externalLoading : selfLoading
    const [expanded, setExpanded] = useState(false)   // collapse cap on/off (inline)
    const [overflowing, setOverflowing] = useState(false) // table taller than the cap?
    const scrollRef = useRef(null)
    const firstRun = useRef(true)

    // Keep self-held rows in sync when the chat card's frozen rows arrive/change.
    useEffect(() => { if (!externallyControlled) setSelfRows(table.rows || []) }, [table.rows, externallyControlled])

    // Shared filter/sort/fullscreen toolbar state (filter persists per card).
    const tb = useTableToolbar({ cardId, columns })
    const { q, fullscreen, setFullscreen, sort, toggleSort, applyFilterSort } = tb

    const canFilter = !!(query && Array.isArray(query.metrics) && query.metrics.length)
    const initialWindow = useMemo(() => initialWindowFrom(query), [query])

    // Re-query the table for a new window (server-side). Only the SELF-controlled
    // (chat) card does this; an external owner passes onWindowChange and re-runs
    // its own query instead.
    const refetch = useCallback(async ({ startDate, endDate }) => {
        if (!canFilter || !startDate || !endDate) return
        setSelfLoading(true)
        try {
            const { metrics, group_by, order_by, limit, name_filter } = query
            const res = await metricsApi.metrics.query({
                metrics,
                ...(group_by?.length ? { groupBy: group_by } : {}),
                ...(order_by?.length ? { orderBy: order_by } : {}),
                ...(limit != null ? { limit } : {}),
                // Carry the agent's server-side name filter through the re-query
                // (snake_case in the stored query → camelCase `nameFilter` the
                // backend reads), else a date-change / refresh returns UNFILTERED rows.
                ...(name_filter?.value ? { nameFilter: name_filter } : {}),
                startDate, endDate,
            })
            const data = res.data || {}
            if (data.success === false) throw new Error(data.error || 'query failed')
            setSelfRows(data.rows || [])
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[RenderedTableCard] re-query failed (shown as empty):', e?.response?.data?.error || e.message)
            setSelfRows([])
        } finally {
            setSelfLoading(false)
        }
    }, [canFilter, query])

    const winCtrl = useWindow(resolvePreset, 'last_30_days', initialWindow, (w) => {
        if (firstRun.current) { firstRun.current = false; return }
        if (onWindowChange) onWindowChange(w)     // external owner re-runs its query
        else refetch(w)                            // chat card re-queries itself
    })

    // Pinned Cockpit / Explore cards: re-query the current window ONCE on mount so
    // they never show stale generation-time seed rows (the frozen `table.rows` are
    // only a first-paint placeholder here). Self-controlled cards only — an external
    // owner (onWindowChange) drives its own refetch.
    useEffect(() => {
        if (refreshOnMount && !externallyControlled) refetch(winCtrl.window_)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Esc closes fullscreen; lock body scroll while the overlay is open.
    useEffect(() => {
        if (!fullscreen) return undefined
        const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false) }
        document.addEventListener('keydown', onKey)
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
    }, [fullscreen])

    // Client-side FILTER + SORT via the shared toolbar hook (filter persists).
    const view = useMemo(() => applyFilterSort(rows), [applyFilterSort, rows])

    // Download the CURRENT view (filtered + sorted) as CSV — raw values, column
    // labels as headers. Opens directly in Excel / Google Sheets.
    const downloadCsv = () => downloadRowsCsv(view, columns, `${slugify(spec?.title, 'table')}.csv`)

    // Measure whether the (uncapped) table exceeds the collapse height, so the
    // "Show all" toggle only appears for genuinely long tables. Re-measure when the
    // data/filter/window changes. In fullscreen the cap never applies.
    useLayoutEffect(() => {
        const el = scrollRef.current
        if (!el) return
        setOverflowing(el.scrollHeight > COLLAPSED_MAX_H + 4)
    }, [view, fullscreen])

    // The scroll container caps height when collapsed (inline, long table) — but
    // never in fullscreen or once the user expanded it.
    const capped = !fullscreen && !expanded && overflowing
    const scrollStyle = fullscreen
        ? { maxHeight: 'calc(100vh - 130px)' }
        : capped
            ? { maxHeight: COLLAPSED_MAX_H }
            : (expanded ? { maxHeight: 'min(70vh, 900px)' } : undefined)

    const header = (
        <TableToolbar
            title={spec?.title}
            subtitle={spec?.subtitle}
            tb={tb}
            dateChip={canFilter ? <WindowSelector presets={PRESETS} ctrl={winCtrl} suffix="" /> : null}
            onRefresh={onRefresh}
            refreshing={refreshing}
            showAsk={showAsk}
            askContext={showAsk ? { rows: view, cardId, workspaceLabel } : null}
            onDownloadCsv={downloadCsv}
            leadingAction={headerAction}
        />
    )

    const grid = (
        <div ref={scrollRef} style={scrollStyle} className="relative overflow-auto rounded-lg border border-border">
            {loading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-card/60 text-xs text-muted-foreground/70">Updating…</div>
            )}
            <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted">
                    <tr>
                        {columns.map((c) => {
                            const active = sort?.key === c.key
                            const alignRight = isNumericFmt(c.fmt)
                            return (
                                <th
                                    key={c.key}
                                    onClick={() => toggleSort(c.key)}
                                    className={`cursor-pointer select-none whitespace-nowrap border-b border-border bg-muted px-3 py-2 text-[11px] font-medium uppercase tracking-wider hover:text-foreground ${alignRight ? 'text-right' : 'text-left'} ${active ? 'text-foreground' : 'text-muted-foreground'}`}
                                >
                                    <span className={`inline-flex items-center gap-1 ${alignRight ? 'flex-row-reverse' : ''}`}>
                                        {c.label}
                                        {active
                                            ? (sort.dir === 'asc' ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />)
                                            : <ChevronUpDownIcon className="h-3 w-3 text-muted-foreground/60" />}
                                    </span>
                                </th>
                            )
                        })}
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {view.length === 0 ? (
                        <tr><td colSpan={columns.length || 1} className="px-3 py-6 text-center text-xs text-muted-foreground/70">
                            {q.trim() ? `No rows match "${q.trim()}".` : 'No data'}
                        </td></tr>
                    ) : view.map((r, i) => (
                        <tr key={i} className="hover:bg-accent">
                            {columns.map((c) => (
                                <td key={c.key} className={`whitespace-nowrap px-3 py-2 text-[12px] text-foreground ${isNumericFmt(c.fmt) ? 'text-right tabular-nums' : 'text-left'}`}>
                                    {fmtCell(r[c.key], c.fmt, c.key)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )

    const footer = (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground/70">
            <span className="flex items-center gap-1.5">
                {view.length > 0 && <span>{view.length}{view.length !== rows.length ? ` of ${rows.length}` : ''} rows</span>}
                {syncedText && (
                    <span className="text-muted-foreground/60">
                        {view.length > 0 ? '· ' : ''}
                        {spineUrl ? (
                            <a href={spineUrl} target="_blank" rel="noopener noreferrer"
                                className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground" title="View this platform's data (Data Spine)">
                                {syncedText}
                            </a>
                        ) : syncedText}
                    </span>
                )}
            </span>
            {/* Collapse toggle only when the inline table is long enough to be capped. */}
            {!fullscreen && overflowing && (
                <button
                    type="button"
                    onClick={() => setExpanded((e) => !e)}
                    className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
                >
                    {expanded ? <><ChevronUpIcon className="h-3.5 w-3.5" /> Collapse</> : <><ChevronDownIcon className="h-3.5 w-3.5" /> Show all ({view.length})</>}
                </button>
            )}
        </div>
    )

    // Fullscreen: render the whole card as a fixed overlay filling the viewport.
    if (fullscreen) {
        return createPortal(
            <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/50 p-4 sm:p-8" onMouseDown={(e) => { if (e.target === e.currentTarget) setFullscreen(false) }}>
                <div className="flex max-h-full w-full max-w-6xl flex-col rounded-xl border border-border bg-card p-4 shadow-2xl">
                    {header}
                    {grid}
                    {footer}
                </div>
            </div>,
            document.body,
        )
    }

    return (
        <div className="mb-2 w-full rounded-xl border border-border bg-card p-4 shadow-sm">
            {header}
            {grid}
            {footer}
        </div>
    )
}

export default RenderedTableCard
