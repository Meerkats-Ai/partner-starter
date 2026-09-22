/**
 * MediaBuyerDashboard — "which creative & product do I scale today?"
 *
 * The media-buyer altitude of the cockpit: funnel diagnostics (seen → clicked →
 * reached page → added to cart → started checkout) and a per-campaign
 * stage-by-stage table, all from the semantic layer's ad-grain metrics
 * (ad_landing_page_views / ad_add_to_carts / ad_checkouts_initiated are
 * platform-reported, Meta-first — Google rows without them show "—").
 *
 * Same visual system as Founder/Marketer: flat KPI tiles with shimmer,
 * semantic green/amber/red chips, No-data states, window selector whose
 * queries re-key on change.
 *
 * Props: { admin, workspaceId } — same dual-surface pattern as CdpDashboard.
 */
import React, { useMemo, useState } from 'react'
import {
    FunnelChart, Funnel, LabelList, Tooltip as RTooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { useMetrics } from './useMetrics'
import { useMetricsWithDelta } from './useMetricsWithDelta'
import { ChartCard } from './ChartCard'
import TrendDelta, { TrendDeltaPoints } from './TrendDelta'
import { lastFullWeek, thisWeekToDate, lastNDays, windowLabel } from './dateWindows'
import WindowSelector, { useWindow, useCardWindow, CardControls } from './WindowSelector'
import { fmtMoney, fmtNumCompact, fmtPct, fmtMoneyInr } from './chartSetup'

const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0 }
// Ratio that stays honest: null (not 0) when the denominator is missing.
const ratio = (a, b) => (num(b) > 0 ? num(a) / num(b) : null)

const WINDOWS = [
    { value: 'last_week', label: 'Last full week' },
    { value: 'this_week', label: 'This week' },
    { value: 'last_14_days', label: 'Last 14 days' },
]

const resolveWindow = (win) => {
    if (win === 'this_week') return thisWeekToDate()
    if (win === 'last_14_days') return lastNDays(14)
    return lastFullWeek()
}

// Flat prototype-style KPI tile (same as FounderDashboard's).
function Kpi({ label, value, delta, sub, subCls = 'text-gray-400', loading }) {
    if (loading) {
        return (
            <div>
                <div className="text-sm text-gray-500">{label}</div>
                <div className="mt-2 animate-pulse space-y-2.5" aria-label="Loading">
                    <div className="h-7 w-24 rounded-md bg-gray-200" />
                    <div className="h-3 w-32 rounded bg-gray-100" />
                </div>
            </div>
        )
    }
    const noData = value === 'No data'
    return (
        <div>
            <div className="text-sm text-gray-500">{label}</div>
            <div className={`mt-1.5 leading-9 tracking-tight tabular-nums ${noData ? 'text-xl font-semibold text-gray-300' : 'text-[28px] font-bold text-gray-900'}`}>{value}</div>
            {!noData && delta && <div className="mt-2">{delta}</div>}
            {sub && <div className={`mt-1 text-xs ${subCls}`}>{sub}</div>}
        </div>
    )
}

// Semantic chip for the stage table: value against green/amber thresholds.
const CHIP = {
    good: 'bg-green-100 text-green-700',
    warn: 'bg-amber-100 text-amber-700',
    bad: 'bg-red-100 text-red-700',
    mut: 'bg-gray-100 text-gray-400',
}
function StageChip({ value, fmt = fmtPct, good, warn }) {
    if (value == null) return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP.mut}`}>—</span>
    const cls = value >= good ? CHIP.good : value >= warn ? CHIP.warn : CHIP.bad
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${cls}`}>{fmt(value)}</span>
}

// Healthy pass-through benchmarks per funnel step — the step furthest below
// its benchmark is "the leak" (a raw min() would always blame CTR).
const FUNNEL_BENCH = { ctr: 0.015, reach: 0.6, atc: 0.08, checkout: 0.5 }

export default function MediaBuyerDashboard({ admin = false, workspaceId, platform = null, initialWindow = null, onWindowChange, controlsLeft = null }) {
    const mOpts = { admin, workspaceId, platform }
    const winCtrl = useWindow(resolveWindow, 'last_week', initialWindow, onWindowChange)
    const { window_, weekly } = winCtrl
    const deltaSuffix = weekly ? 'vs last week' : 'vs prev window'

    // ── One ad-grain query: funnel totals + KPI strip (current + previous) ──
    const kpiQ = useMetricsWithDelta(
        {
            metrics: [
                'total_ad_spend', 'ad_impressions', 'total_ad_clicks', 'ctr', 'cpm',
                'ad_landing_page_views', 'ad_add_to_carts', 'ad_checkouts_initiated',
                'ad_conversions',
            ],
            ...window_,
        },
        mOpts,
    )
    const k = kpiQ.rows[0] || {}
    const p = kpiQ.prevRows[0] || {}

    const cpc = ratio(k.total_ad_spend, k.total_ad_clicks)
    const cpcPrev = ratio(p.total_ad_spend, p.total_ad_clicks)
    const reach = ratio(k.ad_landing_page_views, k.total_ad_clicks)
    const reachPrev = ratio(p.ad_landing_page_views, p.total_ad_clicks)
    const atcRate = ratio(k.ad_add_to_carts, k.ad_landing_page_views)
    const atcRatePrev = ratio(p.ad_add_to_carts, p.ad_landing_page_views)
    const costPerCheckout = ratio(k.total_ad_spend, k.ad_checkouts_initiated)
    const costPerCheckoutPrev = ratio(p.total_ad_spend, p.ad_checkouts_initiated)
    const costPerPurchase = ratio(k.total_ad_spend, k.ad_conversions)
    const costPerPurchasePrev = ratio(p.total_ad_spend, p.ad_conversions)

    // ── Funnel card: OWN date range (custom datepicker) + number/% toggle ───
    // Independent of the KPI strip above. Until overridden it follows window_.
    const funnelWin = useCardWindow(window_)
    const [funnelMode, setFunnelMode] = useState('number') // 'number' | 'percent'
    const funnelQ = useMetrics(
        {
            metrics: [
                'ad_impressions', 'total_ad_clicks',
                'ad_landing_page_views', 'ad_add_to_carts', 'ad_checkouts_initiated',
                'ad_conversions',
            ],
            ...funnelWin.window_,
        },
        mOpts,
    )
    const fk = funnelQ.rows[0] || {}

    // ── Funnel stages + the leak (worst step relative to its benchmark) ─────
    // Reads the funnel card's OWN query (funnelQ / fk) so its datepicker is
    // independent of the KPI strip.
    const funnel = useMemo(() => {
        const impressions = num(fk.ad_impressions)
        const clicks = num(fk.total_ad_clicks)
        const lpv = num(fk.ad_landing_page_views)
        const atc = num(fk.ad_add_to_carts)
        const co = num(fk.ad_checkouts_initiated)
        const conv = num(fk.ad_conversions)
        // Google-only / leadgen has no Meta-pixel funnel (lpv/atc/checkout are 0);
        // collapse to impressions → clicks → conversions.
        const metaFunnel = lpv > 0 || atc > 0 || co > 0
        if (!metaFunnel) {
            const steps = [
                { key: 'ctr', rate: ratio(clicks, impressions), bench: FUNNEL_BENCH.ctr, label: 'clicked the ad' },
                { key: 'cvr', rate: ratio(conv, clicks), bench: 0.05, label: 'converted' },
            ]
            const scored = steps.filter((s) => s.rate != null)
            const leak = scored.length
                ? scored.reduce((a, s) => (s.rate / s.bench < a.rate / a.bench ? s : a))
                : null
            return {
                stages: [
                    { label: 'Saw the ad', value: impressions, color: '#3A5A7A' },
                    { label: 'Clicked', value: clicks, color: '#4A6E93' },
                    { label: 'Converted', value: conv, color: '#16a34a' },
                ],
                steps, leak,
            }
        }
        const steps = [
            { key: 'ctr', rate: ratio(clicks, impressions), bench: FUNNEL_BENCH.ctr, label: 'clicked the ad' },
            { key: 'reach', rate: ratio(lpv, clicks), bench: FUNNEL_BENCH.reach, label: 'reached the page' },
            { key: 'atc', rate: ratio(atc, lpv), bench: FUNNEL_BENCH.atc, label: 'added to cart' },
            { key: 'checkout', rate: ratio(co, atc), bench: FUNNEL_BENCH.checkout, label: 'started checkout' },
        ]
        const scored = steps.filter((s) => s.rate != null)
        const leak = scored.length
            ? scored.reduce((a, s) => (s.rate / s.bench < a.rate / a.bench ? s : a))
            : null
        return {
            stages: [
                { label: 'Saw the ad', value: impressions, color: '#3A5A7A' },
                { label: 'Clicked', value: clicks, color: '#4A6E93' },
                { label: 'Reached the page', value: lpv, color: '#6E8FB0' },
                { label: 'Added to cart', value: atc, color: '#8FA9C4' },
                { label: 'Started checkout', value: co, color: '#16a34a' },
            ],
            steps, leak,
        }
    }, [fk])

    // The stage table can be scoped to its own date range independently of the
    // KPI strip / funnel above; until overridden it follows the dashboard window_.
    const campWin = useCardWindow(window_)
    const campQ = useMetrics(
        {
            metrics: [
                'total_ad_spend', 'total_ad_clicks', 'ctr',
                'ad_landing_page_views', 'ad_add_to_carts', 'ad_checkouts_initiated',
                'ad_conversions',
            ],
            groupBy: ['ad_row__campaign_name'], orderBy: ['-total_ad_spend'], limit: 15,
            ...campWin.window_,
        },
        mOpts,
    )
    const campaigns = (campQ.rows || []).filter((c) => c.ad_row__campaign_name && num(c.total_ad_spend) > 0)
    const totSpend = campaigns.reduce((a, c) => a + num(c.total_ad_spend), 0)
    const totCheckouts = campaigns.reduce((a, c) => a + num(c.ad_checkouts_initiated), 0)
    const avgCostPerCheckout = totCheckouts > 0 ? totSpend / totCheckouts : null
    const totConversions = campaigns.reduce((a, c) => a + num(c.ad_conversions), 0)
    const avgCostPerConversion = totConversions > 0 ? totSpend / totConversions : null
    // Google-only / leadgen accounts report no Meta-pixel funnel (ATC/checkout/LPV
    // are structurally 0 for Google). Detect it from the data so we show the
    // conversion columns that DO have signal instead of a wall of empty funnel cells.
    // Check both the campaign rows AND the KPI-strip totals (either can populate first).
    const hasMetaFunnel = (
        num(k.ad_landing_page_views) > 0 || num(k.ad_add_to_carts) > 0 || num(k.ad_checkouts_initiated) > 0 ||
        campaigns.some((c) => num(c.ad_landing_page_views) > 0 || num(c.ad_add_to_carts) > 0 || num(c.ad_checkouts_initiated) > 0)
    )

    // ── Deterministic recommendations (leak + pause candidates) ─────────────
    const recs = useMemo(() => {
        const list = []
        if (funnel.leak && num(k.total_ad_clicks) > 0) {
            const l = funnel.leak
            list.push({
                title: `The leak: only ${fmtPct(l.rate)} ${l.label}`,
                body: l.key === 'ctr'
                    ? 'Creative isn\'t stopping the scroll — test new hooks before touching budgets.'
                    : l.key === 'reach'
                        ? 'Clicks are paid for but never arrive — check page speed, broken links and ad/page match before judging any creative.'
                        : 'The page gets traffic but doesn\'t convert it — fixing the landing page beats swapping creative.',
            })
        }
        if (hasMetaFunnel) {
            // Meta: weak ad AND weak page (page-reach is real signal here).
            const pauses = campaigns.filter((c) => {
                const r = ratio(c.ad_landing_page_views, c.total_ad_clicks)
                return num(c.ctr) < 0.01 && r != null && r < 0.4
            })
            for (const c of pauses.slice(0, 2)) {
                list.push({
                    title: `Pause "${c.ad_row__campaign_name}" — weak ad and weak page`,
                    body: `${fmtPct(c.ctr)} click rate and only ${fmtPct(ratio(c.ad_landing_page_views, c.total_ad_clicks))} of clicks reach the page, on ${fmtMoneyInr(c.total_ad_spend)} of spend.`,
                })
            }
        } else {
            // Google / leadgen: no page-reach signal — flag spend with zero conversions.
            const dead = campaigns.filter((c) => num(c.total_ad_spend) > 0 && num(c.ad_conversions) === 0)
            for (const c of dead.slice(0, 2)) {
                list.push({
                    title: `Review "${c.ad_row__campaign_name}" — spend, no conversions`,
                    body: `${fmtMoneyInr(c.total_ad_spend)} spent with 0 reported conversions in this window — check tracking or pause.`,
                })
            }
        }
        return list.slice(0, 2)
    }, [funnel.leak, campaigns, k.total_ad_clicks, hasMetaFunnel])

    return (
        <div className="space-y-8">
            {/* Controls row — platform filter (from the cockpit) + date picker */}
            <div className="flex flex-wrap items-center gap-2.5">
                {controlsLeft}
                <WindowSelector presets={WINDOWS} ctrl={winCtrl} suffix="" />
            </div>

            {/* KPI strip — 8 flat tiles */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
                <Kpi label="Click rate" loading={kpiQ.loading}
                    value={k.ctr == null ? 'No data' : fmtPct(k.ctr)}
                    sub="≥ 2% is strong creative pull"
                    delta={<TrendDeltaPoints current={k.ctr} previous={p.ctr} suffix={deltaSuffix} />} />
                <Kpi label="Cost / click" loading={kpiQ.loading}
                    value={cpc == null ? 'No data' : fmtMoney(cpc)}
                    delta={<TrendDelta current={cpc} previous={cpcPrev} invert tone="caution" suffix={deltaSuffix} />} />
                {hasMetaFunnel && <>
                    <Kpi label="Clicks that reach page" loading={kpiQ.loading}
                        value={reach == null ? 'No data' : fmtPct(reach)}
                        sub={reach == null ? 'landing-page views not reported' : '≥ 60% is healthy'}
                        delta={<TrendDeltaPoints current={reach} previous={reachPrev} suffix={deltaSuffix} />} />
                    <Kpi label="Page → add to cart" loading={kpiQ.loading}
                        value={atcRate == null ? 'No data' : fmtPct(atcRate)}
                        sub={atcRate == null ? undefined : '≥ 8% is healthy'}
                        delta={<TrendDeltaPoints current={atcRate} previous={atcRatePrev} suffix={deltaSuffix} />} />
                    <Kpi label="Checkouts started" loading={kpiQ.loading}
                        value={num(k.ad_checkouts_initiated) > 0 ? fmtNumCompact(k.ad_checkouts_initiated) : 'No data'}
                        delta={<TrendDelta current={k.ad_checkouts_initiated} previous={p.ad_checkouts_initiated} suffix={deltaSuffix} />} />
                    <Kpi label="Cost per checkout" loading={kpiQ.loading}
                        value={costPerCheckout == null ? 'No data' : fmtMoneyInr(costPerCheckout)}
                        delta={<TrendDelta current={costPerCheckout} previous={costPerCheckoutPrev} invert tone="caution" suffix={deltaSuffix} />} />
                </>}
                <Kpi label={hasMetaFunnel ? 'Purchases (Results)' : 'Conversions (Results)'} loading={kpiQ.loading}
                    value={num(k.ad_conversions) > 0 ? fmtNumCompact(k.ad_conversions) : 'No data'}
                    sub={hasMetaFunnel ? 'platform-reported — matches Meta &ldquo;Website purchases&rdquo;' : 'platform-reported — Google &ldquo;Results&rdquo;'}
                    delta={<TrendDelta current={k.ad_conversions} previous={p.ad_conversions} suffix={deltaSuffix} />} />
                <Kpi label={hasMetaFunnel ? 'Cost per purchase' : 'Cost per conversion'} loading={kpiQ.loading}
                    value={costPerPurchase == null ? 'No data' : fmtMoneyInr(costPerPurchase)}
                    delta={<TrendDelta current={costPerPurchase} previous={costPerPurchasePrev} invert tone="caution" suffix={deltaSuffix} />} />
                <Kpi label="CPM" loading={kpiQ.loading}
                    value={k.cpm == null ? 'No data' : fmtMoney(k.cpm)}
                    sub={num(k.cpm) > num(p.cpm) && num(p.cpm) > 0 ? 'rising · auction heat' : undefined}
                    delta={<TrendDelta current={k.cpm} previous={p.cpm} invert tone="caution" suffix={deltaSuffix} />} />
                <Kpi label="Impressions" loading={kpiQ.loading}
                    value={fmtNumCompact(k.ad_impressions)}
                    delta={<TrendDelta current={k.ad_impressions} previous={p.ad_impressions} suffix={deltaSuffix} />} />
            </div>

            {/* Funnel */}
            <ChartCard
                hideId="ad_funnel"
                title="Where the money leaks"
                subtitle="every step loses people — the step furthest below its healthy benchmark is the leak"
                loading={funnelQ.loading} error={funnelQ.error}
                empty={!funnelQ.loading && !funnelQ.error && num(fk.ad_impressions) === 0}
                right={
                    <div className="flex items-center gap-2">
                        {/* Number ↔ % of top-of-funnel toggle */}
                        <select
                            value={funnelMode}
                            onChange={(e) => setFunnelMode(e.target.value)}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                            title="Show absolute counts or % of the top of the funnel"
                        >
                            <option value="number">Number</option>
                            <option value="percent">% of top</option>
                        </select>
                        {/* Our custom per-card datepicker */}
                        <CardControls query={funnelQ} winCtrl={funnelWin} />
                    </div>
                }
                ask={{
                    rows: (funnel.stages || []).map((s, i) => ({
                        stage: s.label,
                        count: s.value,
                        step_rate: i > 0 ? funnel.steps?.[i - 1]?.rate ?? null : null,
                        is_leak: i > 0 && funnel.leak && funnel.steps?.[i - 1]?.key === funnel.leak.key,
                    })),
                    meta: { chartId: 'ad_funnel', window: windowLabel(funnelWin.window_), persona: 'Media buyer' },
                }}
            >
                {/* True tapering funnel (recharts): each stage a trapezoid sized to
                    its count. Cell labels show either the absolute count or the % of
                    the top-of-funnel (Saw the ad), per the Number/% toggle. The
                    step-to-step drop-offs — with the LEAK highlighted — are listed
                    below, since that diagnosis is the point of this card. */}
                <div style={{ height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <FunnelChart>
                            <RTooltip
                                formatter={(value, name) => {
                                    const top = num(funnel.stages?.[0]?.value)
                                    return funnelMode === 'percent'
                                        ? [top > 0 ? fmtPct(value / top) : '—', name]
                                        : [fmtNumCompact(value), name]
                                }}
                                contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
                            />
                            <Funnel
                                dataKey="value"
                                data={funnel.stages.map((s) => ({ name: s.label, value: num(s.value), fill: s.color }))}
                                isAnimationActive
                            >
                                <LabelList position="right" dataKey="name" fill="#0f172a" stroke="none" fontSize={12} />
                                <LabelList
                                    position="center"
                                    dataKey="value"
                                    formatter={(v) => {
                                        const top = num(funnel.stages?.[0]?.value)
                                        return funnelMode === 'percent'
                                            ? (top > 0 ? fmtPct(v / top) : '—')
                                            : fmtNumCompact(v)
                                    }}
                                    fill="#fff" stroke="none" fontSize={12} fontWeight={600}
                                />
                                {funnel.stages.map((s, i) => <Cell key={i} fill={s.color} />)}
                            </Funnel>
                        </FunnelChart>
                    </ResponsiveContainer>
                </div>
                {/* Step-to-step pass-through + the leak callout. */}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    {funnel.steps.map((step) => {
                        const isLeak = funnel.leak && step.key === funnel.leak.key
                        return (
                            <span key={step.key} className={`tabular-nums ${isLeak ? 'font-semibold text-red-600' : 'text-gray-500'}`}>
                                ↓ {step.rate == null ? 'not reported' : `${fmtPct(step.rate)} ${step.label}`}{isLeak ? ' — the leak' : ''}
                            </span>
                        )
                    })}
                </div>
            </ChartCard>

            {/* Per-campaign stage table */}
            <ChartCard
                hideId="campaign_stage_table"
                title="Every campaign, stage by stage"
                subtitle="read left → right · green good · amber watch · red weak"
                loading={campQ.loading} error={campQ.error}
                empty={!campQ.loading && !campQ.error && campaigns.length === 0}
                right={<CardControls query={campQ} winCtrl={campWin} />}
                ask={{ rows: campaigns, meta: { chartId: 'campaign_stage_table', window: windowLabel(campWin.window_), persona: 'Media buyer' } }}
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                                <th className="py-2 pr-3">Campaign</th>
                                <th className="py-2 px-3 text-right">Spend</th>
                                <th className="py-2 px-3 text-right">Click rate</th>
                                {hasMetaFunnel && <>
                                    <th className="py-2 px-3 text-right">Reach page</th>
                                    <th className="py-2 px-3 text-right">Page → cart</th>
                                    <th className="py-2 px-3 text-right">Checkouts</th>
                                </>}
                                <th className="py-2 px-3 text-right">{hasMetaFunnel ? 'Purchases' : 'Conversions'}</th>
                                <th className="py-2 pl-3 text-right">{hasMetaFunnel ? 'Cost / checkout' : 'Cost / conv.'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.map((c, i) => {
                                const cReach = ratio(c.ad_landing_page_views, c.total_ad_clicks)
                                const cAtc = ratio(c.ad_add_to_carts, c.ad_landing_page_views)
                                // Cost per result: checkout for Meta funnels, conversion for Google/leadgen.
                                const cCost = hasMetaFunnel
                                    ? ratio(c.total_ad_spend, c.ad_checkouts_initiated)
                                    : ratio(c.total_ad_spend, c.ad_conversions)
                                const avgCost = hasMetaFunnel ? avgCostPerCheckout : avgCostPerConversion
                                const cpcoCls = cCost == null || avgCost == null ? 'text-gray-400'
                                    : cCost > avgCost * 1.5 ? 'font-medium text-red-600'
                                        : cCost <= avgCost ? 'text-gray-700' : 'text-amber-600'
                                return (
                                    <tr key={c.ad_row__campaign_name || i} className="border-t border-gray-100">
                                        <td className="max-w-[220px] truncate py-2 pr-3 font-medium text-gray-700" title={c.ad_row__campaign_name}>
                                            {c.ad_row__campaign_name}
                                        </td>
                                        <td className="py-2 px-3 text-right tabular-nums text-gray-500">{fmtMoneyInr(c.total_ad_spend)}</td>
                                        <td className="py-2 px-3 text-right"><StageChip value={c.ctr == null ? null : num(c.ctr)} good={0.02} warn={0.01} /></td>
                                        {hasMetaFunnel && <>
                                            <td className="py-2 px-3 text-right"><StageChip value={cReach} good={0.6} warn={0.4} /></td>
                                            <td className="py-2 px-3 text-right"><StageChip value={cAtc} good={0.08} warn={0.04} /></td>
                                            <td className="py-2 px-3 text-right tabular-nums text-gray-500">{num(c.ad_checkouts_initiated) > 0 ? fmtNumCompact(c.ad_checkouts_initiated) : '—'}</td>
                                        </>}
                                        <td className="py-2 px-3 text-right tabular-nums font-medium text-gray-700">{num(c.ad_conversions) > 0 ? fmtNumCompact(c.ad_conversions) : '—'}</td>
                                        <td className={`py-2 pl-3 text-right tabular-nums ${cpcoCls}`}>{cCost == null ? '—' : fmtMoneyInr(cCost)}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                <p className="mt-3 text-[11px] text-gray-400">
                    {hasMetaFunnel ? (
                        <>
                            {avgCostPerCheckout != null && <>Cost / checkout coloured against the {fmtMoneyInr(avgCostPerCheckout)} account average · </>}
                            <b>Checkouts</b> = <i>initiate-checkout</i> events (a funnel step before the sale, so it&apos;s higher than purchases). <b>Purchases</b> = platform-reported conversions — the &ldquo;Results / Website purchases&rdquo; number Meta&apos;s own campaign view shows.
                        </>
                    ) : (
                        <>
                            {avgCostPerConversion != null && <>Cost / conv. coloured against the {fmtMoneyInr(avgCostPerConversion)} account average · </>}
                            <b>Conversions</b> = platform-reported conversions (Google &ldquo;Results&rdquo; — form fills / signups). Google Ads doesn&apos;t report the Meta-pixel add-to-cart / checkout funnel, so those steps are hidden for this account.
                        </>
                    )}
                </p>
            </ChartCard>

            {/* Recommendations */}
            {recs.length > 0 && (
                <div className="space-y-3">
                    {recs.map((r, i) => (
                        <div key={i} className="flex items-start gap-3 rounded-xl border border-orange-200 border-l-4 border-l-orange-500 bg-orange-50/50 px-4 py-3">
                            <span className="text-orange-600" aria-hidden="true">◆</span>
                            <div>
                                <div className="text-sm font-semibold text-gray-900">{r.title}</div>
                                <div className="mt-0.5 text-xs leading-relaxed text-gray-600">{r.body}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
