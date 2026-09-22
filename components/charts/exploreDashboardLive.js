/*
 * exploreDashboardLive — the HYBRID data loader for the ExploreNew ads dashboard.
 *
 * For a platform + date window it issues the minimal set of live semantic-layer
 * queries and translates the rows into the engine's LIVE store shape:
 *   totals: { 'demoMetric|account'        : {cur, prev} ,   // KPI/trend/rank/table
 *             'demoMetric|<campaign>'      : {cur} ,          // rank/table rows
 *             'demoMetric|<campaign>|<x>'  : {cur} }          // grid heatmap cell
 *   series: { 'demoMetric|account|<grain>'   : number[] ,     // account trend
 *             'demoMetric|<campaign>|<grain>' : number[] }     // campaign trend / dod-wow-mom
 *   campaigns: [<real campaign name>, …]
 *
 * PLATFORM-AWARE: Amazon reads its NATIVE metric family (amazon_spend/sales/roas/
 * acos/… with real attributed sales + a real placement breakdown), because Amazon
 * models ACOS and attributed ROAS that the shared ad_row model doesn't. Google /
 * Meta / Flipkart read the shared ad_row + campaign_row metrics, plus the new
 * cost_per_conversion ratio (Google "cost / conversion" and Meta CPI are the same
 * ratio, scoped by platform). Everything maps onto the SAME LIVE store keys, so
 * the engine's baseVal/seriesFor lookups are source-agnostic.
 *
 * Still seeded (honest "sample"): the DEVICE/OS heatmaps (Google device is a
 * connector-deploy gap; Amazon device is an Amazon-API limitation; Meta OS isn't a
 * real segment) — the page renders those as needs-setup notes, not fake numbers.
 * Deep drill members past the first level (ASIN/creative/keyword) also stay seeded
 * (Amazon ASIN rows are 0 today; keyword tables are config-only per GAPS_REMAINING).
 *
 * Queries are split by GRAIN (account totals; campaign breakdown; campaign×day
 * series) because MetricFlow can't join a platform filter across grains. Failures
 * swallow to empty — an empty result just leaves that slice seeded.
 */
import metricsApi from '@/lib/businessMetrics'
import { setLive, clearLive, LIVE_METRIC, preset } from './exploreDashboardEngine'

const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0 }

async function runQuery(admin, workspaceId, body) {
    try {
        const res = admin ? await metricsApi.adminQuery(workspaceId, body) : await metricsApi.metrics.query(body)
        const data = res.data || {}
        if (data.success === false) return []
        return data.rows || []
    } catch {
        return []
    }
}

// Reverse map: live metric → the demo keys that should mirror its value.
function demoKeysForLive(liveMetric) {
    return Object.keys(LIVE_METRIC).filter((d) => LIVE_METRIC[d] === liveMetric)
}
// Write a live value onto every demo key that aliases `liveMetric`, at `memberKey`.
function fanOut(totals, liveMetric, memberKey, val) {
    demoKeysForLive(liveMetric).forEach((demo) => { totals[`${demo}|${memberKey}`] = { cur: val, prev: null } })
}

const AD_WHERE = (pk) => `{{ Dimension('ad_row__platform') }} = '${pk}'`
const CAMP_WHERE = (pk) => `{{ Dimension('campaign_row__platform') }} = '${pk}'`

/* ── Amazon: native metric family (real ROAS/ACOS + placement) ────────────────── */
async function loadAmazon(admin, workspaceId, dateRange, grainDim, grainKey) {
    const totals = {}; const series = {}; const campaigns = []; let hasAny = false

    // account totals (Amazon metrics are intrinsically Amazon — no platform where)
    const acc = (await runQuery(admin, workspaceId, {
        metrics: ['amazon_spend', 'amazon_sales', 'amazon_orders', 'amazon_clicks', 'amazon_impressions', 'amazon_roas', 'amazon_acos', 'amazon_ctr'],
        dateRange,
    }))[0]
    if (acc) {
        // Amazon native → engine demo keys (spend/sales/roas/acos/ctr/orders + clicks).
        const map = { amazon_spend: 'spend', amazon_sales: 'sales', amazon_orders: 'orders', amazon_clicks: 'clicks', amazon_impressions: 'impressions', amazon_roas: 'roas', amazon_acos: 'acos', amazon_ctr: 'ctr' }
        Object.entries(map).forEach(([live, demo]) => {
            if (acc[live] == null) return
            const v = num(acc[live])
            totals[`${demo}|account`] = { cur: v, prev: null }
            // ACOS is a %; engine unit is pct — amazon_acos ratio is spend/sales (0..n).
            if (demo === 'acos') totals['acos|account'] = { cur: v * 100, prev: null }
            hasAny = true
        })
        // cpc = spend / clicks (Amazon gives no direct cpc metric)
        if (acc.amazon_spend != null && num(acc.amazon_clicks) > 0) {
            totals['cpc|account'] = { cur: num(acc.amazon_spend) / num(acc.amazon_clicks), prev: null }
        }
    }

    // NOTE: no Amazon daily-series query. fct_amazon_campaigns is campaign-GRAIN
    // (daily insights are pre-summed into one row per campaign; its only time axis
    // is report_date = the campaign's last-active day), so it cannot produce a real
    // daily/weekly trend. The Amazon `trend`/`ctrend`/period-grid cards therefore
    // stay on seeded data (rendered with a "sample" watermark). A true Amazon daily
    // trend needs a dated fct built on stg_amazon__insights — a separate ETL task.
    // Mark the account series as explicitly seeded so the page can badge it.
    void grainDim; void grainKey; void series

    // top campaigns (native campaign grain)
    const crows = await runQuery(admin, workspaceId, {
        metrics: ['amazon_spend', 'amazon_sales', 'amazon_clicks', 'amazon_orders', 'amazon_roas', 'amazon_acos'],
        groupBy: ['amz_row__campaign_name'], orderBy: ['-amazon_spend'], limit: 8, dateRange,
    })
    crows.forEach((r) => {
        const name = r.amz_row__campaign_name
        if (!name) return
        campaigns.push(String(name))
        const cmap = { amazon_spend: 'spend', amazon_sales: 'sales', amazon_clicks: 'clicks', amazon_orders: 'orders', amazon_roas: 'roas', amazon_acos: 'acos' }
        Object.entries(cmap).forEach(([live, demo]) => {
            if (r[live] == null) return
            totals[`${demo}|${name}`] = { cur: demo === 'acos' ? num(r[live]) * 100 : num(r[live]), prev: null }
        })
        hasAny = true
    })

    // placement × campaign grid (Amazon has a REAL placement breakdown) → grid card
    // keys as 'acos|<campaign>|<placement>' (effAlt=acos for amazon).
    const prows = await runQuery(admin, workspaceId, {
        metrics: ['amazon_plc_spend', 'amazon_plc_sales', 'amazon_plc_clicks', 'amazon_plc_roas'],
        groupBy: ['amzplc_row__campaign_name', 'amzplc_row__placement'], dateRange,
    })
    prows.forEach((r) => {
        const c = r.amzplc_row__campaign_name; const plc = r.amzplc_row__placement
        if (!c || !plc) return
        // acos cell = spend/sales * 100 (placement roas is sales/spend)
        const roas = num(r.amazon_plc_roas)
        const acos = roas > 0 ? (1 / roas) * 100 : (num(r.amazon_plc_spend) && num(r.amazon_plc_sales) ? (num(r.amazon_plc_spend) / num(r.amazon_plc_sales)) * 100 : 0)
        totals[`acos|${c}|${plc}`] = { cur: acos, prev: null }
        totals[`roas|${c}|${plc}`] = { cur: roas, prev: null }
        hasAny = true
    })

    return { totals, series, campaigns, hasAny }
}

/* ── Google / Meta / Flipkart: shared ad_row + campaign_row + cost_per_conversion ─ */
async function loadShared(pk, admin, workspaceId, dateRange, grainDim, grainKey) {
    const totals = {}; const series = {}; const campaigns = []; let hasAny = false

    const AD_METRICS = ['total_ad_spend', 'total_ad_clicks', 'ad_impressions', 'ad_conversions', 'ad_conversions_value', 'platform_reported_roas', 'ctr', 'cpc', 'cpm', 'cvr', 'avg_frequency', 'cost_per_conversion']

    const acc = (await runQuery(admin, workspaceId, { metrics: AD_METRICS, dateRange, where: AD_WHERE(pk) }))[0]
    if (acc) {
        AD_METRICS.forEach((live) => {
            if (acc[live] == null) return
            fanOut(totals, live, 'account', num(acc[live]))
            hasAny = true
        })
    }

    const srows = await runQuery(admin, workspaceId, {
        metrics: ['total_ad_spend', 'ad_conversions_value', 'total_ad_clicks', 'ad_conversions'],
        groupBy: [grainDim], orderBy: [grainDim], where: AD_WHERE(pk), dateRange,
    })
    if (srows.length) {
        ['total_ad_spend', 'ad_conversions_value', 'total_ad_clicks', 'ad_conversions'].forEach((live) => {
            const arr = srows.map((r) => num(r[live]))
            demoKeysForLive(live).forEach((demo) => { series[`${demo}|account|${grainKey}`] = arr })
        })
        hasAny = true
    }

    const crows = await runQuery(admin, workspaceId, {
        metrics: ['campaign_spend', 'campaign_attributed_revenue', 'campaign_clicks', 'campaign_conversions', 'campaign_reported_roas'],
        groupBy: ['campaign_row__campaign_name'], orderBy: ['-campaign_spend'], limit: 8, where: CAMP_WHERE(pk), dateRange,
    })
    const campMap = { campaign_spend: 'spend', campaign_attributed_revenue: 'revenue', campaign_clicks: 'clicks', campaign_conversions: 'conversions', campaign_reported_roas: 'roas' }
    crows.forEach((r) => {
        const name = r.campaign_row__campaign_name
        if (!name) return
        campaigns.push(String(name))
        Object.entries(campMap).forEach(([live, demo]) => {
            if (r[live] == null) return
            const v = num(r[live])
            // fan onto sibling demo keys (revenue↔sales↔conv_value, roas↔roi↔cvpc)
            demoKeysForLive(LIVE_METRIC[demo]).forEach((sib) => { totals[`${sib}|${name}`] = { cur: v, prev: null } })
        })
        hasAny = true
    })

    // campaign × day series for the DoD/WoW/MoM period grids (top ~6 campaigns)
    if (campaigns.length) {
        const perRows = await runQuery(admin, workspaceId, {
            metrics: ['campaign_spend', 'campaign_attributed_revenue', 'campaign_clicks', 'campaign_conversions'],
            groupBy: ['campaign_row__campaign_name', grainDim], orderBy: [grainDim], where: CAMP_WHERE(pk), dateRange,
        })
        if (perRows.length) {
            const byCampaign = {}
            perRows.forEach((r) => {
                const name = r.campaign_row__campaign_name
                if (!name) return
                byCampaign[name] = byCampaign[name] || []
                byCampaign[name].push(r)
            })
            const perMap = { campaign_spend: 'spend', campaign_attributed_revenue: 'revenue', campaign_clicks: 'clicks', campaign_conversions: 'conversions' }
            Object.entries(byCampaign).forEach(([name, rows]) => {
                Object.entries(perMap).forEach(([live, demo]) => {
                    const arr = rows.map((r) => num(r[live]))
                    demoKeysForLive(LIVE_METRIC[demo]).forEach((sib) => { series[`${sib}|${name}|${grainKey}`] = arr })
                })
            })
            hasAny = true
        }
    }

    // Meta-only: creative FATIGUE (per-ad video, recent 7d vs prior 21d). Its own
    // mart/entity (mfat_row) — not the shared ad_row/campaign_row grain — so it's a
    // separate query written onto dedicated `fatigue_*|<creative>` store keys the
    // engine's `fatigue` card reads. has_baseline filters to judgeable creatives.
    if (pk === 'meta') {
        const frows = await runQuery(admin, workspaceId, {
            metrics: ['meta_fatigue_score', 'meta_fatigue_frequency', 'meta_fatigue_hook_pct_change', 'meta_fatigue_hold_pct_change', 'meta_fatigue_ctr_pct_change', 'meta_fatigue_recent_spend'],
            // thumbnail_url / video_url ride along as dimensions (constant per creative) so
            // the card can show a preview image + a "watch" link.
            groupBy: ['mfat_row__creative_name', 'mfat_row__has_baseline', 'mfat_row__thumbnail_url', 'mfat_row__video_url'],
            orderBy: ['-meta_fatigue_score', '-meta_fatigue_recent_spend'], limit: 12, dateRange,
        })
        const fmap = {
            meta_fatigue_score: 'fatigue_score', meta_fatigue_frequency: 'fatigue_freq',
            meta_fatigue_hook_pct_change: 'fatigue_hook_chg', meta_fatigue_hold_pct_change: 'fatigue_hold_chg',
            meta_fatigue_ctr_pct_change: 'fatigue_ctr_chg', meta_fatigue_recent_spend: 'fatigue_spend',
        }
        const fatigueCreatives = []
        const fatigueAssets = {}
        frows.forEach((r) => {
            const name = r.mfat_row__creative_name
            // only judgeable creatives (ran in both windows) belong on the fatigue card.
            if (!name || r.mfat_row__has_baseline !== true) return
            fatigueCreatives.push(String(name))
            fatigueAssets[name] = { thumb: r.mfat_row__thumbnail_url || null, video: r.mfat_row__video_url || null }
            Object.entries(fmap).forEach(([live, demo]) => {
                if (r[live] == null) return
                totals[`${demo}|${name}`] = { cur: num(r[live]), prev: null }
            })
            hasAny = true
        })
        // stash the ordered creative list + per-creative asset refs for the card.
        if (fatigueCreatives.length) {
            totals['__fatigue_members'] = { cur: fatigueCreatives, prev: null }
            totals['__fatigue_assets'] = { cur: fatigueAssets, prev: null }
        }
    }

    return { totals, series, campaigns, hasAny }
}

/**
 * Load live data for ONE platform into the engine LIVE store. Returns true if any
 * live value landed (so the page can badge the platform live vs sample).
 */
export async function loadPlatformLive(pk, { admin = false, workspaceId, rangeValue = '30d' } = {}) {
    if (pk === 'all') return loadAllLive({ admin, workspaceId, rangeValue })
    const p = preset(rangeValue)
    const dateRange = p.dateRange || 'last_30_days'
    const grainDim = p.days <= 21 ? 'metric_time__day' : 'metric_time__week_sun'
    const grainKey = p.days <= 21 ? 'D' : 'W'

    const out = pk === 'amazon'
        ? await loadAmazon(admin, workspaceId, dateRange, grainDim, grainKey)
        : await loadShared(pk, admin, workspaceId, dateRange, grainDim, grainKey)

    setLive(pk, { ...out, loading: false })
    return out.hasAny
}

/**
 * Blended "all platforms": load each platform's slice so the blended KPI/trend/
 * table cards (which sum the 4 platforms in the engine) read real numbers.
 */
export async function loadAllLive({ admin = false, workspaceId, rangeValue = '30d' } = {}) {
    const platforms = ['amazon', 'flipkart', 'google', 'meta']
    const results = await Promise.all(platforms.map((pk) => loadPlatformLive(pk, { admin, workspaceId, rangeValue })))
    return results.some(Boolean)
}

/** Clear the whole live store (e.g. workspace switch, before a fresh load). */
export function resetLive() { clearLive() }
