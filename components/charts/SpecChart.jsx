/**
 * SpecChart — renders one serialisable ChartSpec (see chartSpec.js) by querying
 * the semantic layer via useMetrics and drawing the requested chart type.
 *
 * Used in two places:
 *   • the Explore / Chart Studio gallery (with a Pin button)
 *   • the Cockpit "Pinned charts" strip (with an Unpin button)
 *
 * Because a spec is workspace-agnostic, the SAME component re-queries whatever
 * workspace/window/platform is passed in — so a chart pinned in Explore renders
 * identically in the Cockpit against the live workspace.
 */
import React, { useMemo } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import { Pin, PinOff } from 'lucide-react'
import './chartSetup'
import {
    COLORS, SERIES, SEMANTIC, roasColor,
    fmtMoneyInr, fmtNumCompact, fmtDay, fmtWeek, fmtMonth,
} from './chartSetup'
import { useMetrics } from './useMetrics'
import { presetResolvers, useCardWindow, CardWindowControl } from './WindowSelector'
import { lastNDays, monthWindow } from './dateWindows'
import { togglePin, isPinned, PINS_CHANGED_EVENT } from './chartSpec'

const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0 }

// ── formatter registry (spec.valueFmt → fn) ─────────────────────────────────
const FMT = {
    money: (v) => fmtMoneyInr(v),
    num: (v) => fmtNumCompact(v),
    roas: (v) => (v == null || !isFinite(Number(v)) ? '—' : `${Number(v).toFixed(2)}×`),
    pct: (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`),
    plain: (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })),
}
export const VALUE_FORMATS = [
    { value: 'money', label: '₹ money' },
    { value: 'num', label: 'count (compact)' },
    { value: 'roas', label: 'ROAS (×)' },
    { value: 'pct', label: 'percent' },
    { value: 'plain', label: 'plain number' },
]

// Is a dimension a time bucket? (drives x-axis label formatting)
const isTimeDim = (d) => typeof d === 'string' && d.startsWith('metric_time__')
const timeLabelFor = (dim) => {
    if (dim === 'metric_time__day') return fmtDay
    if (dim === 'metric_time__week' || dim === 'metric_time__week_sun') return fmtWeek
    return fmtMonth // month/quarter/year → month-ish label
}

/**
 * The window a card should actually query. A page-level `override`
 * ({startDate,endDate}) wins over the spec's own baked window UNLESS the spec
 * opts out with `fixedWindow: true` (e.g. a card that only makes sense over all
 * history). Falls back to the spec's window when there's no override.
 */
export function effectiveWindow(spec, override) {
    if (override && override.startDate && override.endDate && !spec.fixedWindow) {
        return { startDate: override.startDate, endDate: override.endDate }
    }
    return resolveSpecWindow(spec.window)
}

/**
 * useCardDate — give ANY render-card (chart / table / KPI grid) its OWN date
 * picker, so a card pinned to the Cockpit is re-datable there (the Cockpit doesn't
 * pass a page-level windowOverride, so without this a pinned card was stuck on its
 * baked window). The card's own override wins over the incoming page window; if the
 * card hasn't overridden, it follows the page window (Explore's top bar).
 *
 * Returns { win, dateChip }:
 *   • win      — the {startDate,endDate} the card should query (pass to its body).
 *   • dateChip — a ready "Date" chip node (the same CardWindowControl the persona
 *                cards use). Render it in the card header (TableToolbar's dateChip
 *                slot, or next to the pin in CardHead).
 *
 * `fixedWindow` specs (all-history cards) get no chip and always their own window.
 */
// Coerce any window shape to CONCRETE {startDate,endDate} — the CardWindowControl
// calendar needs real dates. effectiveWindow can return a bare { dateRange: 'last_90_days' }
// (a named preset presetResolvers doesn't cover), which would break the picker; map
// the common last_N_days / last_month presets to dates, else fall back to 30 days.
function concreteWindow(w) {
    if (w && w.startDate && w.endDate) return { startDate: w.startDate, endDate: w.endDate }
    const preset = (w && w.dateRange) || (typeof w === 'string' ? w : null)
    if (preset) {
        const m = /^last_(\d+)_days$/.exec(preset)
        if (m) return lastNDays(Number(m[1]))
        if (preset === 'last_month') { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return monthWindow(d) }
        if (preset === 'this_month') return { startDate: monthWindow(new Date()).startDate, endDate: lastNDays(1).endDate }
    }
    return lastNDays(30)
}

export function useCardDate(spec, windowOverride) {
    const base = useMemo(() => concreteWindow(effectiveWindow(spec, windowOverride)), [spec, windowOverride])
    const ctrl = useCardWindow(base)
    if (spec.fixedWindow) return { win: resolveSpecWindow(spec.window), dateChip: null }
    return { win: ctrl.window_, dateChip: <CardWindowControl ctrl={ctrl} /> }
}

// Inclusive day count of a window.
function winDays(w) {
    if (!w?.startDate || !w?.endDate) return 0
    const s = new Date(w.startDate + 'T00:00:00')
    const e = new Date(w.endDate + 'T00:00:00')
    return Math.round((e - s) / 86400000) + 1
}

/**
 * Pick the time grain that fits a window span: short → day, medium → week, long
 * → month. So a 1-day window shows one daily point (not a whole-month bar), and a
 * 90-day window still buckets sensibly. MetricFlow truncates metric_time__month to
 * the month regardless of the date filter, so a monthly-grouped short window
 * wrongly shows the ENTIRE month — swapping the grain to match the span fixes it.
 */
function grainDimFor(w) {
    const d = winDays(w)
    if (d <= 45) return 'metric_time__day'
    if (d <= 180) return 'metric_time__week_sun'
    return 'metric_time__month'
}

/**
 * If a query groups by a metric_time__* dimension, swap that grain to fit the
 * window span (and mirror the swap in orderBy). Non-time groupBys pass through.
 * Returns { groupBy, orderBy }.
 */
export function adaptTimeGrain(groupBy, orderBy, window_) {
    if (!Array.isArray(groupBy) || !groupBy.length) return { groupBy, orderBy }
    const timeIdx = groupBy.findIndex((g) => typeof g === 'string' && g.startsWith('metric_time__'))
    if (timeIdx < 0) return { groupBy, orderBy }
    const oldDim = groupBy[timeIdx]
    const newDim = grainDimFor(window_)
    if (newDim === oldDim) return { groupBy, orderBy }
    const nextGroupBy = groupBy.map((g, i) => (i === timeIdx ? newDim : g))
    const nextOrderBy = Array.isArray(orderBy)
        ? orderBy.map((o) => (o === oldDim ? newDim : o === `-${oldDim}` ? `-${newDim}` : o))
        : orderBy
    return { groupBy: nextGroupBy, orderBy: nextOrderBy }
}

// Resolve a spec.window (preset string or {startDate,endDate}) to a query window.
export function resolveSpecWindow(win) {
    if (win && typeof win === 'object' && win.startDate && win.endDate) {
        return { startDate: win.startDate, endDate: win.endDate }
    }
    const r = presetResolvers[win]
    if (r) return r()
    // Fallback: a named dateRange preset the metrics service understands directly.
    if (typeof win === 'string' && win) return { dateRange: win }
    return presetResolvers.last_4_weeks()
}

// Human label for the window (subtitle helper).
export function specWindowLabel(win) {
    if (win && typeof win === 'object' && win.startDate) return `${win.startDate} → ${win.endDate}`
    return String(win || 'last 4 weeks').replace(/_/g, ' ')
}

// ── Chart-type renderers ────────────────────────────────────────────────────
function LineBody({ rows, spec }) {
    const dim = spec.groupBy?.[0]
    const labelFmt = isTimeDim(dim) ? timeLabelFor(dim) : (v) => v ?? '—'
    const fmt = FMT[spec.valueFmt] || FMT.plain
    const labels = (rows || []).map((r) => labelFmt(r[dim]))
    const datasets = (spec.metrics || []).map((m, i) => ({
        label: m,
        data: (rows || []).map((r) => num(r[m])),
        borderColor: SERIES[i % SERIES.length],
        backgroundColor: SERIES[i % SERIES.length],
        pointRadius: 2, tension: 0.35, fill: false,
    }))
    return (
        <Line
            data={{ labels, datasets }}
            options={{
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: datasets.length > 1, position: 'top', align: 'start', labels: { boxWidth: 10, font: { size: 10 } } },
                    tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}` } },
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 10 } } },
                    y: { grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 10 }, callback: fmt } },
                },
            }}
        />
    )
}

function BarBody({ rows, spec, horizontal }) {
    const dim = spec.groupBy?.[0]
    const metric = spec.metrics?.[0]
    const fmt = FMT[spec.valueFmt] || FMT.plain
    const labelFmt = isTimeDim(dim) ? timeLabelFor(dim) : (v) => (v == null ? '—' : String(v))
    const labels = (rows || []).map((r) => labelFmt(r[dim]))
    const data = (rows || []).map((r) => num(r[metric]))
    // ROAS bars get semantic colouring; everything else the rotating palette.
    const colors = spec.valueFmt === 'roas'
        ? data.map((v) => roasColor(v))
        : data.map((_, i) => SERIES[i % SERIES.length])
    const valAxis = horizontal ? 'x' : 'y'
    const catAxis = horizontal ? 'y' : 'x'
    return (
        <Bar
            data={{ labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, maxBarThickness: horizontal ? 22 : 44 }] }}
            options={{
                indexAxis: horizontal ? 'y' : 'x',
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (c) => fmt(horizontal ? c.parsed.x : c.parsed.y) } },
                },
                scales: {
                    [catAxis]: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 10 } } },
                    [valAxis]: { grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 10 }, callback: fmt } },
                },
            }}
        />
    )
}

function ComboBody({ rows, spec }) {
    const dim = spec.groupBy?.[0]
    const labelFmt = isTimeDim(dim) ? timeLabelFor(dim) : (v) => v ?? '—'
    const barKeys = spec.barKeys?.length ? spec.barKeys : (spec.metrics || []).slice(0, 1)
    const lineKey = spec.lineKey || (spec.metrics || [])[1]
    const barFmt = FMT[spec.valueFmt] || FMT.money
    const lineFmt = FMT[spec.lineFmt] || FMT.roas
    const labels = (rows || []).map((r) => labelFmt(r[dim]))
    const datasets = [
        ...barKeys.map((k, i) => ({
            type: 'bar', label: k,
            data: (rows || []).map((r) => num(r[k])),
            backgroundColor: SERIES[i % SERIES.length],
            borderRadius: 4, yAxisID: 'y', maxBarThickness: 36,
        })),
        ...(lineKey ? [{
            type: 'line', label: lineKey,
            data: (rows || []).map((r) => num(r[lineKey])),
            borderColor: SEMANTIC.bad, backgroundColor: 'transparent',
            tension: 0.35, pointRadius: 3, yAxisID: 'y1',
        }] : []),
    ]
    return (
        <Bar
            data={{ labels, datasets }}
            options={{
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, font: { size: 10 } } } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 10 } } },
                    y: { position: 'left', grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 10 }, callback: barFmt } },
                    y1: { position: 'right', grid: { display: false }, beginAtZero: true, ticks: { color: SEMANTIC.bad, font: { size: 10 }, callback: lineFmt } },
                },
            }}
        />
    )
}

function KpiBody({ rows, spec }) {
    const fmt = FMT[spec.valueFmt] || FMT.plain
    const r = rows?.[0] || {}
    return (
        <div className="flex h-full flex-wrap items-center gap-x-10 gap-y-4 px-1">
            {(spec.metrics || []).map((m) => (
                <div key={m}>
                    <div className="text-xs text-muted-foreground">{m.replace(/_/g, ' ')}</div>
                    <div className="mt-1 text-3xl font-bold tabular-nums text-foreground">{fmt(r[m])}</div>
                </div>
            ))}
        </div>
    )
}

const BODY = {
    line: LineBody,
    bar: (p) => <BarBody {...p} horizontal={false} />,
    hbar: (p) => <BarBody {...p} horizontal />,
    combo: ComboBody,
    kpi: KpiBody,
}

/**
 * SpecChart — the card. Props:
 *   spec       the ChartSpec
 *   admin      pass through to useMetrics (cross-workspace)
 *   workspaceId  admin workspace
 *   platform   cockpit platform filter (applied only if spec.platformScoped)
 *   onPinChange(pinned) optional callback after a pin toggle
 *   compact    smaller body height (cockpit strip)
 */
export default function SpecChart({ spec, admin = false, workspaceId, platform = null, onPinChange, compact = false, windowOverride = null }) {
    // Per-card date picker — so a chart pinned to the Cockpit is re-datable there
    // (the Cockpit passes no page-level windowOverride).
    const { win, dateChip } = useCardDate(spec, windowOverride)
    // Adapt a time-series grain (day/week/month) to the window span so a short
    // window shows daily points, not a mislabelled whole-month bar.
    const grained = useMemo(() => adaptTimeGrain(spec.groupBy, spec.orderBy, win), [spec.groupBy, spec.orderBy, win])
    // The spec the renderer sees uses the adapted groupBy (so LineBody/BarBody read
    // the correct metric_time__* key).
    const rSpec = useMemo(() => ({ ...spec, groupBy: grained.groupBy, orderBy: grained.orderBy }), [spec, grained])
    const body = useMemo(() => ({
        metrics: spec.metrics,
        ...(grained.groupBy?.length ? { groupBy: grained.groupBy } : {}),
        ...(grained.orderBy?.length ? { orderBy: grained.orderBy } : {}),
        ...(spec.limit ? { limit: spec.limit } : {}),
        ...win,
    }), [spec, win])

    const q = useMetrics(body, { admin, workspaceId, platform: spec.platformScoped ? platform : null })
    const [pinned, setPinned] = React.useState(() => isPinned(spec.id))
    // Keep the button in sync when pins load or change anywhere (server load,
    // another card unpinning, the Cockpit strip, etc.).
    React.useEffect(() => {
        const sync = () => setPinned(isPinned(spec.id))
        sync()
        window.addEventListener(PINS_CHANGED_EVENT, sync)
        return () => window.removeEventListener(PINS_CHANGED_EVENT, sync)
    }, [spec.id])

    const onToggle = () => {
        const now = togglePin(spec)
        setPinned(now)
        onPinChange?.(now)
    }

    const Body = BODY[spec.type] || BODY.bar
    const rows = q.rows || []
    const empty = !q.loading && !q.error && rows.length === 0
    // Full-width (one-per-row) cards get a taller body so the chart fills the
    // wider row proportionally. `compact` (Cockpit strip) stays shorter.
    const height = compact ? 220 : 320
    // Empty-state label reflects the ACTUAL window queried (override or spec's own).
    const winLabel = (windowOverride && !spec.fixedWindow)
        ? specWindowLabel(windowOverride)
        : specWindowLabel(spec.window)

    return (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-foreground" title={spec.title}>{spec.title}</h3>
                    {spec.subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground/70" title={spec.subtitle}>{spec.subtitle}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {dateChip}
                    <button
                        type="button"
                        onClick={onToggle}
                        title={pinned ? 'Unpin from Cockpit' : 'Pin to Cockpit'}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                            pinned
                                ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
                        }`}
                    >
                        {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        {pinned ? 'Pinned' : 'Pin'}
                    </button>
                </div>
            </div>
            <div className="relative" style={{ height }}>
                {q.loading ? (
                    <div className="absolute inset-0 animate-pulse space-y-3 pt-1" aria-label="Loading">
                        <div className="h-4 w-3/4 rounded bg-muted" />
                        <div className="h-4 w-1/2 rounded bg-muted" />
                        <div className="h-4 w-5/6 rounded bg-muted" />
                        <div className="h-4 w-2/3 rounded bg-muted" />
                    </div>
                ) : empty ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
                        <div className="text-xs font-medium text-muted-foreground/70">No data in {winLabel}</div>
                        <div className="text-[11px] text-muted-foreground/60">
                            {spec.platformScoped
                                ? 'Check the platform toggle above matches this workspace’s ads.'
                                : 'This workspace has no rows for these metrics yet.'}
                        </div>
                    </div>
                ) : (
                    <Body rows={rows} spec={rSpec} />
                )}
            </div>
        </div>
    )
}
