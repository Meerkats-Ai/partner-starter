/**
 * Reusable chart primitives for the CDP / attribution dashboard.
 *
 * All built on react-chartjs-2 (chart.js registered via chartSetup.js). Each is a
 * thin, presentational wrapper: pass rows + the keys to plot, it renders. Handles
 * loading / empty / error states inline so pages stay declarative.
 */
import React from 'react'
import { Bar, Line } from 'react-chartjs-2'
import {
    FunnelChart, Funnel, LabelList, Tooltip as RTooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { useNavigate } from '@/lib/useNavigate'
import { MessageCircleQuestion, X } from 'lucide-react'
import './chartSetup' // registers chart.js elements (side-effect import)
import { COLORS, SERIES, fmtMoney, fmtNum } from './chartSetup'
import { launchChartChat } from './launchChartChat'
import { isHidden, hideDefault, PINS_CHANGED_EVENT } from './chartSpec'

// ── Hide (remove) a default cockpit chart for this user ─────────────────────
// A small × on the card header; clicking it persists the hide and the card
// disappears. Restore from the "Removed charts" affordance on the dashboard.
function HideChartButton({ chartId, title }) {
    return (
        <button
            type="button"
            onClick={() => hideDefault(chartId)}
            title={`Remove "${title || 'this chart'}" from my dashboard`}
            className="inline-flex shrink-0 items-center rounded-lg border border-border p-1 text-muted-foreground/70 transition hover:border-destructive/40 hover:text-destructive"
        >
            <X className="h-3.5 w-3.5" />
        </button>
    )
}

// Funnel stage fills — token-driven so the funnel re-themes with agency branding.
const FUNNEL_FILLS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
    'hsl(var(--success))',
]

// ── "Ask about this chart" — opens an agent chat seeded with this chart's data ─
// Opt-in: only renders when the caller passes `ask` (the chart's rows + meta).
// Built for non-technical users who want a plain-language read of the graph.
function AskAboutChart({ ask, title, subtitle }) {
    const navigate = useNavigate()
    const [launching, setLaunching] = React.useState(false)
    const rows = ask?.rows
    // No point offering a chat about an empty chart.
    if (!rows || (Array.isArray(rows) && rows.length === 0)) return null
    const onClick = async () => {
        if (launching) return
        setLaunching(true)
        try {
            await launchChartChat(
                { title, subtitle, rows, meta: ask.meta },
                { workspaceLabel: ask.workspaceLabel, navigate },
            )
        } finally {
            setLaunching(false)
        }
    }
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={launching}
            title="Ask the AI to explain this chart in plain language"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
        >
            <MessageCircleQuestion className="h-3.5 w-3.5" />
            {launching ? 'Opening…' : 'Ask about this'}
        </button>
    )
}

// ── Shell: title + framed body with loading/empty/error ─────────────────────
// `ask` (optional): { rows, meta?, workspaceLabel? } — when present, renders an
// "Ask about this" button that launches an agent chat explaining the chart.
// `hideId` (optional): when set, the card shows a × that lets the user remove
// this default chart from their dashboard (persisted per user+workspace). A card
// whose hideId is currently hidden renders nothing.
export function ChartCard({ title, subtitle, loading, error, empty, children, right, ask, hideId }) {
    // Track hidden state so the card removes itself the instant × is clicked.
    const [hidden, setHidden] = React.useState(() => (hideId ? isHidden(hideId) : false))
    React.useEffect(() => {
        if (!hideId) return undefined
        const sync = () => setHidden(isHidden(hideId))
        sync()
        window.addEventListener(PINS_CHANGED_EVENT, sync)
        return () => window.removeEventListener(PINS_CHANGED_EVENT, sync)
    }, [hideId])
    if (hideId && hidden) return null

    return (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2 mb-4">
                <div>
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                    {subtitle && <p className="text-xs text-muted-foreground/70 mt-1">{subtitle}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {right}
                    {ask && <AskAboutChart ask={ask} title={title} subtitle={subtitle} />}
                    {hideId && <HideChartButton chartId={hideId} title={title} />}
                </div>
            </div>
            <div className="relative" style={{ minHeight: 220 }}>
                {loading ? (
                    <div className="absolute inset-0 animate-pulse space-y-3 pt-1" aria-label="Loading">
                        <div className="h-4 w-3/4 rounded bg-muted" />
                        <div className="h-4 w-1/2 rounded bg-muted" />
                        <div className="h-4 w-5/6 rounded bg-muted" />
                        <div className="h-4 w-2/3 rounded bg-muted" />
                        <div className="h-4 w-1/3 rounded bg-muted" />
                    </div>
                ) : error ? (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-destructive">{error}</div>
                ) : empty ? (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground/60">No data</div>
                ) : (
                    children
                )}
            </div>
        </div>
    )
}

// ── KPI card — one headline number (+ optional trend-delta node) ────────────
export function KpiCard({ label, value, sub, accent = COLORS.primary, delta }) {
    return (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">{label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: accent }}>{value}</div>
            {delta && <div className="mt-0.5">{delta}</div>}
            {sub && <div className="mt-0.5 text-xs text-muted-foreground/70">{sub}</div>}
        </div>
    )
}

const baseOpts = (extra = {}) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
        legend: { display: false },
        tooltip: { padding: 8, boxPadding: 4 },
    },
    scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 11 } } },
        y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.slate, font: { size: 11 } }, beginAtZero: true },
    },
    ...extra,
})

// ── Bar — categorical (e.g. revenue by channel, ad-spend by platform) ───────
// `ask` defaults to the chart's own rows so the "Ask about this" button appears
// automatically; pass ask={null} to opt a chart out, or ask={{rows, meta}} to
// enrich the context handed to the agent.
export function BarChartCard({ title, subtitle, loading, error, rows, labelKey, valueKey, valueFmt = fmtMoney, right, ask }) {
    const labels = (rows || []).map((r) => r[labelKey] ?? '—')
    const data = (rows || []).map((r) => Number(r[valueKey] ?? 0))
    const empty = !loading && !error && labels.length === 0
    return (
        <ChartCard title={title} subtitle={subtitle} loading={loading} error={error} empty={empty} right={right}
            ask={ask === undefined ? { rows } : ask}>
            <Bar
                data={{
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: labels.map((_, i) => SERIES[i % SERIES.length]),
                        borderRadius: 4,
                        maxBarThickness: 48,
                    }],
                }}
                options={baseOpts({
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: (c) => valueFmt(c.parsed.y) } },
                    },
                })}
            />
        </ChartCard>
    )
}

// ── Line — time series (e.g. revenue trend by month) ────────────────────────
export function LineChartCard({ title, subtitle, loading, error, rows, labelKey, valueKey, labelFmt, valueFmt = fmtMoney, right, ask }) {
    const labels = (rows || []).map((r) => (labelFmt ? labelFmt(r[labelKey]) : r[labelKey]))
    const data = (rows || []).map((r) => Number(r[valueKey] ?? 0))
    const empty = !loading && !error && labels.length === 0
    return (
        <ChartCard title={title} subtitle={subtitle} loading={loading} error={error} empty={empty} right={right}
            ask={ask === undefined ? { rows } : ask}>
            <Line
                data={{
                    labels,
                    datasets: [{
                        data,
                        borderColor: COLORS.primary,
                        backgroundColor: COLORS.primarySoft,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 3,
                        pointBackgroundColor: COLORS.primary,
                    }],
                }}
                options={baseOpts({
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: (c) => valueFmt(c.parsed.y) } },
                    },
                })}
            />
        </ChartCard>
    )
}

// ── Combo — two bar series + a line on a 2nd axis (e.g. revenue+spend / ROAS) ─
export function ComboChartCard({
    title, subtitle, loading, error, rows, labelKey, labelFmt,
    barSeries = [], lineSeries = null, right, ask,
}) {
    const labels = (rows || []).map((r) => (labelFmt ? labelFmt(r[labelKey]) : r[labelKey]))
    const empty = !loading && !error && labels.length === 0
    const datasets = [
        ...barSeries.map((s, i) => ({
            type: 'bar',
            label: s.label,
            data: (rows || []).map((r) => Number(r[s.key] ?? 0)),
            backgroundColor: s.color || SERIES[i % SERIES.length],
            borderRadius: 4,
            yAxisID: 'y',
            maxBarThickness: 40,
        })),
        ...(lineSeries ? [{
            type: 'line',
            label: lineSeries.label,
            data: (rows || []).map((r) => Number(r[lineSeries.key] ?? 0)),
            borderColor: lineSeries.color || COLORS.rose,
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 3,
            yAxisID: 'y1',
        }] : []),
    ]
    return (
        <ChartCard title={title} subtitle={subtitle} loading={loading} error={error} empty={empty} right={right}
            ask={ask === undefined ? { rows } : ask}>
            <Bar
                data={{ labels, datasets }}
                options={baseOpts({
                    plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 11 } } },
                        y: { position: 'left', grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 11 }, callback: (v) => fmtNum(v) } },
                        y1: { position: 'right', grid: { display: false }, beginAtZero: true, ticks: { color: COLORS.rose, font: { size: 11 } } },
                    },
                })}
            />
        </ChartCard>
    )
}

// ── Horizontal-ish funnel (stacked count bars, descending) ──────────────────
export function FunnelCard({ title, subtitle, loading, error, stages, right, ask }) {
    // stages: [{ label, value }] in funnel order (widest first)
    const empty = !loading && !error && (!stages || stages.length === 0)
    // Funnel data is `stages`, not `rows` — expose it to the agent as rows.
    const askRows = (stages || []).map((s) => ({ stage: s.label, count: s.value }))
    // Recharts funnel needs {name, value, fill} rows.
    const data = (stages || []).map((s, i) => ({
        name: s.label,
        value: Number(s.value || 0),
        fill: FUNNEL_FILLS[i % FUNNEL_FILLS.length],
    }))
    return (
        <ChartCard title={title} subtitle={subtitle} loading={loading} error={error} empty={empty} right={right}
            ask={ask === undefined ? { rows: askRows } : ask}>
            <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <FunnelChart>
                        <RTooltip
                            formatter={(value, name) => [fmtNum(value), name]}
                            contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid hsl(var(--border))' }}
                        />
                        <Funnel dataKey="value" data={data} isAnimationActive>
                            <LabelList position="right" dataKey="name" fill="hsl(var(--foreground))" stroke="none" fontSize={12} />
                            <LabelList position="center" dataKey="value" formatter={(v) => fmtNum(v)}
                                fill="hsl(var(--primary-foreground))" stroke="none" fontSize={12} fontWeight={600} />
                            {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                        </Funnel>
                    </FunnelChart>
                </ResponsiveContainer>
            </div>
            {/* Stage-to-stage drop-off, like the reference. */}
            {data.length > 1 && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {data.slice(1).map((stage, i) => {
                        const prev = data[i].value
                        const drop = prev ? Math.round(((prev - stage.value) / prev) * 100) : 0
                        return (
                            <span key={stage.name}>
                                {data[i].name} → {stage.name}: <strong className="text-foreground">-{drop}%</strong>
                            </span>
                        )
                    })}
                </div>
            )}
        </ChartCard>
    )
}
