/**
 * FounderDashboard — weekly founder view: what happened · why · what to do.
 *
 * EVERY number comes from the semantic layer (/api/v1/metrics/query — dbt +
 * MetricFlow). No CDP reads. Campaign/channel "real ROAS" uses the
 * campaign_performance metrics (spend + CDP-attributed revenue pre-joined at
 * campaign grain in the mart, so the ratio is groupable by campaign/platform).
 *
 * Visual language (matches the founder-view prototype): KPI tiles are flat
 * (borderless) with dark values; ALL performance colour is semantic —
 * green = good, amber = caution, red = bad (roasColor bands) — never the
 * rotating SERIES palette.
 *
 * Props (same dual-surface pattern as CdpDashboard):
 *   admin        — use the /admin/* metrics endpoints (cross-workspace)
 *   workspaceId  — required in admin mode
 */
import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import { useMetrics } from './useMetrics'
import { useMetricsWithDelta } from './useMetricsWithDelta'
import { ChartCard } from './ChartCard'
import CohortCard from './CohortCard'
import cdpApi from '@/lib/cdpApi'
import TrendDelta, { TrendDeltaPoints } from './TrendDelta'
import SignalCards, { deriveSignals } from './SignalCards'
import { lastFullWeek, thisWeekToDate, lastNDays, windowLabel, grainFor } from './dateWindows'
import WindowSelector, { useWindow, useCardWindow, CardControls } from './WindowSelector'
import { useCampaignFilter } from './TableToolbar'
import { useWorkspace } from '@/lib/useWorkspace'
import { fmtMoney, fmtNum, fmtNumCompact, fmtPct, fmtDay, fmtWeek, fmtMoneyInr, roasColor, COLORS, SEMANTIC } from './chartSetup'

const fmtRoas = (v) => (v == null || !isFinite(Number(v)) ? '—' : `${Number(v).toFixed(2)}×`)
const fmtRoasDelta = (d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}×`
const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0 }

const WINDOWS = [
    { value: 'last_week', label: 'Last full week' },
    { value: 'this_week', label: 'This week' },
    { value: 'last_4_weeks', label: 'Last 4 weeks' },
]

// Leadgen workspaces (no Shopify orders — the conversion is a form submission).
// For these the Cockpit swaps the ecommerce tiles (Orders / New customers / CAC /
// Gross margin / RTO) for lead-conversion tiles fed by the leadgen semantic metrics
// (form_conversions / cost_per_form_conversion / unique_lead_converters).
// Hardcoded by workspace id for now — Progen is currently the only leadgen tenant.
// When a second one appears, replace this with the workspace's commerce_platform
// === 'none' config (cdp.workspace_config, exposed via getCommerceConfig) instead.
const LEADGEN_WORKSPACE_IDS = new Set([
    'd3165b14-4b24-4afd-aa61-d86861a8360b',
    '281af871-70a3-4b42-aab8-31001b4cfa1a', // Progen (weightloss leadgen)
])

// Resolve THIS dashboard's own presets to a { startDate, endDate } window. The
// shared selector appends "Custom range" and handles that case itself.
const resolveWindow = (win) => {
    if (win === 'this_week') return thisWeekToDate()
    if (win === 'last_4_weeks') return lastNDays(28)
    return lastFullWeek()
}

// Flat prototype-style KPI tile — sentence-case grey label, dark bold value,
// semantic delta line. No border/card chrome. While loading it renders a shimmer
// and suppresses delta/sub entirely (stale subs from the previous window must
// never show against a new window's numbers). value === 'No data' renders muted
// with no delta.
function Kpi({ label, value, delta, sub, loading }) {
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
            {sub && <div className="mt-1 text-xs text-muted-foreground/70">{sub}</div>}
        </div>
    )
}

export default function FounderDashboard({ admin = false, workspaceId, platform = null, initialWindow = null, onWindowChange, controlsLeft = null }) {
    const mOpts = { admin, workspaceId, platform }
    // Marketplace platforms (Flipkart, Amazon) — no buyer identity (CAC/new-customer),
    // no synced COGS (gross margin), no CDP attribution (real_roas is a bogus 0 — the
    // platform-reported value IS the real attributed value). Same tile/chart hiding for both.
    // Also no per-buyer cohort; hide those tiles/charts entirely rather than show misleading "No data".
    const isMarketplace = platform === 'flipkart' || platform === 'amazon'
    // Leadgen workspace? In admin mode the workspaceId prop is authoritative; in
    // user mode fall back to the current workspace from context. Leadgen swaps the
    // Shopify order tiles for lead-conversion tiles (see LEADGEN_WORKSPACE_IDS).
    const { currentWorkspace } = useWorkspace()
    const effectiveWsId = workspaceId || currentWorkspace?.id
    const isLeadgen = !!effectiveWsId && LEADGEN_WORKSPACE_IDS.has(effectiveWsId)
    const winCtrl = useWindow(resolveWindow, 'last_week', initialWindow, onWindowChange)
    const { window_, weekly } = winCtrl
    const [copied, setCopied] = useState(false)

    // ── Cohort matrix (CDP read layer, all-time — not window-scoped) ────────
    // Retention / LTV / total sales / # customers by acquisition cohort. Grain
    // (month|week) is a user toggle on the card; changing it re-fetches.
    const [cohortGrain, setCohortGrain] = useState('month')
    const [cohorts, setCohorts] = useState({ rows: null, loading: true, error: null })
    const loadCohorts = useCallback(async () => {
        setCohorts((s) => ({ ...s, loading: true, error: null }))
        try {
            const ws = admin ? (workspaceId || undefined) : undefined
            const res = admin ? await cdpApi.getCohorts(ws, cohortGrain) : await cdpApi.cdp.getCohorts(cohortGrain)
            setCohorts({ rows: res.data?.rows || [], loading: false, error: null })
        } catch (e) {
            setCohorts({ rows: [], loading: false, error: e.response?.data?.error || e.message })
        }
    }, [admin, workspaceId, cohortGrain])
    useEffect(() => { loadCohorts() }, [loadCohorts])
    // Cohorts read the CDP layer by session cookie (not a metrics query), so they
    // don't refetch on workspace switch by themselves — re-pull on the global signal.
    useEffect(() => {
        const onRefresh = () => loadCohorts()
        window.addEventListener('mk-metrics-refresh', onRefresh)
        return () => window.removeEventListener('mk-metrics-refresh', onRefresh)
    }, [loadCohorts])

    const deltaSuffix = weekly ? 'vs last week' : 'vs prev window'

    // ── KPI strip: one query, current + previous window ─────────────────────
    const kpiQ = useMetricsWithDelta(
        {
            metrics: [
                // roas stays here (it's 'other' grain — blended net_revenue/total_ad_spend);
                // shown only in the blended (platform===null) case. The ad-grain metrics
                // (total_ad_spend, ad_conversions_value, platform_reported_roas) moved to
                // adKpiQ below so the platform filter actually applies to them (mixing them
                // here makes platformWhere bail to null → blended + no refetch on switch).
                'net_revenue', 'order_count', 'roas', 'cac',
                'new_customers', 'gross_margin', 'refund_rate', 'refund_amount',
                'rto_rate', 'cogs_known_items', 'cogs_total_items',
                // Marketplace daily rollup (Flipkart/Blinkit Daily Summary): real
                // order COUNT + sales when there's no Shopify fct_orders. Fills the
                // Orders / Revenue tiles for marketplace-only workspaces.
                'marketplace_orders', 'marketplace_revenue',
                // Leadgen (Progen): the conversion is a form submission. form_conversions
                // is DEDUPED to match the CRM "All Leads" count; form_events is the raw
                // submission count (incl. repeats). Fill the Lead conversions / Cost per
                // lead / Form submissions tiles when isLeadgen.
                ...(isLeadgen ? ['form_conversions', 'cost_per_form_conversion', 'form_events'] : []),
            ],
            ...window_,
        },
        mOpts,
    )
    const k = kpiQ.rows[0] || {}
    const p = kpiQ.prevRows[0] || {}
    // Ad-side KPIs — SEPARATE query so the platform filter (mOpts.platform) actually
    // applies (mixing these with the cross-platform metrics above makes platformWhere
    // bail to null → blended + no refetch on switch). All 'ad' grain (do NOT add 'roas'
    // here — it's 'other' grain and would make platformWhere bail again). When a platform
    // is picked these are scoped to it; blended when 'All platforms'.
    const adKpiQ = useMetricsWithDelta(
        { metrics: ['total_ad_spend', 'ad_conversions_value', 'platform_reported_roas'], ...window_ },
        mOpts,
    )
    const ak = adKpiQ.rows[0] || {}
    const ap = adKpiQ.prevRows[0] || {}
    const mer = num(k.net_revenue) > 0 ? num(ak.total_ad_spend) / num(k.net_revenue) : null
    const cogsCoverage = num(k.cogs_total_items) > 0 ? num(k.cogs_known_items) / num(k.cogs_total_items) : 0
    // Does this workspace have real (Shopify per-order) orders in fct_orders?
    // Marketplace-ads workspaces (e.g. Flipkart, ads-only) don't — so revenue/ROAS
    // tiles fall back to the ad-platform-REPORTED figures instead of showing blanks.
    const hasOrders = num(k.order_count) > 0
    // Marketplace daily rollup (Flipkart/Blinkit): a real order COUNT + sales even
    // without Shopify. Prefer these over the ad-reported signal when present — they
    // ARE the store's orders/revenue, just at daily grain (no per-customer detail).
    // BUT marketplace_revenue/orders are 'other' grain (from flipkart_orders — NOT
    // platform-filterable, and Flipkart-only), so when a SPECIFIC platform is selected
    // we must NOT use them (they'd show Flipkart's numbers even under an Amazon filter).
    // In single-platform mode fall through to the ad-reported path (ad_conversions_value),
    // which IS scoped to the selected platform. Only use the rollup in blended mode.
    const hasMarketplace = !platform && num(k.marketplace_orders) > 0
    // Unified Orders / Revenue for the tiles: Shopify orders if synced, else the
    // marketplace daily rollup, else blank.
    const ordersValue = hasOrders ? num(k.order_count) : (hasMarketplace ? num(k.marketplace_orders) : null)
    const ordersPrev = hasOrders ? num(p.order_count) : num(p.marketplace_orders)

    // ── Revenue vs ad spend trend — follows the dashboard date range ─────────
    // The chart honours the TOP date picker by default (1 week picked → 1-week
    // daily chart, not a fixed 8-week trend), so the header range and the chart
    // always agree. The card's own Date control still overrides it independently.
    // Grain (daily vs weekly buckets) is derived from the span so a short range
    // renders per-day points instead of one collapsed weekly bar.
    const trendWin = useCardWindow(window_)
    const trendRange = trendWin.window_
    const trendGrain = grainFor(trendRange)
    // KNOWN LIMITATION: this trend series stays BLENDED across platforms even when a
    // platform is selected. It mixes revenue (net_revenue/marketplace_revenue/
    // ad_conversions_value — 'other'/'ad' grain) with total_ad_spend ('ad' grain), so
    // platformWhere() bails to null (a mixed revenue+spend time series can't carry the
    // ad_row__platform filter — MetricFlow has no join path). Splitting the chart into
    // two separately-filtered queries is deferred.
    const trendQ = useMetrics(
        {
            // marketplace_revenue + ad_conversions_value included so the chart's
            // revenue line uses the SAME 3-way fallback as the Revenue KPI (Shopify
            // → marketplace daily rollup → ad-platform-reported) instead of flat-
            // lining at ₹0 for ads-only workspaces that have neither of the first two.
            metrics: ['net_revenue', 'marketplace_revenue', 'ad_conversions_value', 'total_ad_spend', 'roas'],
            groupBy: [trendGrain.dim], orderBy: [trendGrain.dim],
            ...trendRange,
        },
        mOpts,
    )
    // Revenue series for the chart — mirror the Revenue KPI's 3-way cascade
    // (FounderDashboard KPI, ~line 285): Shopify net revenue if this workspace has
    // orders, else the marketplace daily-rollup revenue, else the ad-platform-
    // reported conversion value. Keeps the line from flat-lining at ₹0 for
    // marketplace/ads-only sellers, and keeps the chart consistent with the KPI.
    const revKey = hasOrders ? 'net_revenue' : (hasMarketplace ? 'marketplace_revenue' : 'ad_conversions_value')
    const revLabel = hasOrders ? 'Net revenue' : (hasMarketplace ? 'Revenue' : 'Ad-reported revenue')

    // ── Real ROAS by platform (campaign_performance — single-model ratio) ───
    const platformWin = useCardWindow(window_)
    const platformQ = useMetrics(
        {
            metrics: ['real_roas', 'campaign_spend', 'campaign_attributed_revenue'],
            groupBy: ['campaign_row__platform'], orderBy: ['-campaign_spend'],
            ...platformWin.window_,
        },
        mOpts,
    )
    const platRows = (platformQ.rows || []).filter((r) => num(r.campaign_spend) > 0)

    // ── Spend allocation + real ROAS per campaign ────────────────────────────
    const campaignWin = useCardWindow(window_)
    // Per-user saved name filter (e.g. "DT_"). Runs SERVER-SIDE via nameFilter so a
    // filtered view fetches ALL matching campaigns, not just the top-10 by spend.
    const campaignFilter = useCampaignFilter('spend_allocation', 'campaign_row__campaign_name')
    const campaignQ = useMetrics(
        {
            metrics: ['campaign_spend', 'real_roas'],
            groupBy: ['campaign_row__campaign_name'], orderBy: ['-campaign_spend'],
            // Widen the cap when a filter is active so the whole matching set returns.
            limit: campaignFilter.active ? 200 : 10,
            ...campaignWin.window_,
            ...(campaignFilter.nameFilter ? { nameFilter: campaignFilter.nameFilter } : {}),
        },
        mOpts,
    )
    const campaigns = (campaignQ.rows || []).filter((c) => num(c.campaign_spend) > 0)
    const totalSpend = campaigns.reduce((a, c) => a + num(c.campaign_spend), 0)

    // ── RTO by pin tier (feeds the signal rules only — drill-down has its own page) ──
    const tierQ = useMetrics(
        { metrics: ['rto_rate', 'all_orders'], groupBy: ['order__pin_tier'], ...window_ },
        mOpts,
    )

    // ── Inventory at risk (CURRENT-STATE snapshot — no date window) ──────────
    // Summary by risk band always works; the per-product list needs the
    // product__product_title dim (newer manifest) — if that query fails we
    // silently fall back to the band summary.
    const invSummaryQ = useMetrics(
        { metrics: ['product_count', 'total_inventory_units', 'units_sold_30d'], groupBy: ['product__risk_band'] },
        mOpts,
    )
    const invProductsQ = useMetrics(
        {
            metrics: ['total_inventory_units', 'units_sold_30d'],
            groupBy: ['product__product_title', 'product__risk_band'],
            orderBy: ['-total_inventory_units'], limit: 40,
        },
        mOpts,
    )
    const BAND = {
        at_risk: { label: 'At risk', rank: 0, cls: 'bg-destructive/10 text-destructive' },
        slow: { label: 'Slow', rank: 1, cls: 'bg-warning/10 text-warning' },
        healthy: { label: 'Healthy', rank: 2, cls: 'bg-success/10 text-success' },
    }
    const invProducts = useMemo(() => (
        (invProductsQ.rows || [])
            .filter((r) => r.product__product_title)
            .sort((a, b) => (BAND[a.product__risk_band]?.rank ?? 3) - (BAND[b.product__risk_band]?.rank ?? 3)
                || num(b.total_inventory_units) - num(a.total_inventory_units))
            .slice(0, 8)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ), [invProductsQ.rows])
    const invBands = invSummaryQ.rows || []
    const atRiskBand = invBands.find((r) => r.product__risk_band === 'at_risk')
    // Marketplace sellers (Flipkart/Blinkit) have no product/inventory catalog, so
    // the Inventory-at-risk panel would just say "No data". Hide it entirely once
    // the summary has loaded empty (keep it while loading so it doesn't flicker).
    const hasProducts = invSummaryQ.loading || invBands.length > 0

    const signals = useMemo(() => deriveSignals({
        kpis: k, prevKpis: p, campaigns, tierRows: tierQ.rows || [],
    }), [k, p, campaigns, tierQ.rows])

    // ── Investor rollup: formatted text block → clipboard ────────────────────
    const copyInvestorUpdate = async () => {
        const line = (label, cur, prev, fmt) => {
            const c = num(cur); const pr = num(prev)
            const d = pr ? ` (${c >= pr ? '+' : ''}${(((c - pr) / Math.abs(pr)) * 100).toFixed(0)}% WoW)` : ''
            return `• ${label}: ${fmt(cur)}${d}`
        }
        const text = [
            `Weekly update — ${windowLabel(window_)}`,
            line('Net revenue', k.net_revenue, p.net_revenue, fmtMoney),
            line('Orders', k.order_count, p.order_count, fmtNum),
            line('Blended ROAS', k.roas, p.roas, fmtRoas),
            line('Ad spend', ak.total_ad_spend, ap.total_ad_spend, fmtMoney),
            line('CAC (new-customer)', k.cac, p.cac, fmtMoney),
            line('New customers', k.new_customers, p.new_customers, fmtNum),
            `• Gross margin: ${fmtPct(k.gross_margin)}${cogsCoverage < 0.5 ? ' (low COGS coverage)' : ''}`,
            `• RTO rate: ${fmtPct(k.rto_rate)} · Refund rate: ${fmtPct(k.refund_rate)}`,
            '',
            ...signals.map((s) => `${s.severity === 'win' ? '★' : '!'} ${s.title} — ${s.action}`),
        ].join('\n')
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2500)
        } catch { /* clipboard unavailable — ignore */ }
    }

    return (
        <div className="space-y-8 pt-2">
            {/* Controls row — platform filter (from the cockpit) + date picker */}
            <div className="flex flex-wrap items-center gap-2.5">
                {controlsLeft}
                <WindowSelector presets={WINDOWS} ctrl={winCtrl} suffix="" />
            </div>

            {/* KPI strip — 8 flat tiles, each with a semantic WoW delta */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
                {/* Net revenue reads from real orders (fct_orders). Marketplace-ads
                    workspaces (e.g. Flipkart) have no synced orders → fall back to the
                    ad-platform-REPORTED revenue, clearly labelled so it's not mistaken
                    for true net revenue. */}
                {/* Revenue: Shopify net revenue if orders synced; else the marketplace
                    daily-rollup sales (real sales, daily grain); else the ad-platform
                    REPORTED value (signal only); else blank. */}
                <Kpi label={hasOrders ? 'Net revenue' : (hasMarketplace ? 'Revenue' : 'Ad-reported revenue')}
                    loading={kpiQ.loading || adKpiQ.loading}
                    value={hasOrders ? fmtMoneyInr(k.net_revenue)
                        : (hasMarketplace ? fmtMoneyInr(k.marketplace_revenue)
                        : (num(ak.ad_conversions_value) > 0 ? fmtMoneyInr(ak.ad_conversions_value) : 'No data'))}
                    sub={hasOrders ? undefined
                        : (hasMarketplace ? 'marketplace · daily rollup'
                        : (num(ak.ad_conversions_value) > 0 ? 'platform-reported · orders not synced' : 'connect a sales source'))}
                    delta={hasOrders
                        ? <TrendDelta current={k.net_revenue} previous={p.net_revenue} suffix={deltaSuffix} />
                        : (hasMarketplace
                        ? <TrendDelta current={k.marketplace_revenue} previous={p.marketplace_revenue} suffix={deltaSuffix} />
                        : <TrendDelta current={ak.ad_conversions_value} previous={ap.ad_conversions_value} suffix={deltaSuffix} />)} />
                {/* Blended ROAS = real revenue / spend (needs orders). Without orders,
                    show the platform-REPORTED ROAS (ad_conversions_value / spend) instead. */}
                <Kpi label={hasOrders ? 'Blended ROAS (MER)' : 'Platform ROAS'} loading={kpiQ.loading || adKpiQ.loading}
                    value={hasOrders ? fmtRoas(k.roas) : fmtRoas(ak.platform_reported_roas)}
                    sub={hasOrders ? (mer != null ? `MER ${fmtPct(mer)} of revenue` : undefined)
                        : 'ad-reported · orders not synced'}
                    delta={hasOrders
                        ? <TrendDelta current={k.roas} previous={p.roas} fmtAbs={fmtRoasDelta} suffix={deltaSuffix} />
                        : <TrendDelta current={ak.platform_reported_roas} previous={ap.platform_reported_roas} fmtAbs={fmtRoasDelta} suffix={deltaSuffix} />} />
                {/* Orders → Lead conversions for a leadgen workspace: a form submission
                    IS the conversion (form_conversions), so the "Orders" slot shows the
                    count of lead conversions instead of Shopify orders. */}
                {isLeadgen ? (
                <Kpi label="Lead conversions" loading={kpiQ.loading}
                    value={num(k.form_conversions) > 0 ? fmtNumCompact(k.form_conversions) : (kpiQ.loading ? '' : 'No data')}
                    sub="unique leads · matches All Leads"
                    delta={<TrendDelta current={k.form_conversions} previous={p.form_conversions} suffix={deltaSuffix} />} />
                ) : (
                <Kpi label="Orders" loading={kpiQ.loading}
                    value={ordersValue == null ? 'No data' : fmtNumCompact(ordersValue)}
                    sub={!hasOrders && hasMarketplace ? 'marketplace · daily rollup' : undefined}
                    delta={<TrendDelta current={ordersValue} previous={ordersPrev} suffix={deltaSuffix} />} />
                )}
                {/* CAC / New customers / Gross margin / Refund-RTO need buyer identity +
                    synced COGS + returns — none exist on a marketplace. Hidden for Flipkart.
                    For leadgen, CAC → Cost per lead and New customers → Unique leads. */}
                {isLeadgen ? (
                <Kpi label="Cost per lead" loading={kpiQ.loading}
                    value={num(k.form_conversions) > 0 ? fmtMoneyInr(k.cost_per_form_conversion) : (kpiQ.loading ? '' : 'No data')}
                    sub="ad spend ÷ conversions"
                    delta={<TrendDelta current={k.cost_per_form_conversion} previous={p.cost_per_form_conversion} invert tone="caution" suffix={deltaSuffix} />} />
                ) : (!isMarketplace && (
                <Kpi label="CAC (new-customer)" loading={kpiQ.loading} value={fmtMoneyInr(k.cac)}
                    sub="window-based"
                    delta={<TrendDelta current={k.cac} previous={p.cac} invert tone="caution" suffix={deltaSuffix} />} />
                ))}
                <Kpi label="Ad spend" loading={adKpiQ.loading} value={fmtMoneyInr(ak.total_ad_spend)}
                    delta={<TrendDelta current={ak.total_ad_spend} previous={ap.total_ad_spend} invert tone="caution" suffix={deltaSuffix} />} />
                {isLeadgen ? (
                <Kpi label="Form submissions" loading={kpiQ.loading}
                    value={num(k.form_events) > 0 ? fmtNumCompact(k.form_events) : (kpiQ.loading ? '' : 'No data')}
                    sub={num(k.form_events) > 0 ? 'incl. repeat submissions' : undefined}
                    delta={<TrendDelta current={k.form_events} previous={p.form_events} suffix={deltaSuffix} />} />
                ) : (!isMarketplace && (
                <Kpi label="New customers" loading={kpiQ.loading} value={fmtNumCompact(k.new_customers)}
                    sub={num(k.order_count) > 0 ? `${fmtPct(num(k.new_customers) / num(k.order_count))} of orders` : undefined}
                    delta={<TrendDelta current={k.new_customers} previous={p.new_customers} suffix={deltaSuffix} />} />
                ))}
                {/* Gross margin without any known COGS is a meaningless 100% — say "No data" instead.
                    Leadgen has no COGS/returns → hide margin + refund/RTO entirely. */}
                {!isMarketplace && !isLeadgen && (
                <Kpi label="Gross margin" loading={kpiQ.loading}
                    value={cogsCoverage === 0 ? 'No data' : fmtPct(k.gross_margin)}
                    sub={cogsCoverage === 0 ? 'COGS not synced from Shopify yet'
                        : cogsCoverage < 0.5 ? `⚠ COGS known for ${fmtPct(cogsCoverage)} of items` : 'from Shopify unit costs'}
                    delta={cogsCoverage === 0 ? undefined
                        : <TrendDeltaPoints current={k.gross_margin} previous={p.gross_margin} suffix={deltaSuffix} />} />
                )}
                {!isMarketplace && !isLeadgen && (
                <Kpi label="Refund / RTO rate" loading={kpiQ.loading}
                    value={k.rto_rate == null && k.refund_rate == null ? 'No data' : fmtPct(k.rto_rate)}
                    sub={k.refund_rate == null ? undefined : `refunds ${fmtPct(k.refund_rate)} of revenue`}
                    delta={<TrendDeltaPoints current={k.rto_rate} previous={p.rto_rate} invert suffix={deltaSuffix} />} />
                )}
            </div>

            {/* Trend + channel ROAS. A hidden partner (ChartCard→null) leaves the
                survivor as the grid's only-child → span both columns (full width)
                instead of sitting in a half-width track with empty space beside it. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:[&>*:only-child]:col-span-2">
                <ChartCard
                    hideId="revenue_vs_spend_trend"
                    title="Revenue vs ad spend"
                    subtitle={`${hasOrders ? 'net revenue after RTO restatement' : (hasMarketplace ? 'marketplace revenue · daily rollup' : 'ad-platform-reported revenue')} · ${trendGrain.daily ? 'daily' : 'weekly'} · ${windowLabel(trendRange)}`}
                    loading={trendQ.loading} error={trendQ.error}
                    empty={!trendQ.loading && !trendQ.error && (trendQ.rows || []).length === 0}
                    right={<CardControls query={trendQ} winCtrl={trendWin} />}
                    ask={{ rows: trendQ.rows, meta: { chartId: 'revenue_vs_spend_trend', window: trendWin.overridden ? windowLabel(trendRange) : '8 weeks', persona: 'Founder / CEO', type: 'line', metrics: [revKey, 'total_ad_spend'], groupBy: [trendGrain.dim], valueFmt: 'money' } }}
                >
                    <Line
                        data={{
                            labels: (trendQ.rows || []).map((r) => (trendGrain.daily ? fmtDay(r[trendGrain.dim]) : fmtWeek(r[trendGrain.dim]))),
                            datasets: [
                                {
                                    label: revLabel,
                                    data: (trendQ.rows || []).map((r) => num(r[revKey])),
                                    borderColor: 'hsl(var(--chart-2))', backgroundColor: 'hsl(var(--chart-2))',
                                    pointRadius: 3, pointBackgroundColor: 'hsl(var(--chart-2))',
                                    tension: 0.35, fill: false,
                                },
                                {
                                    label: 'Ad spend',
                                    data: (trendQ.rows || []).map((r) => num(r.total_ad_spend)),
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
                                tooltip: { padding: 8, boxPadding: 4, callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoney(c.parsed.y)}` } },
                            },
                            scales: {
                                x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 11 } } },
                                y: { grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 11 }, callback: (v) => fmtMoneyInr(v) } },
                            },
                        }}
                    />
                </ChartCard>
                {/* ROAS by channel = CDP-attributed ORDER revenue ÷ spend. Flipkart has no
                    CDP attribution (marketplace, no pixel) → hidden. Leadgen has no order
                    revenue (conversion is a form-fill, not a sale) → hidden too. */}
                {!isMarketplace && !isLeadgen && (
                <ChartCard
                    hideId="roas_by_channel"
                    title="ROAS by channel" subtitle="corrected (CDP-attributed revenue ÷ spend, not platform-claimed)"
                    loading={platformQ.loading} error={platformQ.error}
                    empty={!platformQ.loading && !platformQ.error && platRows.length === 0}
                    right={<CardControls query={platformQ} winCtrl={platformWin} />}
                    ask={{ rows: platRows, meta: { chartId: 'roas_by_channel', window: windowLabel(platformWin.window_), persona: 'Founder / CEO', type: 'hbar', metrics: ['real_roas'], groupBy: ['campaign_row__platform'], valueFmt: 'roas' } }}
                >
                    <Bar
                        data={{
                            labels: platRows.map((r) => r.campaign_row__platform ?? '—'),
                            datasets: [{
                                data: platRows.map((r) => num(r.real_roas)),
                                backgroundColor: platRows.map((r) => roasColor(r.real_roas)),
                                borderRadius: 4,
                                maxBarThickness: 22,
                            }],
                        }}
                        options={{
                            indexAxis: 'y',
                            responsive: true, maintainAspectRatio: false,
                            plugins: {
                                legend: { display: false },
                                tooltip: { callbacks: { label: (c) => fmtRoas(c.parsed.x) } },
                            },
                            scales: {
                                x: { grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 11 }, callback: (v) => `${v}×` } },
                                y: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 11 } } },
                            },
                        }}
                    />
                </ChartCard>
                )}
            </div>

            {/* WHAT HAPPENED · WHY · WHAT TO DO */}
            

            {/* Spend allocation + inventory at risk. Marketplace workspaces hide the
                inventory panel → spend-allocation is the only-child → full width. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:[&>*:only-child]:col-span-2">
            <ChartCard
                hideId="spend_allocation"
                title={campaignWin.overridden ? 'Spend allocation' : (weekly ? 'Spend allocation this week' : 'Spend allocation')}
                subtitle={`% of ${fmtMoneyInr(totalSpend)} total · real ROAS per campaign`}
                loading={campaignQ.loading} error={campaignQ.error}
                empty={!campaignQ.loading && !campaignQ.error && campaigns.length === 0}
                right={<>{campaignFilter.control}<CardControls query={campaignQ} winCtrl={campaignWin} /></>}
                ask={{ rows: campaigns, meta: { chartId: 'spend_allocation', window: windowLabel(campaignWin.window_), persona: 'Founder / CEO' } }}
            >
                <div className="flex flex-col gap-4 pt-1">
                    {campaigns.map((c, i) => {
                        const share = totalSpend ? num(c.campaign_spend) / totalSpend : 0
                        const roasVal = num(c.real_roas)
                        // real_roas = 0 means attribution didn't resolve for this campaign
                        // (canonical-vs-UTM name mismatch), NOT zero performance — show it
                        // as unknown ("—", neutral bar) rather than a red 0.00×.
                        const realKnown = roasVal > 0
                        const barColor = realKnown ? roasColor(roasVal) : 'hsl(var(--border))'
                        return (
                            <div key={c.campaign_row__campaign_name || i}>
                                <div className="flex items-baseline justify-between gap-3">
                                    <div className="truncate text-xs font-medium text-foreground" title={c.campaign_row__campaign_name}>
                                        {c.campaign_row__campaign_name || '(unknown)'}
                                    </div>
                                    <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                        {fmtPct(share)} · {realKnown
                                            ? <span className="font-semibold" style={{ color: roasColor(roasVal) }}>{fmtRoas(roasVal)}</span>
                                            : <span className="font-semibold text-muted-foreground/60" title="No CDP-attributed revenue for this campaign — real ROAS can’t be computed">—</span>}
                                    </div>
                                </div>
                                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                    <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, 2)}%`, background: barColor }} />
                                </div>
                            </div>
                        )
                    })}
                </div>
            </ChartCard>

            {hasProducts && (
            <ChartCard
                hideId="inventory_at_risk"
                title="Inventory at risk"
                subtitle={atRiskBand
                    ? `${fmtNum(atRiskBand.product_count)} product${num(atRiskBand.product_count) === 1 ? '' : 's'} under 14 days of cover · based on 30-day sell-through`
                    : 'days-of-cover = stock ÷ 30-day sell-through velocity'}
                loading={invSummaryQ.loading} error={invSummaryQ.error}
                empty={!invSummaryQ.loading && !invSummaryQ.error && invBands.length === 0}
                right={<CardControls query={{ refetch: () => { invSummaryQ.refetch(); invProductsQ.refetch() }, loading: invSummaryQ.loading || invProductsQ.loading }} />}
                ask={{ rows: invProducts.length > 0 ? invProducts : invBands, meta: { chartId: 'inventory_at_risk', window: 'current stock snapshot', persona: 'Founder / CEO' } }}
            >
                {invProducts.length > 0 ? (
                    <div className="flex flex-col divide-y divide-border pt-1">
                        {invProducts.map((r) => {
                            const band = BAND[r.product__risk_band] || BAND.healthy
                            return (
                                <div key={r.product__product_title} className="flex items-center justify-between gap-3 py-2.5">
                                    <div className="truncate text-sm text-foreground" title={r.product__product_title}>
                                        {r.product__product_title}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3">
                                        <span className="text-xs tabular-nums text-muted-foreground/70">
                                            {fmtNumCompact(r.total_inventory_units)} in stock · {fmtNumCompact(r.units_sold_30d)}/30d
                                        </span>
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${band.cls}`}>{band.label}</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    // Fallback: band summary (per-product list needs the newer manifest)
                    <div className="flex flex-col gap-2 pt-1">
                        {invBands.map((r) => {
                            const band = BAND[r.product__risk_band] || BAND.healthy
                            return (
                                <div key={r.product__risk_band} className="flex items-center justify-between gap-3 py-1.5">
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${band.cls}`}>{band.label}</span>
                                    <span className="text-xs tabular-nums text-muted-foreground">
                                        {fmtNum(r.product_count)} products · {fmtNumCompact(r.total_inventory_units)} units · {fmtNumCompact(r.units_sold_30d)} sold/30d
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                )}
            </ChartCard>
            )}
            </div>

            {/* Cohort analysis — retention / LTV by acquisition cohort. Needs
                per-buyer identity (CDP), which a marketplace hides → hidden for Flipkart.
                Leadgen has no repeat-purchase cohort → hidden too. */}
            {!isMarketplace && !isLeadgen && (
            <CohortCard
                rows={cohorts.rows || []}
                loading={cohorts.loading}
                error={cohorts.error}
                grain={cohortGrain}
                onGrainChange={setCohortGrain}
            />
            )}

        </div>
    )
}
