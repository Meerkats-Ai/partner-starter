/**
 * MarketerDashboard — weekly performance-marketer view.
 *
 * The core story: platform-REPORTED numbers vs Meerkats-CORRECTED numbers
 * (CDP-attributed revenue), plus saturation signals (CPM, frequency, CTR
 * decay). EVERYTHING comes from the semantic layer (/api/v1/metrics/query);
 * campaign-grain real ROAS uses the campaign_performance metrics.
 *
 * Visual language (matches the marketer prototype + FounderDashboard): flat
 * borderless KPI tiles, ALL performance colour is semantic (green good /
 * amber caution / red bad — roasColor bands), platform-claimed series render
 * DASHED RED vs corrected SOLID BLUE.
 *
 * Props: { admin, workspaceId } — same dual-surface pattern as CdpDashboard.
 */
import React, { useMemo } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import { useNavigate } from '@/lib/useNavigate'
import { useMetrics } from './useMetrics'
import { useMetricsWithDelta } from './useMetricsWithDelta'
import { ChartCard } from './ChartCard'
import TrendDelta from './TrendDelta'
import SignalCards, { deriveSignals } from './SignalCards'
import { lastFullWeek, thisWeekToDate, lastNDays, trailingWindow, splitWindow, windowLabel, grainFor } from './dateWindows'
import WindowSelector, { useWindow, useCardWindow, CardControls } from './WindowSelector'
import { useCampaignFilter } from './TableToolbar'
import { fmtMoney, fmtNum, fmtNumCompact, fmtPct, fmtDay, fmtWeek, fmtMoneyInr, roasColor, COLORS, SEMANTIC, SERIES } from './chartSetup'

const fmtRoas = (v) => (v == null || !isFinite(Number(v)) ? '—' : `${Number(v).toFixed(2)}×`)
const fmtRoasDelta = (d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}×`
const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0 }

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
function Kpi({ label, value, delta, sub, subCls = 'text-muted-foreground/70', loading }) {
    if (loading) {
        return (
            <div>
                <div className="text-sm text-muted-foreground">{label}</div>
                <div className="mt-2 animate-pulse space-y-2.5" aria-label="Loading">
                    <div className="h-7 w-24 rounded-md bg-muted" />
                    <div className="h-3 w-32 rounded bg-muted" />
                </div>
            </div>
        )
    }
    const noData = value === 'No data'
    return (
        <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className={`mt-1.5 leading-9 tracking-tight tabular-nums ${noData ? 'text-xl font-semibold text-muted-foreground/60' : 'text-[28px] font-bold text-foreground'}`}>{value}</div>
            {!noData && delta && <div className="mt-2">{delta}</div>}
            {sub && <div className={`mt-1 text-xs ${subCls}`}>{sub}</div>}
        </div>
    )
}

/**
 * Whether corrected (real) ROAS is actually KNOWN for a campaign.
 *
 * real_roas = CDP-attributed revenue ÷ spend. When attribution doesn't resolve
 * at campaign grain (the mart's canonical campaign names don't join to the
 * UTM-named attribution rows — see the campaign-grain join mismatch), attributed
 * revenue/orders come back 0, so real_roas is a bogus 0.00×. That's "unknown",
 * NOT "this campaign earned nothing" — so we render it as "—" and skip any
 * real-ROAS-based verdict, instead of screaming red 0.00× / Pause on every row.
 */
const hasRealRoas = (c) => num(c.campaign_attributed_revenue) > 0

/** Verdict rule for the campaign table (explicit, deterministic). */
function verdictOf(c, blendedRealRoas) {
    const real = num(c.real_roas)
    const freq = num(c.campaign_frequency)
    // No attributed revenue → real ROAS is unknown; don't Pause/Scale on it.
    if (!hasRealRoas(c)) {
        if (freq > 4) return { label: 'Refresh creative', cls: 'bg-warning/10 text-warning', kind: 'refresh' }
        return { label: 'No attribution', cls: 'bg-muted text-muted-foreground', kind: 'unknown' }
    }
    if (real >= Math.max(blendedRealRoas * 1.2, 1.5) && (freq === 0 || freq < 3)) {
        return { label: 'Scale now', cls: 'bg-success/10 text-success', kind: 'scale' }
    }
    if (real < 1) return { label: 'Pause / audit', cls: 'bg-destructive/10 text-destructive', kind: 'cut' }
    if (freq > 4) return { label: 'Refresh creative', cls: 'bg-warning/10 text-warning', kind: 'refresh' }
    return { label: 'Watch', cls: 'bg-warning/10 text-warning', kind: 'watch' }
}

// Frequency chip band: <3× fine, 3–4.5× warming, >4.5× fatigued.
const freqChip = (f) => (f > 4.5 ? 'bg-destructive/10 text-destructive' : f >= 3 ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success')

/**
 * BreakdownBars — a ranked list of segments, each a spend bar (width ∝ spend)
 * with its ROAS chip (semantic green/amber/red). Shared by the four Meta
 * breakdown cards. `rows` are semantic-layer rows; `label(r)` builds the segment
 * name, `spend(r)`/`roas(r)` pull the measures.
 */
function BreakdownBars({ rows, label, spend, roas, max, note }) {
    const maxSpend = max ?? Math.max(1, ...rows.map(spend))
    return (
        <div className="flex flex-col gap-2.5 pt-1">
            {note && <div className="text-[11px] text-muted-foreground/70">{note}</div>}
            {rows.map((r, i) => {
                const s = spend(r)
                const rv = roas(r)
                const hasRoas = rv != null && isFinite(Number(rv))
                return (
                    <div key={label(r) || i} className="flex items-center gap-2">
                        <div className="w-28 shrink-0 truncate text-xs text-muted-foreground" title={label(r)}>{label(r)}</div>
                        <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                            <div className="h-full rounded" style={{ width: `${(s / maxSpend) * 100}%`, background: hasRoas ? roasColor(Number(rv)) : 'hsl(var(--muted-foreground))' }} />
                        </div>
                        <div className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmtMoneyInr(s)}</div>
                        <div className="w-12 shrink-0 text-right text-xs font-medium tabular-nums" style={{ color: hasRoas ? roasColor(Number(rv)) : 'hsl(var(--muted-foreground))' }}>{fmtRoas(rv)}</div>
                    </div>
                )
            })}
        </div>
    )
}

export default function MarketerDashboard({ admin = false, workspaceId, platform = null, initialWindow = null, onWindowChange, controlsLeft = null }) {
    // Marketplace platforms (Flipkart, Amazon) — no buyer identity (CAC/new-customer),
    // no synced COGS (gross margin), no CDP attribution (real_roas is a bogus 0 — the
    // platform-reported value IS the real attributed value). Same tile/chart hiding for both.
    // No MER/orders tie to true revenue, no creative/adset layer; keep only the platform-reported
    // ad fundamentals (spend/impr/clicks/ROAS/CPM trend), hide the rest.
    const isMarketplace = platform === 'flipkart' || platform === 'amazon'
    const mOpts = { admin, workspaceId, platform }
    const navigate = useNavigate()
    const winCtrl = useWindow(resolveWindow, 'last_week', initialWindow, onWindowChange)
    const { window_, weekly } = winCtrl
    const deltaSuffix = weekly ? 'vs last week' : 'vs prev window'

    // ── KPI strip (current + previous window) ────────────────────────────────
    // SPLIT into two queries by grain so the platform filter (mOpts.platform) actually
    // applies. The ad-grain metrics (spend/impr/clicks/ctr/platform_reported_roas/cpm/
    // avg_frequency) go in adKpiQ — all 'ad' grain → platformWhere injects the
    // ad_row__platform filter → scoped to the selected platform (blended when 'All').
    // The cross-platform metrics (roas = blended MER, order_count) stay in kpiQ; they
    // have no platform dimension and are only meaningful blended. Mixing the two here
    // made platformWhere bail to null → blended + no refetch on platform switch.
    const kpiQ = useMetricsWithDelta(
        {
            metrics: ['roas', 'order_count'],
            ...window_,
        },
        mOpts,
    )
    const adKpiQ = useMetricsWithDelta(
        {
            metrics: [
                'total_ad_spend', 'ad_impressions', 'total_ad_clicks', 'ctr',
                'platform_reported_roas', 'cpm', 'avg_frequency',
            ],
            ...window_,
        },
        mOpts,
    )
    const k = { ...(kpiQ.rows[0] || {}), ...(adKpiQ.rows[0] || {}) }
    const p = { ...(kpiQ.prevRows[0] || {}), ...(adKpiQ.prevRows[0] || {}) }
    // NOTE: we intentionally do NOT compute a "gap" between platform_reported_roas
    // (ad-attributed) and roas/MER (total revenue incl. organic) — they use different
    // denominators, so subtracting them is meaningless. The meaningful gap is per
    // campaign: campaign_reported_roas vs real_roas (both ad-attributed) → roas_gap.
    const freqNow = num(k.avg_frequency)

    // ── ROAS trend: platform-claimed (dashed red) vs corrected (solid blue) ──
    // These cards each carry their own CardWindowControl and fetch on their own
    // date change; until overridden they follow the dashboard window_.
    // DEFAULT: 8 weeks ending at the dashboard window, weekly. OVERRIDDEN: honour
    // the picked start→end literally, DAILY buckets for short spans (else a 7-day
    // override collapses to a single weekly point).
    const roasTrendWin = useCardWindow(window_)
    const roasTrendRange = roasTrendWin.overridden
        ? roasTrendWin.window_
        : trailingWindow(56, roasTrendWin.window_.endDate)
    const roasTrendGrain = roasTrendWin.overridden ? grainFor(roasTrendRange) : { dim: 'metric_time__week_sun', daily: false }
    // KNOWN LIMITATION: this trend stays BLENDED across platforms even when one is
    // selected. It mixes roas ('other' grain — blended MER) with platform_reported_roas
    // ('ad' grain), so platformWhere() bails to null (no ad_row__platform join path for a
    // mixed series). Splitting into two separately-filtered queries is deferred — the MER
    // line is blended-only by definition anyway (total revenue isn't platform-attributed).
    const roasTrendQ = useMetrics(
        {
            metrics: ['roas', 'platform_reported_roas'],
            groupBy: [roasTrendGrain.dim], orderBy: [roasTrendGrain.dim],
            ...roasTrendRange,
        },
        mOpts,
    )

    // ── CPM + frequency trend (saturation) ──────────────────────────────────
    // DEFAULT: 4 weeks ending at the dashboard window, daily. OVERRIDDEN: honour
    // the picked start→end; daily stays daily for short/medium spans, weekly only
    // for long overrides.
    const satWin = useCardWindow(window_)
    const satRange = satWin.overridden ? satWin.window_ : trailingWindow(28, satWin.window_.endDate)
    const satGrain = satWin.overridden ? grainFor(satRange, 45) : { dim: 'metric_time__day', daily: true }
    const satQ = useMetrics(
        {
            metrics: ['cpm', 'avg_frequency'],
            groupBy: [satGrain.dim], orderBy: [satGrain.dim],
            ...satRange,
        },
        mOpts,
    )

    // ── Campaign table: reported vs real ─────────────────────────────────────
    // CORE query = metrics that have always existed. This drives the panel and
    // must never break. Delivery metrics (clicks/CTR) are NEWER — the deployed mart
    // may not have them yet — so they go in a SEPARATE fail-soft query below. If
    // that 400s (mart not rebuilt), the panel still renders, just without those
    // columns. This keeps a metric-add from ever breaking the whole panel.
    // The campaign breakdown table + the action list both read this window, so
    // one CardWindowControl on the breakdown card re-scopes both together.
    const campWin = useCardWindow(window_)
    // Per-user saved name filter (e.g. "DT_"), server-side via nameFilter so the
    // whole matching set returns (not just the top-15 by spend).
    const campFilter = useCampaignFilter('campaign_breakdown', 'campaign_row__campaign_name')
    const campNameFilter = campFilter.nameFilter ? { nameFilter: campFilter.nameFilter } : {}
    const campLimit = campFilter.active ? 200 : 15
    const campQ = useMetrics(
        {
            metrics: [
                'campaign_spend', 'campaign_impressions',
                'campaign_reported_roas', 'real_roas', 'roas_gap',
                'campaign_cpm', 'campaign_frequency', 'campaign_attributed_orders',
                'campaign_attributed_revenue', 'campaign_reported_value',
            ],
            groupBy: ['campaign_row__campaign_name'], orderBy: ['-campaign_spend'], limit: campLimit,
            ...campWin.window_, ...campNameFilter,
        },
        mOpts,
    )
    // Fail-soft delivery metrics (clicks + CTR). Merged into the core rows by
    // campaign name. On error (e.g. mart lacks the clicks column pre-rebuild), this
    // is simply empty and the columns show "—".
    const campDeliveryQ = useMetrics(
        {
            metrics: ['campaign_clicks', 'campaign_ctr'],
            groupBy: ['campaign_row__campaign_name'], limit: campLimit,
            ...campWin.window_, ...campNameFilter,
        },
        mOpts,
    )
    const deliveryByCampaign = React.useMemo(() => {
        const map = {}
        for (const r of (campDeliveryQ.rows || [])) map[r.campaign_row__campaign_name] = r
        return map
    }, [campDeliveryQ.rows])
    const campaigns = (campQ.rows || [])
        .filter((c) => num(c.campaign_spend) > 0)
        .map((c) => ({ ...c, ...(deliveryByCampaign[c.campaign_row__campaign_name] || {}) }))
    const totalSpend = campaigns.reduce((a, c) => a + num(c.campaign_spend), 0)
    const blendedRealRoas = totalSpend > 0
        ? campaigns.reduce((a, c) => a + num(c.campaign_attributed_revenue), 0) / totalSpend
        : 0

    // ── Attribution gap by platform: claimed vs delivered ────────────────────
    const gapWin = useCardWindow(window_)
    const gapQ = useMetrics(
        {
            metrics: ['campaign_reported_value', 'campaign_attributed_revenue', 'campaign_spend'],
            groupBy: ['campaign_row__platform'], orderBy: ['-campaign_spend'],
            ...gapWin.window_,
        },
        mOpts,
    )

    // ── Meta Insights breakdowns (age/gender · placement · geo · hourly) ─────
    // Meta-only segment facts from the semantic layer (fct_meta_*). ROAS/spend
    // grouped by a demographic / placement / geo / hour dimension. Gated on
    // platform==='meta' in the JSX; each card carries its own window override.
    const isMeta = platform === 'meta'
    const demoWin = useCardWindow(window_)
    const demoQ = useMetrics(
        {
            metrics: ['meta_demo_roas', 'meta_demo_spend', 'meta_demo_revenue'],
            groupBy: ['meta_demo_row__age', 'meta_demo_row__gender'],
            orderBy: ['-meta_demo_spend'], limit: 24, ...demoWin.window_,
        },
        mOpts,
    )
    const placementWin = useCardWindow(window_)
    const placementQ = useMetrics(
        {
            metrics: ['meta_placement_roas', 'meta_placement_spend', 'meta_placement_revenue'],
            groupBy: ['meta_placement_row__publisher_platform', 'meta_placement_row__platform_position'],
            orderBy: ['-meta_placement_spend'], limit: 12, ...placementWin.window_,
        },
        mOpts,
    )
    const geoWin = useCardWindow(window_)
    const geoQ = useMetrics(
        {
            metrics: ['meta_geo_roas', 'meta_geo_spend', 'meta_geo_revenue'],
            // geo_level='region' → sub-national rows (country rows carry region='all').
            // We show region-level detail; filtering happens client-side below.
            groupBy: ['meta_geo_row__geo_level', 'meta_geo_row__region'],
            orderBy: ['-meta_geo_spend'], limit: 40, ...geoWin.window_,
        },
        mOpts,
    )
    const hourlyWin = useCardWindow(window_)
    const hourlyQ = useMetrics(
        {
            metrics: ['meta_hourly_spend', 'meta_hourly_roas', 'meta_hourly_revenue'],
            groupBy: ['meta_hourly_row__hour_of_day'],
            orderBy: ['meta_hourly_row__hour_of_day'], limit: 24, ...hourlyWin.window_,
        },
        mOpts,
    )

    // ── Creative fatigue: top adsets, frequency band + CTR decay ────────────
    const [firstHalf, secondHalf] = useMemo(() => splitWindow(window_), [window_])
    const adsetBody = (w) => ({
        metrics: ['ctr', 'avg_frequency', 'total_ad_spend', 'ad_impressions'],
        groupBy: ['ad_row__adgroup_id'], orderBy: ['-total_ad_spend'], limit: 25, ...w,
    })
    const adsetA = useMetrics(adsetBody(firstHalf), mOpts)
    const adsetB = useMetrics(adsetBody(secondHalf), mOpts)
    const adsets = useMemo(() => {
        const first = new Map((adsetA.rows || []).map((r) => [r.ad_row__adgroup_id, r]))
        return (adsetB.rows || [])
            .filter((r) => r.ad_row__adgroup_id && num(r.total_ad_spend) > 0)
            .map((r) => {
                const prev = first.get(r.ad_row__adgroup_id)
                const ctrPrev = prev ? num(prev.ctr) : 0
                const ctrNow = num(r.ctr)
                return {
                    adgroup: r.ad_row__adgroup_id,
                    freq: num(r.avg_frequency),
                    ctrNow,
                    ctrDrop: ctrPrev > 0 ? (ctrPrev - ctrNow) / ctrPrev : 0,
                    spend: num(r.total_ad_spend),
                }
            })
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 6)
    }, [adsetA.rows, adsetB.rows])
    const fatigued = adsets.filter((r) => r.freq > 3.5 && r.ctrDrop > 0.2)

    // ── Signals + prioritized action list ────────────────────────────────────
    const signals = useMemo(() => deriveSignals({ kpis: k, prevKpis: p, campaigns }), [k, p, campaigns])
    const actions = useMemo(() => {
        const list = []
        for (const c of campaigns) {
            const v = verdictOf(c, blendedRealRoas)
            if (v.kind === 'cut') {
                list.push({ action: `Pause or audit "${c.campaign_row__campaign_name}" — real ROAS ${fmtRoas(c.real_roas)}`, where: 'Ads Manager', eta: 'Today', impact: num(c.campaign_spend) })
            } else if (v.kind === 'scale') {
                list.push({ action: `Scale "${c.campaign_row__campaign_name}" — ${fmtRoas(c.real_roas)} real on ${fmtPct(num(c.campaign_spend) / totalSpend)} of spend`, where: 'Ads Manager', eta: 'Today', impact: num(c.campaign_spend) })
            } else if (v.kind === 'refresh') {
                list.push({ action: `Refresh creative on "${c.campaign_row__campaign_name}" — frequency ${num(c.campaign_frequency).toFixed(1)}×`, where: 'Creative', eta: 'This week', impact: num(c.campaign_spend) })
            }
        }
        for (const f of fatigued.slice(0, 2)) {
            list.push({ action: `Adset ${f.adgroup}: CTR down ${fmtPct(f.ctrDrop)} at ${f.freq.toFixed(1)}× frequency — rotate creative`, where: 'Creative', eta: 'This week', impact: f.spend })
        }
        return list.sort((a, b) => b.impact - a.impact).slice(0, 6)
    }, [campaigns, blendedRealRoas, fatigued, totalSpend])

    return (
        <div className="space-y-8">
            {/* Controls row — platform filter (from the cockpit) + date picker */}
            <div className="flex flex-wrap items-center gap-2.5">
                {controlsLeft}
                <WindowSelector presets={WINDOWS} ctrl={winCtrl} suffix="" />
            </div>

            {/* KPI strip — 8 flat tiles */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
                <Kpi label="Total spend" loading={adKpiQ.loading} value={fmtMoneyInr(k.total_ad_spend)}
                    delta={<TrendDelta current={k.total_ad_spend} previous={p.total_ad_spend} invert tone="caution" suffix={deltaSuffix} />} />
                <Kpi label="Impressions" loading={adKpiQ.loading} value={fmtNumCompact(k.ad_impressions)}
                    sub={`CTR ${fmtPct(k.ctr)}`}
                    delta={<TrendDelta current={k.ad_impressions} previous={p.ad_impressions} suffix={deltaSuffix} />} />
                <Kpi label="Clicks" loading={adKpiQ.loading} value={fmtNumCompact(k.total_ad_clicks)}
                    delta={<TrendDelta current={k.total_ad_clicks} previous={p.total_ad_clicks} suffix={deltaSuffix} />} />
                <Kpi label="Platform-reported ROAS" loading={adKpiQ.loading} value={fmtRoas(k.platform_reported_roas)}
                    sub="ad-attributed revenue ÷ spend (platform pixel)"
                    delta={<TrendDelta current={k.platform_reported_roas} previous={p.platform_reported_roas} fmtAbs={fmtRoasDelta} suffix={deltaSuffix} />} />
                {/* 2nd KPI row — MER / Orders(attributed) / CPM / Frequency. All lean on
                    true store revenue, CDP-attributed orders, or Meta creative delivery —
                    none meaningful for a marketplace. Hidden for Flipkart. */}
                {!isMarketplace && (<>
                {/* MER is TOTAL revenue (incl. organic/direct) ÷ spend — a DIFFERENT
                    denominator than platform ROAS (which is ad-attributed only), so it
                    is NOT a "corrected" version of the platform number and the two are
                    not directly comparable. MER > platform ROAS is normal and simply
                    means organic revenue is large relative to ad-attributed. Labelled
                    plainly so no one reads it as "the platform number, fixed". */}
                <Kpi label="MER (all revenue ÷ spend)" loading={kpiQ.loading} value={fmtRoas(k.roas)}
                    sub="total store revenue, incl. organic — not ad-attributed"
                    delta={<TrendDelta current={k.roas} previous={p.roas} fmtAbs={fmtRoasDelta} suffix={deltaSuffix} />} />
                <Kpi label="Orders (attributed)" loading={kpiQ.loading} value={fmtNumCompact(k.order_count)}
                    delta={<TrendDelta current={k.order_count} previous={p.order_count} suffix={deltaSuffix} />} />
                <Kpi label="CPM" loading={adKpiQ.loading} value={fmtMoney(k.cpm)}
                    sub={num(k.cpm) > num(p.cpm) && num(p.cpm) > 0 ? 'rising · auction heat' : undefined}
                    delta={<TrendDelta current={k.cpm} previous={p.cpm} invert tone="caution" suffix={deltaSuffix} />} />
                <Kpi label="Frequency" loading={adKpiQ.loading} value={freqNow ? `${freqNow.toFixed(1)}×` : 'No data'}
                    sub={freqNow > 3.5 ? '⚠ above 3.5× fatigue zone' : freqNow ? 'impressions-weighted daily avg (Meta)' : undefined}
                    subCls={freqNow > 3.5 ? 'text-destructive font-medium' : 'text-muted-foreground/70'}
                    delta={<TrendDelta current={k.avg_frequency} previous={p.avg_frequency} invert suffix={deltaSuffix} />} />
                </>)}
            </div>

            {/* Trends — Platform ROAS vs MER (needs true revenue) + CPM & frequency
                (Meta creative delivery). Neither applies to Flipkart → whole row hidden. */}
            {!isMarketplace && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:[&>*:only-child]:col-span-2">
                <ChartCard
                    hideId="roas_trend"
                    title={roasTrendWin.overridden ? 'Platform ROAS vs MER' : 'Platform ROAS vs MER — 8 weeks'}
                    subtitle={`ad-attributed ROAS (dashed) vs total-revenue MER (solid) · ${roasTrendGrain.daily ? 'daily' : 'weekly'}${roasTrendWin.overridden ? ` · ${windowLabel(roasTrendRange)}` : ''} · different denominators`}
                    loading={roasTrendQ.loading} error={roasTrendQ.error}
                    empty={!roasTrendQ.loading && !roasTrendQ.error && (roasTrendQ.rows || []).length === 0}
                    right={<CardControls query={roasTrendQ} winCtrl={roasTrendWin} />}
                    ask={{ rows: roasTrendQ.rows, meta: { chartId: 'roas_trend', window: roasTrendWin.overridden ? windowLabel(roasTrendRange) : '8 weeks', persona: 'Growth lead' } }}
                >
                    <Line
                        data={{
                            labels: (roasTrendQ.rows || []).map((r) => (roasTrendGrain.daily ? fmtDay(r[roasTrendGrain.dim]) : fmtWeek(r[roasTrendGrain.dim]))),
                            datasets: [
                                {
                                    label: 'MER (total rev ÷ spend)',
                                    data: (roasTrendQ.rows || []).map((r) => num(r.roas)),
                                    borderColor: 'hsl(var(--chart-2))', backgroundColor: 'hsl(var(--chart-2))',
                                    pointRadius: 3, pointBackgroundColor: 'hsl(var(--chart-2))',
                                    tension: 0.35, fill: false,
                                },
                                {
                                    label: 'Platform ROAS',
                                    data: (roasTrendQ.rows || []).map((r) => num(r.platform_reported_roas)),
                                    borderColor: SEMANTIC.bad, backgroundColor: SEMANTIC.bad,
                                    borderDash: [5, 4], pointRadius: 3, pointBackgroundColor: SEMANTIC.bad,
                                    tension: 0.35, fill: false,
                                },
                            ],
                        }}
                        options={{
                            responsive: true, maintainAspectRatio: false,
                            interaction: { mode: 'index', intersect: false },
                            plugins: {
                                legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
                                tooltip: { padding: 8, boxPadding: 4, callbacks: { label: (c) => `${c.dataset.label}: ${fmtRoas(c.parsed.y)}` } },
                            },
                            scales: {
                                x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 11 } } },
                                y: { grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 11 }, callback: (v) => `${v}×` } },
                            },
                        }}
                    />
                </ChartCard>
                <ChartCard
                    hideId="cpm_frequency_trend"
                    title="CPM & frequency trend"
                    subtitle={`audience-saturation signals · ${satGrain.daily ? 'daily' : 'weekly'} · ${windowLabel(satRange)}`}
                    loading={satQ.loading} error={satQ.error}
                    empty={!satQ.loading && !satQ.error && (satQ.rows || []).length === 0}
                    right={<CardControls query={satQ} winCtrl={satWin} />}
                    ask={{ rows: satQ.rows, meta: { chartId: 'cpm_frequency_trend', window: windowLabel(satRange), persona: 'Growth lead' } }}
                >
                    <Line
                        data={{
                            labels: (satQ.rows || []).map((r) => (satGrain.daily ? fmtDay(r[satGrain.dim]) : fmtWeek(r[satGrain.dim]))),
                            datasets: [
                                {
                                    label: 'CPM (₹)',
                                    data: (satQ.rows || []).map((r) => num(r.cpm)),
                                    borderColor: SEMANTIC.warn, backgroundColor: SEMANTIC.warn,
                                    pointRadius: 2, pointBackgroundColor: SEMANTIC.warn,
                                    tension: 0.35, fill: false, yAxisID: 'y',
                                },
                                {
                                    label: 'Frequency',
                                    data: (satQ.rows || []).map((r) => num(r.avg_frequency)),
                                    borderColor: 'hsl(var(--chart-3))', backgroundColor: 'hsl(var(--chart-3))',
                                    pointRadius: 2, pointBackgroundColor: 'hsl(var(--chart-3))',
                                    tension: 0.35, fill: false, yAxisID: 'y1',
                                },
                            ],
                        }}
                        options={{
                            responsive: true, maintainAspectRatio: false,
                            interaction: { mode: 'index', intersect: false },
                            plugins: {
                                legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
                                tooltip: { padding: 8, boxPadding: 4 },
                            },
                            scales: {
                                x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 11 } } },
                                y: { position: 'left', grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: SEMANTIC.warn, font: { size: 11 }, callback: (v) => fmtMoney(v) } },
                                y1: { position: 'right', grid: { display: false }, beginAtZero: true, ticks: { color: 'hsl(var(--chart-3))', font: { size: 11 }, callback: (v) => `${v}×` } },
                            },
                        }}
                    />
                </ChartCard>
            </div>
            )}

            {/* Campaign breakdown */}
            <ChartCard
                hideId="campaign_breakdown"
                title="Campaign breakdown" subtitle={`delivery + corrected ROAS · ${windowLabel(campWin.window_)}`}
                loading={campQ.loading} error={campQ.error}
                empty={!campQ.loading && !campQ.error && campaigns.length === 0}
                right={<>{campFilter.control}<CardControls
                    query={{ refetch: () => { campQ.refetch(); campDeliveryQ.refetch() }, loading: campQ.loading || campDeliveryQ.loading }}
                    winCtrl={campWin} /></>}
                ask={{ rows: campaigns, meta: { chartId: 'campaign_breakdown', window: windowLabel(campWin.window_), persona: 'Growth lead' } }}
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground/70">
                                <th className="py-2 pr-3">Campaign</th>
                                <th className="py-2 px-3 text-right">Spend</th>
                                <th className="py-2 px-3 text-right">Spend %</th>
                                <th className="py-2 px-3 text-right">Impr.</th>
                                <th className="py-2 px-3 text-right">Clicks</th>
                                <th className="py-2 px-3 text-right">CTR</th>
                                <th className="py-2 px-3 text-right">Plat. ROAS</th>
                                <th className="py-2 px-3 text-right">Real ROAS</th>
                                <th className="py-2 px-3 text-right">Gap</th>
                                <th className="py-2 px-3 text-right">Freq.</th>
                                <th className="py-2 px-3 text-right">Orders</th>
                                <th className="py-2 pl-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.map((c, i) => {
                                const v = verdictOf(c, blendedRealRoas)
                                const gap = num(c.roas_gap)
                                const freq = num(c.campaign_frequency)
                                // real ROAS (and therefore the reported-vs-real gap) is only
                                // meaningful when attribution resolved for this campaign.
                                const realKnown = hasRealRoas(c)
                                return (
                                    <tr key={c.campaign_row__campaign_name || i} className="border-t border-border">
                                        <td className="max-w-[220px] truncate py-2 pr-3 font-medium text-foreground" title={c.campaign_row__campaign_name}>
                                            {c.campaign_row__campaign_name || '(unknown)'}
                                        </td>
                                        <td className="py-2 px-3 text-right tabular-nums text-foreground">{fmtMoneyInr(c.campaign_spend)}</td>
                                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{totalSpend ? fmtPct(num(c.campaign_spend) / totalSpend) : '—'}</td>
                                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{num(c.campaign_impressions) ? fmtNumCompact(c.campaign_impressions) : '—'}</td>
                                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{num(c.campaign_clicks) ? fmtNumCompact(c.campaign_clicks) : '—'}</td>
                                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{num(c.campaign_impressions) ? fmtPct(c.campaign_ctr) : '—'}</td>
                                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{fmtRoas(c.campaign_reported_roas)}</td>
                                        <td className="py-2 px-3 text-right tabular-nums font-semibold"
                                            style={{ color: realKnown ? roasColor(c.real_roas) : undefined }}
                                            title={realKnown ? undefined : 'No CDP-attributed revenue for this campaign — real ROAS can’t be computed'}>
                                            {realKnown ? fmtRoas(c.real_roas) : <span className="text-muted-foreground/60">—</span>}
                                        </td>
                                        <td className={`py-2 px-3 text-right tabular-nums ${realKnown && gap > 0.3 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                                            {realKnown && gap ? `${gap > 0 ? '+' : ''}${gap.toFixed(2)}×` : '—'}
                                        </td>
                                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{freq ? `${freq.toFixed(1)}×` : '—'}</td>
                                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{realKnown ? fmtNum(c.campaign_attributed_orders) : <span className="text-muted-foreground/60">—</span>}</td>
                                        <td className="py-2 pl-3 text-right">
                                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${v.cls}`}>{v.label}</span>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </ChartCard>

            {/* Creative fatigue (Meta adset delivery) + attribution gap (CDP-delivered
                vs platform claim). Neither exists for a marketplace → hidden for Flipkart. */}
            {!isMarketplace && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:[&>*:only-child]:col-span-2">
                <ChartCard
                    hideId="creative_fatigue"
                    title="Creative fatigue by adset" subtitle="frequency band · CTR trend (second half vs first half of window)"
                    loading={adsetA.loading || adsetB.loading} error={adsetB.error}
                    empty={!adsetA.loading && !adsetB.loading && adsets.length === 0}
                    ask={{ rows: adsets, meta: { window: windowLabel(window_), persona: 'Growth lead' } }}
                >
                    <div className="flex flex-col divide-y divide-border pt-1">
                        {adsets.map((f) => (
                            <div key={f.adgroup} className="flex items-center justify-between gap-3 py-2">
                                <div className="truncate text-sm text-foreground" title={f.adgroup}>{f.adgroup}</div>
                                <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
                                    <span className={`rounded-full px-2 py-0.5 font-semibold ${freqChip(f.freq)}`}>
                                        {f.freq ? `${f.freq.toFixed(1)}×` : '—'}
                                    </span>
                                    <span className="text-muted-foreground">CTR {fmtPct(f.ctrNow)}</span>
                                    {f.ctrDrop > 0.2 && <span className="font-medium text-destructive">↘ {fmtPct(f.ctrDrop)}</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                </ChartCard>

                <ChartCard
                    hideId="attribution_gap"
                    title="Attribution gap by channel" subtitle="platform claim vs Meerkats corrected (CDP-delivered)"
                    loading={gapQ.loading} error={gapQ.error}
                    right={<CardControls query={gapQ} winCtrl={gapWin} />}
                    ask={{ rows: gapQ.rows, meta: { chartId: 'attribution_gap', window: windowLabel(gapWin.window_), persona: 'Growth lead' } }}
                    empty={!gapQ.loading && !gapQ.error && (gapQ.rows || []).length === 0}
                >
                    <div className="flex flex-col gap-4 pt-1">
                        {(gapQ.rows || []).filter((r) => num(r.campaign_spend) > 0 || num(r.campaign_attributed_revenue) > 0).map((r, i) => {
                            const claimed = num(r.campaign_reported_value)
                            const delivered = num(r.campaign_attributed_revenue)
                            const max = Math.max(claimed, delivered, 1)
                            return (
                                <div key={r.campaign_row__platform || i} className="space-y-1">
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-xs font-medium capitalize text-muted-foreground">{r.campaign_row__platform}</span>
                                        {claimed > delivered && delivered >= 0 && (
                                            <span className="text-[11px] font-medium text-destructive">claim +{fmtMoneyInr(claimed - delivered)}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-16 shrink-0 text-[11px] text-muted-foreground/70">claimed</div>
                                        <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                                            <div className="h-full rounded" style={{ width: `${(claimed / max) * 100}%`, background: 'hsl(var(--chart-2))' }} />
                                        </div>
                                        <div className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmtMoneyInr(claimed)}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-16 shrink-0 text-[11px] text-muted-foreground/70">delivered</div>
                                        <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                                            <div className="h-full rounded" style={{ width: `${(delivered / max) * 100}%`, background: SEMANTIC.good }} />
                                        </div>
                                        <div className="w-20 shrink-0 text-right text-xs tabular-nums text-foreground">{fmtMoneyInr(delivered)}</div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </ChartCard>
            </div>
            )}

            {/* Meta Insights breakdowns — Meta-only segment ROAS/spend (age·gender,
                placement, geo, hour). From fct_meta_* in the semantic layer. Bars
                scaled by spend, coloured + chipped by ROAS. Two 2-col rows. */}
            {isMeta && (<>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:[&>*:only-child]:col-span-2">
                <ChartCard
                    hideId="meta_by_demographic"
                    title="ROAS by age & gender" subtitle="Meta reported · bar = spend · colour = ROAS"
                    loading={demoQ.loading} error={demoQ.error}
                    right={<CardControls query={demoQ} winCtrl={demoWin} />}
                    ask={{ rows: demoQ.rows, meta: { chartId: 'meta_by_demographic', window: windowLabel(demoWin.window_), persona: 'Growth lead' } }}
                    empty={!demoQ.loading && !demoQ.error && (demoQ.rows || []).filter((r) => num(r.meta_demo_spend) > 0).length === 0}
                >
                    <BreakdownBars
                        rows={(demoQ.rows || []).filter((r) => num(r.meta_demo_spend) > 0).slice(0, 12)}
                        label={(r) => `${r.meta_demo_row__age || '?'} · ${r.meta_demo_row__gender || '?'}`}
                        spend={(r) => num(r.meta_demo_spend)}
                        roas={(r) => (num(r.meta_demo_revenue) > 0 ? r.meta_demo_roas : null)}
                    />
                </ChartCard>

                <ChartCard
                    hideId="meta_by_placement"
                    title="ROAS by placement" subtitle="platform × position · bar = spend · colour = ROAS"
                    loading={placementQ.loading} error={placementQ.error}
                    right={<CardControls query={placementQ} winCtrl={placementWin} />}
                    ask={{ rows: placementQ.rows, meta: { chartId: 'meta_by_placement', window: windowLabel(placementWin.window_), persona: 'Growth lead' } }}
                    empty={!placementQ.loading && !placementQ.error && (placementQ.rows || []).filter((r) => num(r.meta_placement_spend) > 0).length === 0}
                >
                    <BreakdownBars
                        rows={(placementQ.rows || []).filter((r) => num(r.meta_placement_spend) > 0).slice(0, 12)}
                        label={(r) => `${r.meta_placement_row__publisher_platform || '?'} · ${r.meta_placement_row__platform_position || '?'}`}
                        spend={(r) => num(r.meta_placement_spend)}
                        roas={(r) => (num(r.meta_placement_revenue) > 0 ? r.meta_placement_roas : null)}
                    />
                </ChartCard>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:[&>*:only-child]:col-span-2">
                <ChartCard
                    hideId="meta_by_geo"
                    title="ROAS by region" subtitle="Meta reported · top regions by spend · colour = ROAS"
                    loading={geoQ.loading} error={geoQ.error}
                    right={<CardControls query={geoQ} winCtrl={geoWin} />}
                    ask={{ rows: geoQ.rows, meta: { chartId: 'meta_by_geo', window: windowLabel(geoWin.window_), persona: 'Growth lead' } }}
                    empty={!geoQ.loading && !geoQ.error && (geoQ.rows || []).filter((r) => r.meta_geo_row__geo_level === 'region' && num(r.meta_geo_spend) > 0).length === 0}
                >
                    <BreakdownBars
                        rows={(geoQ.rows || []).filter((r) => r.meta_geo_row__geo_level === 'region' && num(r.meta_geo_spend) > 0).slice(0, 12)}
                        label={(r) => r.meta_geo_row__region || 'unknown'}
                        spend={(r) => num(r.meta_geo_spend)}
                        roas={(r) => (num(r.meta_geo_revenue) > 0 ? r.meta_geo_roas : null)}
                    />
                </ChartCard>

                <ChartCard
                    hideId="meta_by_hourly"
                    title="Spend & ROAS by hour" subtitle="hour of day (ad account TZ) · dayparting"
                    loading={hourlyQ.loading} error={hourlyQ.error}
                    right={<CardControls query={hourlyQ} winCtrl={hourlyWin} />}
                    ask={{ rows: hourlyQ.rows, meta: { chartId: 'meta_by_hourly', window: windowLabel(hourlyWin.window_), persona: 'Growth lead' } }}
                    empty={!hourlyQ.loading && !hourlyQ.error && (hourlyQ.rows || []).filter((r) => num(r.meta_hourly_spend) > 0).length === 0}
                >
                    <Bar
                        data={{
                            labels: (hourlyQ.rows || []).map((r) => `${String(r.meta_hourly_row__hour_of_day).padStart(2, '0')}h`),
                            datasets: [{
                                label: 'Spend',
                                data: (hourlyQ.rows || []).map((r) => num(r.meta_hourly_spend)),
                                backgroundColor: (hourlyQ.rows || []).map((r) => (num(r.meta_hourly_revenue) > 0 ? roasColor(num(r.meta_hourly_roas)) : 'hsl(var(--muted-foreground))')),
                                borderRadius: 3,
                            }],
                        }}
                        options={{
                            responsive: true, maintainAspectRatio: false,
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) => {
                                            const r = (hourlyQ.rows || [])[ctx.dataIndex] || {}
                                            const roasTxt = num(r.meta_hourly_revenue) > 0 ? ` · ROAS ${fmtRoas(r.meta_hourly_roas)}` : ''
                                            return `${fmtMoneyInr(num(r.meta_hourly_spend))}${roasTxt}`
                                        },
                                    },
                                },
                            },
                            scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => fmtMoneyInr(v) } } },
                        }}
                    />
                </ChartCard>
            </div>
            </>)}

            {/* WHAT HAPPENED · WHY · WHAT TO DO + action list — signal rules lean on
                creative fatigue + attribution gap, which Flipkart lacks → hidden. */}
            {!isMarketplace && (<>
            <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    What happened · why · what to do
                </div>
                <SignalCards signals={signals} loading={kpiQ.loading || adKpiQ.loading || campQ.loading} />
            </div>

            {/* Action list */}
            <ChartCard
                hideId="weekly_action_list"
                title="This week's action list" subtitle="prioritised by spend at stake"
                loading={campQ.loading} error={campQ.error}
                empty={!campQ.loading && actions.length === 0}
                ask={{ rows: actions, meta: { chartId: 'campaign_breakdown', window: windowLabel(window_), persona: 'Growth lead' } }}
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground/70">
                                <th className="py-2 pr-3 w-8">#</th>
                                <th className="py-2 pr-3">Action</th>
                                <th className="py-2 px-3">Where</th>
                                <th className="py-2 px-3 text-right">Spend at stake</th>
                                <th className="py-2 pl-3 text-right">ETA</th>
                            </tr>
                        </thead>
                        <tbody>
                            {actions.map((a, i) => (
                                <tr key={i} className="border-t border-border">
                                    <td className="py-2 pr-3 text-muted-foreground/70">{i + 1}</td>
                                    <td className="py-2 pr-3 font-medium text-foreground">{a.action}</td>
                                    <td className="py-2 px-3 text-muted-foreground">{a.where}</td>
                                    <td className="py-2 px-3 text-right tabular-nums text-foreground">{fmtMoneyInr(a.impact)}</td>
                                    <td className="py-2 pl-3 text-right">
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.eta === 'Today' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                                            {a.eta}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </ChartCard>
            </>)}

        </div>
    )
}
