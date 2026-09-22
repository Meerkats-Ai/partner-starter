/**
 * ShopifyCards — the readymade, pixel-matched dashboard cards for the Explore
 * board's Shopify categories (Sales / Marketing / Product / Customers). Each is a
 * faithful clone of the reference product's card (see the design screenshots):
 * same layout, spacing, typography and colour — sourced from exploreTheme.js.
 *
 * Every card is a self-contained widget: it owns its own metrics query (via
 * useMetrics / useMetricsWithDelta), its loading + empty states, and a Pin button
 * (so any card can be pinned to the Cockpit, exactly like the generic gallery
 * cards). Cards that map to a metric the semantic layer models render live
 * numbers; the ones whose segmentation isn't modelled yet (RFM, market-basket,
 * discount, campaign-goal split, per-product profit, customer-growth) render the
 * honest SetupCard — never fabricated numbers.
 *
 * The spec shape these read is defined in shopifyGallery.js. The dispatcher
 * (which `render:` a spec uses) lives at the bottom of this file.
 */
import React from 'react'
import { createPortal } from 'react-dom'
import { Doughnut, Line } from 'react-chartjs-2'
import { Pin, PinOff, TrendingUp, TrendingDown, Wrench, ArrowUpRight } from 'lucide-react'
import './chartSetup'
import { fmtMoneyInr, fmtNumCompact, fmtPct, fmtDay, fmtWeek, COLORS } from './chartSetup'
import { useMetrics } from './useMetrics'
import { useMetricsWithDelta } from './useMetricsWithDelta'
import { effectiveWindow, useCardDate } from './SpecChart'
import { togglePin, isPinned, PINS_CHANGED_EVENT } from './chartSpec'
import { useTableToolbar, TableToolbar, SortableHeaders } from './TableToolbar'
import { downloadRowsCsv, slugify } from './exportUtils'
import {
    channelLabel, channelColor, FUNNEL_RAMP, DELTA_UP, DELTA_DOWN,
    CELL_GOOD_BG, CELL_BAD_BG, CELL_GOOD_TX, CELL_BAD_TX, GOAL_COLORS, RFM_COLORS,
} from './exploreTheme'

const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0 }

// Reference money style: "₹38.50k" / "₹59.41k" — lowercase k, 2dp under 1L. Its
// own formatter (the shared fmtMoneyInr uppercases K and 1dp's the thousands).
function money(v) {
    if (v == null || !isFinite(Number(v))) return '—'
    const n = Number(v); const a = Math.abs(n)
    const sign = n < 0 ? '-' : ''
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`
    if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(2)}k`
    return `${sign}₹${a.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}
// Plain integer money (₹182, ₹231) for small headline values (AOV / CPM / CAC).
const moneyInt = (v) => (v == null || !isFinite(Number(v)) ? '—' : `₹${Math.round(Number(v)).toLocaleString('en-IN')}`)
// Big-count Indian shorthand: 277592 → "2.78L", 4864 → "4.86k".
function bigNum(v) {
    if (v == null || !isFinite(Number(v))) return '—'
    const n = Number(v); const a = Math.abs(n)
    if (a >= 1e5) return `${(n / 1e5).toFixed(2)}L`
    if (a >= 1e3) return `${(n / 1e3).toFixed(2)}k`
    return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
const pctChange = (cur, prev) => {
    const c = num(cur); const p = num(prev)
    if (p === 0) return c === 0 ? 0 : (c > 0 ? 4000 : -100) // matches reference "+4000%" style caps
    return ((c - p) / Math.abs(p)) * 100
}

// ── Shared card shell (title + optional platform glyph + Pin) ────────────────
function usePinState(spec) {
    const [pinned, setPinned] = React.useState(() => isPinned(spec.id))
    React.useEffect(() => {
        const sync = () => setPinned(isPinned(spec.id))
        sync()
        window.addEventListener(PINS_CHANGED_EVENT, sync)
        return () => window.removeEventListener(PINS_CHANGED_EVENT, sync)
    }, [spec.id])
    return { pinned, setPinned }
}

function PinBtn({ spec, onPinChange }) {
    const { pinned, setPinned } = usePinState(spec)
    const onToggle = () => { const now = togglePin(spec); setPinned(now); onPinChange?.(now) }
    return (
        <button type="button" onClick={onToggle}
            title={pinned ? 'Unpin from Cockpit' : 'Pin to Cockpit'}
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                pinned ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                    : 'border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-700'}`}>
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {pinned ? 'Pinned' : 'Pin'}
        </button>
    )
}

// The rounded outer panel every readymade card sits in. `tone` controls the tint
// (Marketing Overview is faint-violet in the reference; the rest are white).
function Panel({ children, tone = 'white', className = '' }) {
    const bg = tone === 'violet'
        ? 'bg-gradient-to-b from-[#f5f3ff] to-[#faf9ff] border-[#e9e5ff]'
        : 'bg-white border-gray-200'
    return <div className={`rounded-2xl border ${bg} p-6 shadow-sm ${className}`}>{children}</div>
}

// Card heading: title + the little source glyph (Shopify bag / Meta ∞) exactly
// like the reference's coloured pill next to each section title.
function CardHead({ spec, onPinChange, tone, dateChip = null }) {
    return (
        <div className="mb-5 flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <h3 className={`text-lg font-bold tracking-tight ${tone === 'violet' ? 'text-gray-900' : 'text-gray-900'}`}>{spec.title}</h3>
                    {spec.source && <SourceGlyph source={spec.source} />}
                </div>
                {spec.subtitle && <p className="mt-1 text-[13px] text-gray-400">{spec.subtitle}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {dateChip}
                <PinBtn spec={spec} onPinChange={onPinChange} />
            </div>
        </div>
    )
}

function SourceGlyph({ source }) {
    if (source === 'meta') {
        return <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#eef2ff]"><span className="text-[13px] font-bold text-[#1877f2]">∞</span></span>
    }
    // shopify — green bag chip
    return <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#e7f5ec] text-[11px]">🛍️</span>
}

// ── Delta line: "▲ +1593.16% vs last month" (green up / red down) ────────────
function Delta({ cur, prev, invert = false, suffix = 'vs last month' }) {
    const pc = pctChange(cur, prev)
    const rounded = Math.abs(pc) >= 100 ? pc.toFixed(2) : pc.toFixed(2)
    const positive = invert ? pc < 0 : pc >= 0
    const color = positive ? DELTA_UP : DELTA_DOWN
    const Icon = pc >= 0 ? TrendingUp : TrendingDown
    return (
        <div className="mt-2 flex items-center gap-1 text-xs font-semibold" style={{ color }}>
            <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span>{pc >= 0 ? '+' : ''}{rounded}%</span>
            <span className="font-normal text-gray-400">{suffix}</span>
        </div>
    )
}

// Skeleton for a KPI while loading (no stale numbers against a new window).
function KpiSkeleton() {
    return (
        <div className="animate-pulse space-y-2.5">
            <div className="h-3 w-20 rounded bg-gray-100" />
            <div className="h-8 w-28 rounded-md bg-gray-200" />
            <div className="h-3 w-24 rounded bg-gray-100" />
        </div>
    )
}

/* ════════════════════════════════════════════════════════════════════════════
 *  KpiGridCard — "Sales Overview" / "Marketing Overview"
 *  A titled panel with a responsive grid of flat KPI tiles, each: grey label,
 *  big dark value, green/red delta line. Pixel-matches the reference.
 * ══════════════════════════════════════════════════════════════════════════ */
export function KpiGridCard({ spec, admin, workspaceId, platform, windowOverride, onPinChange }) {
    const { win, dateChip } = useCardDate(spec, windowOverride)
    // Tile metrics + any extra metrics needed only for guards (e.g. cogs coverage
    // to decide whether Gross Profit is real). De-duped.
    const metricNames = [...new Set([
        ...spec.tiles.map((t) => t.metric).filter(Boolean),
        ...(spec.guardMetrics || []),
    ])]
    const q = useMetricsWithDelta({ metrics: metricNames, ...win }, { admin, workspaceId, platform: spec.platformScoped ? platform : null })
    const k = q.rows[0] || {}
    const p = q.prevRows[0] || {}

    // Grid width: `cols` (default 4). Tiles beyond the first row wrap naturally, so
    // a 6-tile Sales Overview becomes 4 + (Gross Profit · gap · Discount) — matching
    // the reference — when the 5th tile is followed by a { blank:true } spacer.
    const colClass = spec.cols === 3 ? 'grid-cols-2 md:grid-cols-3'
        : spec.cols === 2 ? 'grid-cols-2'
        : 'grid-cols-2 md:grid-cols-4'
    return (
        <Panel tone={spec.tone}>
            <CardHead spec={spec} onPinChange={onPinChange} tone={spec.tone} dateChip={dateChip} />
            <div className={`grid gap-x-8 gap-y-9 ${colClass}`}>
                {spec.tiles.map((t, i) => {
                    // A spacer tile just holds a grid cell open (the reference's empty
                    // slot between Gross Profit and Discount on the bottom row).
                    if (t.blank) return <div key={`blank-${i}`} className="hidden md:block" aria-hidden />
                    const raw = t.derive ? t.derive(k) : k[t.metric]
                    const prevRaw = t.derive ? t.derive(p) : p[t.metric]
                    const fmt = FMT_BY_KIND[t.fmt] || FMT_BY_KIND.money
                    // A tile is a placeholder if statically flagged OR its guard fires
                    // (e.g. Gross Profit when COGS coverage is 0 → the value would just
                    // equal revenue, which is misleading, so show "—" + a reason).
                    const guarded = t.pendingIf && !q.loading && t.pendingIf(k)
                    const isPlaceholder = t.placeholder || guarded
                    const placeholderNote = guarded ? (t.pendingNote || t.placeholderNote) : t.placeholderNote
                    return (
                        <div key={t.label} className={i === 0 ? 'relative' : ''}>
                            {q.loading ? <KpiSkeleton /> : (
                                <>
                                    <div className="text-[13px] text-gray-500">{t.label}</div>
                                    {isPlaceholder ? (
                                        <>
                                            <div className="mt-1 text-[32px] font-extrabold leading-none tracking-tight text-gray-300">—</div>
                                            <div className="mt-2 text-xs text-gray-400">{placeholderNote || 'not modelled yet'}</div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="mt-1 text-[32px] font-extrabold leading-none tracking-tight tabular-nums text-gray-900">
                                                {fmt(raw)}
                                            </div>
                                            {!t.noDelta && <Delta cur={raw} prev={prevRaw} invert={t.invertDelta} suffix={spec.deltaSuffix || 'vs last month'} />}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    )
                })}
            </div>
        </Panel>
    )
}

const FMT_BY_KIND = {
    money, moneyInt, bigNum,
    pct: (v) => (v == null ? '—' : `${(num(v) * 100).toFixed(2)}%`),
    roas: (v) => (v == null || !isFinite(num(v)) ? '—' : `${num(v).toFixed(2)}X`),
    ratio: (v) => (v == null || !isFinite(num(v)) ? '—' : num(v).toFixed(2)),
}

/* ════════════════════════════════════════════════════════════════════════════
 *  DonutCard — "Sales by Source" (donut left, legend table right).
 *  Groups a metric by a dimension; each slice coloured by channel palette; the
 *  right side is a % table. Pixel-matches the reference.
 * ══════════════════════════════════════════════════════════════════════════ */
export function DonutCard({ spec, admin, workspaceId, platform, windowOverride, onPinChange }) {
    const { win, dateChip } = useCardDate(spec, windowOverride)
    const q = useMetrics(
        { metrics: [spec.metric], groupBy: [spec.dim], orderBy: [`-${spec.metric}`], limit: 12, ...win },
        { admin, workspaceId, platform: spec.platformScoped ? platform : null },
    )
    // Label + colour resolution depends on the donut kind. Channel donut uses the
    // channel vocabulary/palette; the goal donut uses raw objective labels + the
    // teal/pink goal palette.
    const isGoal = spec.palette === 'goal'
    const labelOf = (raw) => (isGoal ? String(raw ?? 'Other') : channelLabel(raw))
    const colorOf = (label, i) => (isGoal ? (GOAL_COLORS[label] || channelColor(label, i)) : channelColor(label, i))
    const rows = (q.rows || []).map((r) => ({ label: labelOf(r[spec.dim]), value: num(r[spec.metric]) }))
        .filter((r) => r.value > 0)
    const merged = React.useMemo(() => {
        const m = new Map()
        rows.forEach((r) => m.set(r.label, (m.get(r.label) || 0) + r.value))
        return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(rows)])
    const total = merged.reduce((a, r) => a + r.value, 0)
    const empty = !q.loading && merged.length === 0

    return (
        <Panel tone={spec.tone}>
            <CardHead spec={spec} onPinChange={onPinChange} tone={spec.tone} dateChip={dateChip} />
            {q.loading ? (
                <div className="h-64 animate-pulse rounded-xl bg-gray-50" />
            ) : empty ? (
                <EmptyBox platformScoped={spec.platformScoped} note={spec.emptyNote} />
            ) : (
                <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
                    <div className="relative mx-auto h-60 w-60">
                        <Doughnut
                            data={{
                                labels: merged.map((r) => r.label),
                                datasets: [{
                                    data: merged.map((r) => r.value),
                                    backgroundColor: merged.map((r, i) => colorOf(r.label, i)),
                                    borderWidth: 4, borderColor: '#fff', hoverOffset: 6,
                                }],
                            }}
                            options={{
                                cutout: '68%', responsive: true, maintainAspectRatio: false,
                                plugins: {
                                    legend: { display: false },
                                    tooltip: { callbacks: { label: (c) => `${c.label}: ${spec.valueFmt === 'money' ? money(c.parsed) : bigNum(c.parsed)} (${((c.parsed / total) * 100).toFixed(2)}%)` } },
                                },
                            }}
                        />
                        {/* Center label (reference's "Total Ad Spend ₹66.78k" in the hole) */}
                        {spec.centerLabel && (
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                                <div className="text-xs text-gray-400">{spec.centerLabel}</div>
                                <div className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">
                                    {spec.valueFmt === 'money' ? money(total) : bigNum(total)}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="overflow-hidden rounded-xl border border-gray-100">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-[#f5f4fb] text-left text-gray-600">
                                    <th className="px-4 py-2.5 font-semibold">{spec.dimLabel || 'Data Source'}</th>
                                    <th className="px-4 py-2.5 text-right font-semibold">{spec.pctLabel || 'Percentage'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {merged.map((r, i) => (
                                    <tr key={r.label} className={i % 2 ? 'bg-gray-50/60' : ''}>
                                        <td className="px-4 py-2.5">
                                            <span className="inline-flex items-center gap-2 text-gray-700">
                                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(r.label, i) }} />
                                                {r.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                                            {total ? ((r.value / total) * 100).toFixed(isGoal ? 2 : 0) : 0}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </Panel>
    )
}

/* ════════════════════════════════════════════════════════════════════════════
 *  FunnelCard — "Customer Journey": Impressions → Clicks → Add to Cart →
 *  Initiated Checkout → Purchase, as a descending shaded funnel with step
 *  drop-off %. Pixel-matches the reference.
 * ══════════════════════════════════════════════════════════════════════════ */
export function FunnelCard({ spec, admin, workspaceId, platform, windowOverride, onPinChange }) {
    const { win, dateChip } = useCardDate(spec, windowOverride)
    const metricNames = spec.stages.map((s) => s.metric)
    const q = useMetrics({ metrics: metricNames, ...win }, { admin, workspaceId, platform: spec.platformScoped ? platform : null })
    const k = q.rows[0] || {}
    const vals = spec.stages.map((s) => num(k[s.metric]))
    const maxV = Math.max(...vals, 1)
    const empty = !q.loading && vals.every((v) => v === 0)

    const n = spec.stages.length
    // Funnel geometry: a smooth EVEN taper (like the reference), NOT literal value-
    // scaling. Raw funnel values span orders of magnitude (impressions ~1.5M vs
    // purchases ~100), so a linear scale collapses every post-impression stage to
    // the floor and the shape reads as a cliff + flat line. Instead each stage's top
    // edge steps down by a fixed fraction across the funnel — a cosmetic descending
    // silhouette. The REAL drop-off is communicated by the % badges above, exactly
    // like the reference. topByIndex(i): stage 0 fills ~92%, last fills ~38%.
    const H = 200 // svg height (px)
    const TOP_FILL = 0.92, BOTTOM_FILL = 0.38
    const fillFrac = (i) => TOP_FILL - (TOP_FILL - BOTTOM_FILL) * (n > 1 ? i / (n - 1) : 0)
    const topYByIndex = (i) => H - fillFrac(i) * H  // higher fill → smaller y (higher up)

    return (
        <Panel tone={spec.tone}>
            <CardHead spec={spec} onPinChange={onPinChange} tone={spec.tone} dateChip={dateChip} />
            {q.loading ? (
                <div className="h-56 animate-pulse rounded-xl bg-gray-50" />
            ) : empty ? (
                <EmptyBox platformScoped={spec.platformScoped} />
            ) : (
                <div className="overflow-hidden rounded-xl border border-gray-100">
                    {/* Stage headers (value + drop badge), one column each */}
                    <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                        {spec.stages.map((s, i) => {
                            const prev = i > 0 ? vals[i - 1] : null
                            const drop = prev != null && prev > 0 ? ((vals[i] - prev) / prev) * 100 : null
                            return (
                                <div key={s.label} className="border-r border-gray-100 px-3 pt-4 pb-2 text-center last:border-r-0">
                                    <div className="text-[13px] text-gray-500">{s.label}</div>
                                    <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{vals[i].toLocaleString('en-IN')}</div>
                                    {drop != null && (
                                        <div className="mt-2 flex justify-center">
                                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                                drop >= 0 ? 'bg-green-50 text-green-600' : Math.abs(drop) > 90 ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-600'}`}>
                                                {drop >= 0 ? '+' : ''}{drop.toFixed(1)}%
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    {/* Continuous funnel area — one filled segment per stage, sharing edges */}
                    <svg viewBox={`0 0 ${n * 100} ${H}`} preserveAspectRatio="none" className="block h-52 w-full">
                        <defs>
                            {FUNNEL_RAMP.map((c, i) => (
                                <linearGradient key={i} id={`fn-${i}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={c} stopOpacity="0.9" />
                                    <stop offset="100%" stopColor={c} stopOpacity="0.65" />
                                </linearGradient>
                            ))}
                        </defs>
                        {spec.stages.map((s, i) => {
                            // Segment i spans x=[i*100 .. (i+1)*100]. Left edge = this
                            // stage's taper height; right edge = next stage's — so segments
                            // meet flush and the top reads as one smooth descending curve.
                            const x0 = i * 100; const x1 = (i + 1) * 100
                            const yL = topYByIndex(i)
                            const yR = topYByIndex(i < n - 1 ? i + 1 : i)
                            const col = FUNNEL_RAMP[i % FUNNEL_RAMP.length]
                            return (
                                <path key={s.label}
                                    d={`M ${x0} ${yL} L ${x1} ${yR} L ${x1} ${H} L ${x0} ${H} Z`}
                                    fill={`url(#fn-${i % FUNNEL_RAMP.length})`} stroke={col} strokeWidth="0" />
                            )
                        })}
                    </svg>
                </div>
            )}
        </Panel>
    )
}

/* ════════════════════════════════════════════════════════════════════════════
 *  StatCards — a row of small standalone KPI cards ("RPR / CAR / CAC:LTV").
 *  Each is its own bordered card, unlike KpiGridCard's flat tiles.
 * ══════════════════════════════════════════════════════════════════════════ */
export function StatCards({ spec, admin, workspaceId, platform, windowOverride, onPinChange }) {
    const { win, dateChip } = useCardDate(spec, windowOverride)
    const metricNames = spec.tiles.map((t) => t.metric).filter(Boolean)
    const q = useMetricsWithDelta({ metrics: metricNames, ...win }, { admin, workspaceId, platform: spec.platformScoped ? platform : null })
    const k = q.rows[0] || {}; const p = q.prevRows[0] || {}
    return (
        <div>
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">{spec.title}</h3>
                <div className="flex shrink-0 items-center gap-2">{dateChip}<PinBtn spec={spec} onPinChange={onPinChange} /></div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {spec.tiles.map((t) => {
                    const raw = t.derive ? t.derive(k) : k[t.metric]
                    const prevRaw = t.derive ? t.derive(p) : p[t.metric]
                    const fmt = FMT_BY_KIND[t.fmt] || FMT_BY_KIND.ratio
                    return (
                        <div key={t.label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center gap-1.5 text-xs text-gray-500">{t.label}{spec.source && <SourceGlyph source={spec.source} />}</div>
                            {q.loading ? <div className="mt-2 h-7 w-16 animate-pulse rounded bg-gray-100" /> : (
                                <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{fmt(raw)}</div>
                            )}
                            {!t.noDelta && !q.loading && <Delta cur={raw} prev={prevRaw} invert={t.invertDelta} suffix="vs last month" />}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

/* ════════════════════════════════════════════════════════════════════════════
 *  DataTableCard — the reference's rich tables (Source-wise Overview, Ad
 *  Campaign Table, Product Revenue, Customer Overview KPIs, Inventory).
 *  Column defs + optional green/red conditional cell shading come from the spec.
 * ══════════════════════════════════════════════════════════════════════════ */
export function DataTableCard({ spec, admin, workspaceId, platform, windowOverride, onPinChange }) {
    // Per-card date picker (works in Explore AND when pinned to the Cockpit).
    const { win, dateChip } = useCardDate(spec, windowOverride)
    const q = useMetrics(
        {
            metrics: spec.metrics,
            ...(spec.groupBy ? { groupBy: spec.groupBy } : {}),
            ...(spec.orderBy ? { orderBy: spec.orderBy } : {}),
            ...(spec.limit ? { limit: spec.limit } : {}),
            ...win,
        },
        { admin, workspaceId, platform: spec.platformScoped ? platform : null },
    )
    const allRows = spec.shape ? spec.shape(q.rows || []) : (q.rows || [])
    // Shared toolbar: filter (persisted per user+card via spec.id) + sort + fullscreen.
    const tb = useTableToolbar({ cardId: spec.id, columns: spec.columns })
    const rows = React.useMemo(() => tb.applyFilterSort(allRows), [tb, allRows])
    const empty = !q.loading && allRows.length === 0
    const downloadCsv = () => downloadRowsCsv(
        rows,
        (spec.columns || []).map((c) => ({ key: c.key, label: c.header || c.label })),
        `${slugify(spec.title, 'table')}.csv`,
    )

    const body = (
        <>
            {q.loading ? (
                <div className="animate-pulse space-y-2 py-2">{[...Array(6)].map((_, i) => <div key={i} className="h-9 w-full rounded bg-gray-50" />)}</div>
            ) : empty ? (
                <EmptyBox platformScoped={spec.platformScoped} />
            ) : (
                <Table columns={spec.columns} rows={rows} sortState={tb} />
            )}
            {/* Optional footnote (e.g. "these columns need the line-item mart"). */}
            {spec.footnote && !empty && (
                <div className="mt-3 flex items-start gap-2 text-xs text-gray-400">
                    <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{spec.footnote}</span>
                </div>
            )}
            {/* Optional trend chart below the table (Source-wise Overview): revenue per
                channel over time. Pass the card's RESOLVED window (`win`) so the trend
                follows this card's own date override, not just the page window. */}
            {spec.trend && !empty && (
                <ChannelTrend spec={spec} admin={admin} workspaceId={workspaceId} platform={platform} windowOverride={win} />
            )}
        </>
    )

    // The shared toolbar (controls only — the title/source/pin stay in CardHead).
    // Explore/Cockpit tables are non-chat, so Ask-about is enabled.
    const toolbar = (
        <TableToolbar
            tb={tb}
            dateChip={dateChip}
            onRefresh={q.refetch}
            refreshing={q.loading}
            showAsk
            askContext={{ rows, cardId: spec.id, workspaceLabel: null }}
            onDownloadCsv={empty ? null : downloadCsv}
        />
    )

    if (tb.fullscreen) {
        return createPortal(
            <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/50 p-4 sm:p-8"
                onMouseDown={(e) => { if (e.target === e.currentTarget) tb.setFullscreen(false) }}>
                <div className="flex max-h-full w-full max-w-6xl flex-col overflow-auto rounded-xl border border-gray-200 bg-white p-4 shadow-2xl">
                    <CardHead spec={spec} onPinChange={onPinChange} tone={spec.tone} />
                    {toolbar}
                    {body}
                </div>
            </div>,
            document.body,
        )
    }

    return (
        <Panel tone={spec.tone}>
            <CardHead spec={spec} onPinChange={onPinChange} tone={spec.tone} />
            {toolbar}
            {body}
        </Panel>
    )
}

// The reusable table body (header + green/red heat cells + dot labels). When a
// `sortState` (useTableToolbar) is passed, headers become sortable.
function Table({ columns, rows, sortState = null }) {
    return (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-[#f5f4fb] text-left text-gray-600">
                        {sortState ? (
                            <SortableHeaders columns={columns} sort={sortState.sort} toggleSort={sortState.toggleSort} />
                        ) : columns.map((c) => (
                            <th key={c.key} className={`px-4 py-3 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.header}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {rows.map((r, ri) => (
                        <tr key={ri}>
                            {columns.map((c) => {
                                const cell = c.render ? c.render(r) : r[c.key]
                                const heat = c.heat ? c.heat(r) : null
                                const style = heat === 'good' ? { background: CELL_GOOD_BG, color: CELL_GOOD_TX }
                                    : heat === 'bad' ? { background: CELL_BAD_BG, color: CELL_BAD_TX } : undefined
                                return (
                                    <td key={c.key} style={style}
                                        className={`px-4 py-3 tabular-nums ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.strong ? 'font-medium text-gray-800' : 'text-gray-600'}`}>
                                        {c.pair ? (
                                            // A product-pair cell: two stacked thumbnails + names
                                            // (Market Basket "Product Name" column).
                                            <div className="flex flex-col gap-1.5">
                                                {[['imgA', 'a'], ['imgB', 'b']].map(([imgK, nameK]) => (
                                                    <span key={imgK} className="inline-flex items-center gap-2">
                                                        {r[imgK]
                                                            ? <img src={r[imgK]} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded-md bg-gray-50 object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                                                            : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-gray-100 text-xs">📦</span>}
                                                        <span className="truncate text-gray-700">{r[nameK]}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        ) : c.img ? (
                                            <span className="inline-flex items-center gap-2.5">
                                                {c.img(r)
                                                    ? <img src={c.img(r)} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-md bg-gray-50 object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                                                    : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gray-100 text-sm">📦</span>}
                                                <span className="truncate">{cell}</span>
                                            </span>
                                        ) : c.dot ? (
                                            <span className="inline-flex items-center gap-2">
                                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.dot(r) }} />{cell}
                                            </span>
                                        ) : cell}
                                    </td>
                                )
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

/**
 * ChannelTrend — the multi-series line chart under Source-wise Overview: one line
 * per channel, revenue over time. Its own query (metric by channel + time), so it
 * pivots rows → {label, [channel]: value} and draws a coloured line per channel.
 * spec.trend = { metric, dim (channel dim), valueFmt }.
 */
function ChannelTrend({ spec, admin, workspaceId, platform, windowOverride }) {
    const win = React.useMemo(() => effectiveWindow(spec, windowOverride), [spec, windowOverride])
    const t = spec.trend
    // Pick a time grain that fits the window (day for short, week for long).
    const days = React.useMemo(() => {
        if (!win.startDate || !win.endDate) return 90
        return Math.round((new Date(win.endDate) - new Date(win.startDate)) / 86400000) + 1
    }, [win])
    // Sunday-aligned weekly grain (weeks run Sunday→Saturday); metric_time__week
    // would be Monday-based. See backend ALLOWED_DIMENSIONS + E:\etl week_sun grain.
    const timeDim = days <= 45 ? 'metric_time__day' : 'metric_time__week_sun'
    const q = useMetrics(
        { metrics: [t.metric], groupBy: [t.dim, timeDim], orderBy: [timeDim], ...win },
        { admin, workspaceId, platform: spec.platformScoped ? platform : null },
    )
    // Pivot: buckets (x) × channels (series).
    const { labels, series } = React.useMemo(() => {
        const rows = q.rows || []
        const bucketKeys = []
        const byChannel = new Map()
        for (const r of rows) {
            const bkt = r[timeDim]
            if (!bucketKeys.includes(bkt)) bucketKeys.push(bkt)
            const ch = channelLabel(r[t.dim])
            if (!byChannel.has(ch)) byChannel.set(ch, new Map())
            byChannel.get(ch).set(bkt, num(r[t.metric]))
        }
        bucketKeys.sort()
        const fmtLbl = timeDim === 'metric_time__day' ? fmtDay : fmtWeek
        const labels = bucketKeys.map(fmtLbl)
        const series = [...byChannel.entries()].map(([ch, m], i) => ({
            label: ch, color: channelColor(ch, i),
            data: bucketKeys.map((b) => m.get(b) ?? 0),
        }))
        return { labels, series }
    }, [q.rows, timeDim, t.dim, t.metric])

    if (q.loading) return <div className="mt-6 h-56 animate-pulse rounded-xl bg-gray-50" />
    if (!series.length) return null
    return (
        <div className="mt-6" style={{ height: 260 }}>
            <Line
                data={{
                    labels,
                    datasets: series.map((s) => ({
                        label: s.label, data: s.data,
                        borderColor: s.color, backgroundColor: `${s.color}22`,
                        pointRadius: 0, borderWidth: 2, tension: 0.4, fill: true,
                    })),
                }}
                options={{
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: true, position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } },
                        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } },
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 10 }, maxRotation: 0, autoSkip: true } },
                        y: { grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 10 }, callback: (v) => money(v) } },
                    },
                }}
            />
        </div>
    )
}

// Empty-state box shared by all readymade cards. `note` overrides the default
// hint (e.g. a "needs modelling" explanation for a not-yet-modelled dimension).
function EmptyBox({ platformScoped, note }) {
    return (
        <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 px-6 text-center">
            <div className="text-sm font-medium text-gray-400">No data in this window</div>
            <div className="max-w-md text-xs text-gray-300">
                {note || (platformScoped ? 'Check the platform toggle matches this workspace’s ads.' : 'This workspace has no rows for these metrics yet.')}
            </div>
        </div>
    )
}

/* ════════════════════════════════════════════════════════════════════════════
 *  SetupCard — honest "needs data modelling" state (RFM, market-basket, discount,
 *  campaign-goal split, per-product profit, customer-growth). Still pinnable.
 * ══════════════════════════════════════════════════════════════════════════ */
export function SetupCard({ spec, onPinChange }) {
    return (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 p-6">
            <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold tracking-tight text-gray-700">{spec.title}</h3>
                        {spec.source && <SourceGlyph source={spec.source} />}
                    </div>
                    {spec.subtitle && <p className="mt-1 text-[13px] text-gray-400">{spec.subtitle}</p>}
                </div>
                <PinBtn spec={spec} onPinChange={onPinChange} />
            </div>
            <div className="flex items-start gap-2.5 rounded-xl bg-white/70 px-4 py-4 text-sm text-gray-500">
                <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <span>{spec.setupNote || 'This view needs its segmentation modelled in the metrics layer before it can show numbers.'}</span>
            </div>
        </div>
    )
}

/* ════════════════════════════════════════════════════════════════════════════
 *  AdCampaignTable — the reference's rich campaign table: an inner platform
 *  sub-filter (All / Google / Meta) + four view tabs (Nested / Campaigns /
 *  Ad sets / Ads). The Campaigns view is LIVE (campaign-grain metrics exist).
 *  Nested / Ad sets / Ads need adset/ad-grain marts (E:\etl backlog A2) — they
 *  render an honest placeholder until then, so the full UI is in place and lights
 *  up the moment those grains land. Columns match the reference (Cost / Impr /
 *  CPM / CTR / Clicks / CVR / CPC / Purchases) with green/red heat cells.
 * ══════════════════════════════════════════════════════════════════════════ */
const CAMPAIGN_COLUMNS = [
    { key: 'name', header: 'Campaign', align: 'left', strong: true },
    { key: 'cost', header: 'Cost', align: 'right', render: (r) => money(r.cost), heat: (r) => (r.conv > 3 ? 'good' : 'bad') },
    { key: 'impr', header: 'Impressions', align: 'right', render: (r) => r.impr.toLocaleString('en-IN'), heat: () => 'good' },
    { key: 'cpm', header: 'CPM', align: 'right', render: (r) => moneyInt(r.cpm), heat: () => 'good' },
    { key: 'ctr', header: 'CTR', align: 'right', render: (r) => `${(r.ctr * 100).toFixed(2)}%`, heat: (r) => (r.ctr >= 0.01 ? 'good' : 'bad') },
    { key: 'clicks', header: 'Clicks', align: 'right', render: (r) => r.clicks.toLocaleString('en-IN'), heat: () => 'good' },
    { key: 'cvr', header: 'CVR', align: 'right', render: (r) => `${(r.cvr * 100).toFixed(2)}%`, heat: (r) => (r.cvr > 0 ? 'good' : 'bad') },
    { key: 'cpc', header: 'CPC', align: 'right', render: (r) => `₹${r.cpc.toFixed(3)}`, heat: () => 'good' },
    { key: 'conv', header: 'Purchases', align: 'right', render: (r) => r.conv.toLocaleString('en-IN'), heat: (r) => (r.conv > 0 ? 'good' : 'bad') },
]
const AD_PLATFORM_TABS = [
    { key: 'all', label: 'All' },
    { key: 'google', label: 'Google' },
    { key: 'meta', label: 'Meta' },
]
const AD_VIEW_TABS = [
    { key: 'nested', label: 'Nested' },
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'adsets', label: 'Ad sets' },
    { key: 'ads', label: 'Ads' },
]

// The ad-entity dimension each view groups by (Nested falls back to campaign).
const AD_VIEW_DIM = { campaigns: 'ad_entity__campaign_name', nested: 'ad_entity__campaign_name', adsets: 'ad_entity__adset_name', ads: 'ad_entity__ad_name' }

export function AdCampaignTable({ spec, admin, workspaceId, platform, windowOverride, onPinChange }) {
    const { win, dateChip } = useCardDate(spec, windowOverride)
    const [plat, setPlat] = React.useState('all')
    const [view, setView] = React.useState('campaigns')
    const platFilter = plat === 'all' ? null : plat
    // ALL views now read the ad-entity mart (A2), grouped by the view's dimension.
    // The ae_* metrics exist at campaign/adset/ad grain, so one query shape serves
    // every tab — just swap the group-by. platform filter uses ad_entity__platform.
    const groupDim = AD_VIEW_DIM[view] || 'ad_entity__campaign_name'
    const q = useMetrics(
        {
            metrics: ['ae_spend', 'ae_impressions', 'ae_cpm', 'ae_ctr', 'ae_clicks', 'ae_conversions'],
            groupBy: [groupDim, 'ad_entity__platform'],
            orderBy: ['-ae_spend'], limit: 60, ...win,
        },
        { admin, workspaceId },
    )
    const baseRows = React.useMemo(() => (q.rows || [])
        .filter((r) => num(r.ae_spend) > 0)
        .filter((r) => !platFilter || String(r.ad_entity__platform || '').toLowerCase() === platFilter)
        .map((r) => {
            const clicks = num(r.ae_clicks); const conv = num(r.ae_conversions); const spend = num(r.ae_spend)
            return {
                name: r[groupDim] || '(unknown)', platform: r.ad_entity__platform,
                cost: spend, impr: num(r.ae_impressions), cpm: num(r.ae_cpm),
                ctr: num(r.ae_ctr), clicks, conv,
                cvr: clicks > 0 ? conv / clicks : 0, cpc: clicks > 0 ? spend / clicks : 0,
            }
        }), [q.rows, platFilter, groupDim])
    // Shared toolbar: the persisted name filter (e.g. "DT_" for one person's
    // campaigns) + sort + fullscreen. The view/platform tab is part of the id so a
    // person's DT_ filter is remembered per (card, view) they set it on.
    const tb = useTableToolbar({ cardId: `${spec.id}:${view}`, columns: CAMPAIGN_COLUMNS })
    const rows = React.useMemo(() => tb.applyFilterSort(baseRows), [tb, baseRows])
    const empty = !q.loading && baseRows.length === 0
    const isLive = true // every view is live now (A2 marts built)

    const toolbar = (
        <TableToolbar
            tb={tb}
            dateChip={dateChip}
            onRefresh={q.refetch}
            refreshing={q.loading}
            showAsk
            askContext={{ rows, cardId: spec.id, workspaceLabel: null }}
            onDownloadCsv={empty ? null : () => downloadRowsCsv(rows, CAMPAIGN_COLUMNS.map((c) => ({ key: c.key, label: c.header })), `${slugify(spec.title, 'campaigns')}.csv`)}
        />
    )

    const inner = (
        <>
            <CardHead spec={spec} onPinChange={onPinChange} tone={spec.tone} />
            {toolbar}
            {/* Platform sub-filter */}
            <div className="mb-3 inline-flex overflow-hidden rounded-full border border-gray-200 text-sm">
                {AD_PLATFORM_TABS.map((t) => (
                    <button key={t.key} onClick={() => setPlat(t.key)}
                        className={`px-3.5 py-1.5 font-medium transition ${plat === t.key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                        {t.label}
                    </button>
                ))}
            </div>
            {/* View tabs */}
            <div className="mb-4 flex items-center gap-5 border-b border-gray-100">
                {AD_VIEW_TABS.map((t) => (
                    <button key={t.key} onClick={() => setView(t.key)}
                        className={`relative -mb-px py-2 text-sm font-medium transition ${view === t.key ? 'text-indigo-700' : 'text-gray-500 hover:text-gray-800'}`}>
                        {t.label}
                        {view === t.key && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-indigo-600" />}
                    </button>
                ))}
            </div>

            {isLive ? (
                q.loading ? (
                    <div className="animate-pulse space-y-2 py-2">{[...Array(6)].map((_, i) => <div key={i} className="h-9 w-full rounded bg-gray-50" />)}</div>
                ) : empty ? (
                    <EmptyBox platformScoped />
                ) : (
                    <>
                        <Table columns={CAMPAIGN_COLUMNS} rows={rows} sortState={tb} />
                        <div className="mt-3 text-xs text-gray-400">
                            Showing {rows.length}{rows.length !== baseRows.length ? ` of ${baseRows.length}` : ''} campaign{baseRows.length === 1 ? '' : 's'}
                            {tb.q.trim() && rows.length === 0 ? ` — none match "${tb.q.trim()}"` : ''}
                        </div>
                    </>
                )
            ) : (
                // Nested / Ad sets / Ads — need adset/ad-grain marts (E:\etl backlog A2).
                <div className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-200 px-6 text-center">
                    <Wrench className="h-4 w-4 text-gray-400" />
                    <div className="text-sm font-medium text-gray-500">
                        {view === 'nested' ? 'Nested Campaign → Ad set → Ad view' : view === 'adsets' ? 'Ad-set breakdown' : 'Ad breakdown'} coming soon
                    </div>
                    <div className="max-w-md text-xs text-gray-400">
                        The raw ad-set / ad data is ingested — this view turns on once the ad-set &amp; ad-grain
                        models are added in the metrics layer. Use the Campaigns tab for now.
                    </div>
                </div>
            )}
        </>
    )

    if (tb.fullscreen) {
        return createPortal(
            <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/50 p-4 sm:p-8"
                onMouseDown={(e) => { if (e.target === e.currentTarget) tb.setFullscreen(false) }}>
                <div className="flex max-h-full w-full max-w-6xl flex-col overflow-auto rounded-xl border border-gray-200 bg-white p-6 shadow-2xl">
                    {inner}
                </div>
            </div>,
            document.body,
        )
    }
    return <Panel tone={spec.tone}>{inner}</Panel>
}

/* ════════════════════════════════════════════════════════════════════════════
 *  ProductOverviewCards — reference "Products Overview": a Most Profitable /
 *  Least Profitable / BestSeller toggle + a horizontal grid of product cards
 *  (image, name, Total Sales / Order Count / Profit / Total Margin).
 *
 *  Data reality: per-product sales/profit/margin/order-count come from the
 *  line-item mart (EXPLORE_BACKLOG A4) + COGS import (A8), which don't exist yet.
 *  Only units-sold + stock are modelled. So BestSeller sorts on real units-sold;
 *  the money rows show an honest "—" until A4/A8 land. Full layout is in place.
 * ══════════════════════════════════════════════════════════════════════════ */
const PRODUCT_SORTS = [
    // BestSeller + revenue sorts are LIVE off the line-item mart (A4). Profit sorts
    // still need COGS (backlog A8 — read_inventory scope), so they fall back to
    // gross-sales order and flag the pending profit rows.
    { key: 'best', label: 'BestSeller', orderBy: '-product_quantity' },
    { key: 'most', label: 'Most Profitable', orderBy: '-product_gross_sales', pending: true },
    { key: 'least', label: 'Least Profitable', orderBy: 'product_gross_sales', pending: true },
]
export function ProductOverviewCards({ spec, admin, workspaceId, platform, windowOverride, onPinChange }) {
    const [sort, setSort] = React.useState('best')
    const [page, setPage] = React.useState(0)
    const active = PRODUCT_SORTS.find((s) => s.key === sort)
    const q = useMetrics(
        {
            metrics: ['product_gross_sales', 'product_quantity', 'product_order_count'],
            groupBy: ['line_item__product_title', 'line_item__image_url'],
            orderBy: [active.orderBy], limit: 40, dateRange: 'last_90_days',
        },
        { admin, workspaceId },
    )
    const items = React.useMemo(() => (q.rows || [])
        .filter((r) => r.line_item__product_title && r.line_item__product_title !== '(unknown)')
        .map((r) => ({
            name: r.line_item__product_title, image: r.line_item__image_url,
            sales: num(r.product_gross_sales), orders: num(r.product_order_count), qty: num(r.product_quantity),
        })), [q.rows])
    const PER = 4
    const pages = Math.max(1, Math.ceil(items.length / PER))
    const shown = items.slice(page * PER, page * PER + PER)

    return (
        <Panel tone="violet">
            <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold tracking-tight text-gray-900">{spec.title}</h3>
                    <SourceGlyph source="shopify" />
                </div>
                <PinBtn spec={spec} onPinChange={onPinChange} />
            </div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex gap-2">
                    {PRODUCT_SORTS.map((s) => (
                        <button key={s.key} onClick={() => { setSort(s.key); setPage(0) }}
                            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                                sort === s.key ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}>
                            {s.label}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span>Page {page + 1} of {pages}</span>
                    <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
                        className="grid h-7 w-7 place-items-center rounded-full border border-gray-200 disabled:opacity-40">‹</button>
                    <button disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                        className="grid h-7 w-7 place-items-center rounded-full border border-gray-200 disabled:opacity-40">›</button>
                </div>
            </div>
            {q.loading ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{[...Array(4)].map((_, i) => <div key={i} className="h-64 animate-pulse rounded-2xl bg-gray-100" />)}</div>
            ) : shown.length === 0 ? (
                <EmptyBox />
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {shown.map((it) => (
                        <div key={it.name} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                            {/* Real product image (from Shopify _raw, surfaced via A4b) */}
                            {it.image ? (
                                <img src={it.image} alt={it.name} loading="lazy"
                                    className="h-36 w-full bg-gray-50 object-contain p-2"
                                    onError={(e) => { e.currentTarget.style.display = 'none' }} />
                            ) : (
                                <div className="flex h-36 items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50 text-3xl">📦</div>
                            )}
                            <div className="p-4">
                                <div className="truncate text-sm font-semibold text-gray-900" title={it.name}>{it.name}</div>
                                <dl className="mt-3 space-y-1.5 text-sm">
                                    <Row k="Total Sales" v={money(it.sales)} />
                                    <Row k="Order Count" v={it.orders.toLocaleString('en-IN')} />
                                    <Row k="Quantity" v={it.qty.toLocaleString('en-IN')} />
                                    {/* Profit/Margin need COGS (backlog A8 — read_inventory scope) */}
                                    <Row k="Profit" pending />
                                    <Row k="Total Margin" pending />
                                </dl>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {active.pending && (
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-gray-500">
                    <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <span>Sales, profit &amp; margin per product need the line-item revenue mart (+ COGS import). Sorted by units sold for now — see EXPLORE_BACKLOG A4/A8.</span>
                </div>
            )}
        </Panel>
    )
}
// One label/value row inside a product card. `pending` shows a muted em-dash.
function Row({ k, v, pending }) {
    return (
        <div className="flex items-center justify-between">
            <dt className="text-gray-500">{k}</dt>
            <dd className={`tabular-nums ${pending ? 'text-gray-300' : 'font-medium text-gray-800'}`}>{pending ? '—' : v}</dd>
        </div>
    )
}

/* ════════════════════════════════════════════════════════════════════════════
 *  RfmCard — reference "RFM Analysis": a 5×5 Recency×(Frequency+Monetary) mekko
 *  grid of loyalty segments + a segment table (Audience Type / Customers / M / F /
 *  R) + the "Who are Champions?" note + Download CSV.
 *
 *  Data reality: RFM scoring needs a per-customer RFM model (dim_customer_rfm),
 *  which isn't built yet — though it's FULLY derivable from data already ingested
 *  (order recency/frequency/monetary per customer_id). See EXPLORE_BACKLOG A5. So
 *  the full layout renders with a "needs mart" ribbon over the honest empty grid,
 *  and lights up with real segments the moment A5 lands.
 * ══════════════════════════════════════════════════════════════════════════ */
const RFM_SEGMENTS = [
    'Champions', 'Loyal Customers', 'Potential Loyalist', 'New Customers', 'Promising',
    'Need Attention', 'About To Sleep', "Can't Lose Them", 'At Risk', 'Hibernating',
]
// The mekko tile layout (label + grid area) mirrors the reference's segment map.
const RFM_TILES = [
    { seg: 'Champions', col: '1 / 2', row: '1 / 2' },
    { seg: 'Loyal Customers', col: '2 / 3', row: '1 / 2' },
    { seg: 'Potential Loyalist', col: '3 / 5', row: '1 / 2' },
    { seg: 'At Risk', col: '1 / 2', row: '2 / 4' },
    { seg: 'Need Attention', col: '2 / 3', row: '2 / 3' },
    { seg: "Can't Lose Them", col: '3 / 4', row: '2 / 3' },
    { seg: 'About To Sleep', col: '4 / 5', row: '2 / 3' },
    { seg: 'Hibernating', col: '2 / 3', row: '3 / 4' },
    { seg: 'New Customers', col: '3 / 4', row: '3 / 4' },
    { seg: 'Promising', col: '4 / 5', row: '3 / 4' },
]
export function RfmCard({ spec, admin, workspaceId, onPinChange }) {
    // LIVE off dim_customer_rfm (A5): customers + avg R/F/M scores per segment.
    const q = useMetrics(
        {
            metrics: ['rfm_customers', 'rfm_avg_recency', 'rfm_avg_frequency', 'rfm_avg_monetary'],
            groupBy: ['rfm_customer__segment'], dateRange: 'all',
        },
        { admin, workspaceId },
    )
    const bySeg = React.useMemo(() => {
        const m = new Map()
        for (const r of (q.rows || [])) {
            m.set(r.rfm_customer__segment, {
                customers: num(r.rfm_customers),
                r: num(r.rfm_avg_recency), f: num(r.rfm_avg_frequency), mon: num(r.rfm_avg_monetary),
            })
        }
        return m
    }, [q.rows])
    const total = [...bySeg.values()].reduce((a, s) => a + s.customers, 0)
    const modelled = !q.loading && total > 0

    return (
        <Panel tone={spec.tone}>
            <div className="mb-1 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold tracking-tight text-gray-900">{spec.title}</h3>
                    <SourceGlyph source="shopify" />
                </div>
                <PinBtn spec={spec} onPinChange={onPinChange} />
            </div>
            <p className="mb-2 text-[13px] text-gray-400">{spec.subtitle}</p>
            {modelled && <div className="mb-4"><span className="text-xs text-gray-400">Total Customers</span><div className="text-2xl font-bold text-gray-900">{total.toLocaleString('en-IN')}</div></div>}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
                {/* Mekko grid — tile shows the segment's customer count + % of base */}
                <div>
                    <div className="mb-1 text-xs text-gray-400">Frequency + Monetary (Orders + Revenue) ↑</div>
                    <div className="grid h-72 gap-1.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(3, 1fr)' }}>
                        {RFM_TILES.map((t) => {
                            const s = bySeg.get(t.seg)
                            const cnt = s ? s.customers : 0
                            const share = total > 0 ? Math.round((cnt / total) * 100) : 0
                            return (
                                <div key={t.seg} style={{ gridColumn: t.col, gridRow: t.row, background: `${RFM_COLORS[t.seg]}${modelled ? '' : '55'}` }}
                                    className="flex flex-col items-center justify-center rounded-md px-2 text-center">
                                    <span className="text-[11px] font-semibold leading-tight text-white drop-shadow">{modelled ? `${share}%` : t.seg}</span>
                                    <span className="mt-0.5 text-xs font-bold text-white/90">{modelled ? cnt : '·'}</span>
                                </div>
                            )
                        })}
                    </div>
                    <div className="mt-1 text-center text-xs text-gray-400">Recency ↓</div>
                </div>
                {/* Segment table with real customer counts + avg M/F/R */}
                <div className="overflow-hidden rounded-xl border border-gray-100">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-[#f5f4fb] text-left text-gray-600">
                                <th className="px-3 py-2 font-semibold">Audience Type</th>
                                <th className="px-3 py-2 text-right font-semibold">Customers</th>
                                <th className="px-2 py-2 text-right font-semibold">M</th>
                                <th className="px-2 py-2 text-right font-semibold">F</th>
                                <th className="px-2 py-2 text-right font-semibold">R</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {RFM_SEGMENTS.map((seg) => {
                                const s = bySeg.get(seg)
                                const cell = (v) => (!modelled || !s ? '—' : Math.round(v))
                                return (
                                    <tr key={seg} className="text-gray-600">
                                        <td className="px-3 py-2">
                                            <span className="inline-flex items-center gap-2">
                                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: RFM_COLORS[seg] }} />{seg}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">{modelled && s ? s.customers : '—'}</td>
                                        <td className="px-2 py-2 text-right tabular-nums">{s ? cell(s.mon) : '—'}</td>
                                        <td className="px-2 py-2 text-right tabular-nums">{s ? cell(s.f) : '—'}</td>
                                        <td className="px-2 py-2 text-right tabular-nums">{s ? cell(s.r) : '—'}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </Panel>
    )
}

/* ════════════════════════════════════════════════════════════════════════════
 *  GrowthCard — "Customer Growth Rate": new customers per week over time.
 *  LIVE off dim_customer_acquisition (A7). A filled area line, reference style.
 * ══════════════════════════════════════════════════════════════════════════ */
export function GrowthCard({ spec, admin, workspaceId, windowOverride, onPinChange }) {
    const { win, dateChip } = useCardDate(spec, windowOverride)
    const days = win.startDate && win.endDate
        ? Math.round((new Date(win.endDate) - new Date(win.startDate)) / 86400000) + 1 : 90
    // Sunday-aligned weekly grain (weeks run Sunday→Saturday); metric_time__week
    // would be Monday-based. See backend ALLOWED_DIMENSIONS + E:\etl week_sun grain.
    const timeDim = days <= 45 ? 'metric_time__day' : 'metric_time__week_sun'
    const q = useMetrics(
        { metrics: [spec.metric], groupBy: [timeDim], orderBy: [timeDim], ...win },
        { admin, workspaceId },
    )
    const rows = q.rows || []
    const labels = rows.map((r) => (timeDim === 'metric_time__day' ? fmtDay(r[timeDim]) : fmtWeek(r[timeDim])))
    const data = rows.map((r) => num(r[spec.metric]))
    const empty = !q.loading && data.every((v) => v === 0)
    return (
        <Panel tone={spec.tone}>
            <CardHead spec={spec} onPinChange={onPinChange} tone={spec.tone} dateChip={dateChip} />
            {q.loading ? <div className="h-56 animate-pulse rounded-xl bg-gray-50" />
             : empty ? <EmptyBox />
             : (
                <div style={{ height: 260 }}>
                    <Line
                        data={{ labels, datasets: [{
                            label: 'New customers', data,
                            borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.12)',
                            pointRadius: 2, borderWidth: 2, tension: 0.4, fill: true,
                        }] }}
                        options={{
                            responsive: true, maintainAspectRatio: false,
                            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y} new customers` } } },
                            scales: {
                                x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 10 }, maxRotation: 0, autoSkip: true } },
                                y: { grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 10 }, precision: 0 } },
                            },
                        }}
                    />
                </div>
            )}
        </Panel>
    )
}

// ── Dispatcher: route a Shopify spec to its renderer by `spec.render` ────────
const RENDERERS = {
    kpiGrid: KpiGridCard,
    donut: DonutCard,
    funnel: FunnelCard,
    stats: StatCards,
    table: DataTableCard,
    adCampaignTable: AdCampaignTable,
    productOverview: ProductOverviewCards,
    rfm: RfmCard,
    growth: GrowthCard,
    setup: SetupCard,
}

export default function ShopifyCard(props) {
    const { spec } = props
    if (spec.needsSetup) return <SetupCard {...props} />
    const R = RENDERERS[spec.render] || DataTableCard
    return <R {...props} />
}

// re-export the small helpers used by the gallery shapers.
export { money, moneyInt, bigNum, num }
