/**
 * SpecTable — renders one table card from the Flipkart analysis (see chartGallery.js
 * table specs). Same shell + Pin control as SpecChart, so charts and tables sit
 * side by side on the Explore board and the Cockpit strip.
 *
 * Each `table` key maps to a definition here: the metrics query it runs + how to
 * shape the returned rows into columns. Tables whose segmentation the semantic
 * layer doesn't model yet are marked `needsSetup` in the spec and never reach
 * here (the shared Card renders the setup state instead).
 */
import React, { useMemo } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { useMetrics } from './useMetrics'
import { effectiveWindow, adaptTimeGrain, useCardDate } from './SpecChart'
import { togglePin, isPinned, PINS_CHANGED_EVENT } from './chartSpec'
import { fmtMoneyInr, fmtNumCompact, fmtMonth, fmtDay, fmtWeek } from './chartSetup'

// Read the time bucket + a matching label from a row, whatever grain came back
// (day/week/month) — so a windowed table shows the right buckets, not a
// mislabelled whole-month total.
function timeCell(r) {
    if (r.metric_time__day != null) return fmtDay(r.metric_time__day)
    if (r.metric_time__week_sun != null) return fmtWeek(r.metric_time__week_sun)
    if (r.metric_time__week != null) return fmtWeek(r.metric_time__week)
    if (r.metric_time__month != null) return fmtMonth(r.metric_time__month)
    return '—'
}

const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0 }
const roas = (v) => (v == null || !isFinite(Number(v)) ? '—' : `${Number(v).toFixed(2)}×`)
const money2 = (v) => (v == null || !isFinite(Number(v)) ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)
const pct = (v) => (v == null || !isFinite(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(2)}%`)

// Shared keyword query for the CPC bid-plan tables — declared before TABLES so
// the table defs below can reference it (const isn't hoisted). Spend/revenue/
// clicks/roas per keyword × match_type; CPC + rev-per-click derived client-side.
const KEYWORD_BID_QUERY = {
    // conversions included so RAISE can gate on ≥3 orders (enough signal to bid up).
    metrics: ['fk_keyword_spend', 'fk_keyword_revenue', 'fk_keyword_clicks', 'fk_keyword_roas', 'fk_keyword_conversions'],
    groupBy: ['fk_keyword_row__keyword', 'fk_keyword_row__match_type'],
    orderBy: ['-fk_keyword_spend'], limit: 400,
}

// ── Table definitions ───────────────────────────────────────────────────────
// Each: { query (metrics body sans window), columns(rows) → { head:[], body:[[]] } }
const TABLES = {
    // §1 — spend · revenue · ROAS · CVR · CPC · AOV, by month.
    account_stands: {
        query: {
            metrics: [
                'total_ad_spend', 'ad_conversions_value', 'platform_reported_roas',
                'total_ad_clicks', 'ad_conversions', 'ad_impressions',
            ],
            // Weekly buckets (adaptTimeGrain still narrows to daily for short windows).
            groupBy: ['metric_time__week_sun'], orderBy: ['metric_time__week_sun'],
        },
        shape: (rows) => ({
            head: ['Period', 'Spend', 'Revenue', 'ROAS', 'CVR', 'CPC', 'AOV'],
            align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
            body: (rows || []).map((r) => {
                const spend = num(r.total_ad_spend)
                const rev = num(r.ad_conversions_value)
                const clicks = num(r.total_ad_clicks)
                const conv = num(r.ad_conversions)
                const cvr = clicks > 0 ? conv / clicks : null
                const cpc = clicks > 0 ? spend / clicks : null
                const aov = conv > 0 ? rev / conv : null
                return [
                    timeCell(r),
                    fmtMoneyInr(spend),
                    fmtMoneyInr(rev),
                    roas(r.platform_reported_roas),
                    cvr == null ? '—' : pct(cvr),
                    cpc == null ? '—' : money2(cpc),
                    aov == null ? '—' : money2(aov),
                ]
            }),
        }),
    },
    // §3 — high-ROAS campaigns that barely spend (feed these first). "% of spend"
    // is share of TOTAL ACCOUNT spend for the window (not the winners cohort), and
    // campaigns already taking >2% of account spend are excluded (they aren't
    // "barely spend" — feed the small proven ones). Min ₹1k spend drops noise rows.
    growth_campaigns: {
        query: {
            // High limit + order by spend so the sum over rows ≈ true account total.
            metrics: ['campaign_spend', 'campaign_reported_roas', 'campaign_conversions'],
            groupBy: ['campaign_row__campaign_name'], orderBy: ['-campaign_spend'], limit: 500,
        },
        shape: (rows) => {
            const withSpend = (rows || []).filter((r) => num(r.campaign_spend) > 0)
            // Denominator = total account spend for the window (all campaigns).
            const accountSpend = withSpend.reduce((a, r) => a + num(r.campaign_spend), 0)
            const winners = withSpend
                .filter((r) => {
                    const sp = num(r.campaign_spend)
                    const share = accountSpend ? sp / accountSpend : 0
                    return num(r.campaign_reported_roas) >= 4   // proven winner
                        && sp >= 1000                            // drop noise rows (₹286 etc.)
                        && share <= 0.02                          // "barely spends" — <=2% of account
                })
                .sort((a, b) => num(b.campaign_reported_roas) - num(a.campaign_reported_roas))
                .slice(0, 12)
            return {
                head: ['Campaign', 'ROAS', 'Spend', '% of account'],
                align: ['left', 'right', 'right', 'right'],
                body: winners.map((r) => [
                    r.campaign_row__campaign_name || '(unknown)',
                    roas(r.campaign_reported_roas),
                    fmtMoneyInr(r.campaign_spend),
                    accountSpend ? pct(num(r.campaign_spend) / accountSpend) : '—',
                ]),
            }
        },
    },
    // §3 — ROAS by placement, WITH spend + share-of-spend so the title is
    // supported by the numbers. ROAS = revenue/spend from the placement segment.
    placements_roas: {
        query: {
            metrics: ['fk_placement_spend', 'fk_placement_roas'],
            groupBy: ['fk_placement_row__placement_type'],
            orderBy: ['-fk_placement_spend'], limit: 20,
        },
        shape: (rows) => {
            const withSpend = (rows || []).filter((r) => num(r.fk_placement_spend) > 0)
            const total = withSpend.reduce((a, r) => a + num(r.fk_placement_spend), 0)
            // Sort by ROAS desc so the best placement reads first (supports the story).
            const sorted = [...withSpend].sort((a, b) => num(b.fk_placement_roas) - num(a.fk_placement_roas))
            return {
                head: ['Placement', 'Spend', '% of spend', 'ROAS'],
                align: ['left', 'right', 'right', 'right'],
                body: sorted.map((r) => [
                    r.fk_placement_row__placement_type || '—',
                    fmtMoneyInr(r.fk_placement_spend),
                    total ? pct(num(r.fk_placement_spend) / total) : '—',
                    roas(r.fk_placement_roas),
                ]),
            }
        },
    },
    // §2 — worst BID keywords: high spend, low return. From the Flipkart keyword
    // segment (cdp.flipkart_keywords → fct_flipkart_keywords).
    keyword_drag: {
        query: {
            metrics: ['fk_keyword_spend', 'fk_keyword_roas'],
            groupBy: ['fk_keyword_row__keyword', 'fk_keyword_row__match_type'],
            orderBy: ['-fk_keyword_spend'], limit: 60,
        },
        shape: (rows) => {
            // Worst = spends real money but returns under 1×. Sort by spend, keep the
            // losers (the ones actually dragging the account), like the PDF's list.
            const losers = (rows || [])
                .filter((r) => num(r.fk_keyword_spend) > 0 && num(r.fk_keyword_roas) < 1)
                .sort((a, b) => num(b.fk_keyword_spend) - num(a.fk_keyword_spend))
                .slice(0, 12)
            return {
                head: ['Keyword', 'Match', 'Spend', 'ROAS'],
                align: ['left', 'left', 'right', 'right'],
                body: losers.map((r) => [
                    r.fk_keyword_row__keyword || '—',
                    (r.fk_keyword_row__match_type || '—'),
                    fmtMoneyInr(r.fk_keyword_spend),
                    roas(r.fk_keyword_roas),
                ]),
            }
        },
    },
    // §3 — every search term bucketed by what to do with it (share of spend).
    // From the Flipkart search-query segment (fct_flipkart_search_terms).
    search_term_buckets: {
        query: {
            metrics: ['fk_search_spend', 'fk_search_roas', 'fk_search_clicks'],
            groupBy: ['fk_search_row__query'],
            orderBy: ['-fk_search_spend'], limit: 2000,
        },
        shape: (rows) => {
            // Only terms with enough signal to act on (≥25 clicks), against a 5×
            // target — matches how the action plan buckets are defined.
            const acted = (rows || []).filter((r) => num(r.fk_search_spend) > 0 && num(r.fk_search_clicks) >= 25)
            const total = acted.reduce((a, r) => a + num(r.fk_search_spend), 0)
            const buckets = [
                { label: 'Winners at scale', hint: 'Protect', test: (v) => v >= 5 },
                { label: 'Winners with room', hint: 'Raise bids, add budget', test: (v) => v >= 4 && v < 5 },
                { label: 'Big terms below target', hint: 'Cut bids to their ceiling', test: (v) => v >= 1 && v < 4 },
                { label: 'Dead terms', hint: 'Pause or block', test: (v) => v < 1 },
            ]
            const body = buckets.map((b) => {
                const spend = acted.filter((r) => b.test(num(r.fk_search_roas)))
                    .reduce((a, r) => a + num(r.fk_search_spend), 0)
                return [b.label, total ? pct(spend / total) : '—', b.hint]
            })
            return { head: ['Group', 'Share of spend', 'What to do'], align: ['left', 'right', 'left'], body }
        },
    },
    // §2 — search spend split by ROAS band (winning / marginal / losing). The
    // losing (≤1×) band is spend that converts nothing.
    search_roas_bands: {
        query: {
            metrics: ['fk_search_spend', 'fk_search_roas'],
            groupBy: ['fk_search_row__query'],
            orderBy: ['-fk_search_spend'], limit: 2000,
        },
        shape: (rows) => {
            const withSpend = (rows || []).filter((r) => num(r.fk_search_spend) > 0)
            const total = withSpend.reduce((a, r) => a + num(r.fk_search_spend), 0)
            const bands = [
                { label: 'Winning (≥2×)', test: (v) => v >= 2 },
                { label: 'Marginal (1–2×)', test: (v) => v >= 1 && v < 2 },
                { label: 'Losing (≤1×)', test: (v) => v < 1 },
            ]
            const body = bands.map((b) => {
                const rowsIn = withSpend.filter((r) => b.test(num(r.fk_search_roas)))
                const spend = rowsIn.reduce((a, r) => a + num(r.fk_search_spend), 0)
                return [b.label, fmtMoneyInr(spend), total ? pct(spend / total) : '—']
            })
            return { head: ['ROAS band', 'Spend', '% of search spend'], align: ['left', 'right', 'right'], body }
        },
    },
    // §3 — products competing against themselves: the SAME product earning well in
    // one campaign and losing money in another. From the FSN segment.
    products_competing: {
        query: {
            metrics: ['fk_product_spend', 'fk_product_roas', 'fk_product_revenue'],
            groupBy: ['fk_product_row__product_name', 'fk_product_row__campaign_name'],
            orderBy: ['-fk_product_spend'], limit: 2000,
        },
        shape: (rows) => {
            // Group by product; a product "competes with itself" when it has ≥2
            // campaigns and its best and worst campaign ROAS diverge. Show the losing
            // (lowest-ROAS, with real spend) vs winning (highest-ROAS) campaign.
            const byProduct = new Map()
            for (const r of (rows || [])) {
                const p = r.fk_product_row__product_name
                if (!p || num(r.fk_product_spend) <= 0) continue
                if (!byProduct.has(p)) byProduct.set(p, [])
                byProduct.get(p).push(r)
            }
            const conflicts = []
            for (const [product, cs] of byProduct) {
                if (cs.length < 2) continue
                const sorted = [...cs].sort((a, b) => num(a.fk_product_roas) - num(b.fk_product_roas))
                const losing = sorted[0]
                const winning = sorted[sorted.length - 1]
                // Only a real conflict if the loser is genuinely worse (and spending).
                if (num(winning.fk_product_roas) - num(losing.fk_product_roas) < 1) continue
                conflicts.push({ product, losing, winning, loseSpend: num(losing.fk_product_spend) })
            }
            conflicts.sort((a, b) => b.loseSpend - a.loseSpend)
            return {
                head: ['Product', 'Losing campaign', 'Winning'],
                align: ['left', 'left', 'right'],
                body: conflicts.slice(0, 10).map((c) => [
                    c.product,
                    `${roas(c.losing.fk_product_roas)} on ${fmtMoneyInr(c.losing.fk_product_spend)}`,
                    roas(c.winning.fk_product_roas),
                ]),
            }
        },
    },
    // §4 — CPC bid plan (Fix / Raise / Trim). One shared keyword query; the three
    // tables partition + format it. Max CPC = revenue-per-click ÷ 5 (never pay more
    // per click than a fifth of what a click brings back); new bid = 75% of max.
    bid_fix: { query: KEYWORD_BID_QUERY, shape: (rows) => bidPlanTable(rows, 'fix') },
    bid_raise: { query: KEYWORD_BID_QUERY, shape: (rows) => bidPlanTable(rows, 'raise') },
    bid_trim: { query: KEYWORD_BID_QUERY, shape: (rows) => bidPlanTable(rows, 'trim') },
}

// Build one of the three bid-plan tables from the keyword rows.
//   fix   — ROAS < 1 (bleeding): pause the dead, cut the rest toward the ceiling.
//   raise — winners with room: ONLY on enough signal (≥25 clicks AND ≥3 orders);
//           move at most +20% of current CPC this step; show next-step vs target.
//   trim  — profitable but over its ceiling: stage the cut at −20% per step with
//           weekly re-check; show next-step vs target (not a one-shot −80%).
// Bid ceiling: max CPC = revenue-per-click ÷ 5 (a fifth of what a click returns).
const STEP_UP = 0.20     // cap a RAISE at +20% of current CPC per step
const STEP_DOWN = 0.20   // cap a TRIM at −20% of current CPC per step
const MIN_CLICKS = 25    // enough traffic to trust the number
const MIN_ORDERS = 3     // enough conversions to bid up on

function bidPlanTable(rows, kind) {
    const enriched = (rows || [])
        .filter((r) => num(r.fk_keyword_clicks) > 0 && num(r.fk_keyword_spend) > 0)
        .map((r) => {
            const clicks = num(r.fk_keyword_clicks)
            const spend = num(r.fk_keyword_spend)
            const rev = num(r.fk_keyword_revenue)
            const orders = num(r.fk_keyword_conversions)
            const roasV = num(r.fk_keyword_roas)
            const curCpc = spend / clicks
            const targetCpc = (rev / clicks) / 5     // the ceiling (final target bid)
            return { kw: r.fk_keyword_row__keyword, match: r.fk_keyword_row__match_type, roasV, curCpc, targetCpc, orders, spend }
        })

    if (kind === 'fix') {
        const picked = enriched.filter((r) => r.roasV < 1).sort((a, b) => b.spend - a.spend).slice(0, 12)
        // Dead (<0.9×) → PAUSE; else cut to the ceiling.
        return {
            head: ['Keyword', 'Match', 'ROAS', 'Current CPC', 'Max CPC', 'New bid'],
            align: ['left', 'left', 'right', 'right', 'right', 'right'],
            body: picked.map((r) => [
                r.kw || '—', (r.match || '—'), roas(r.roasV),
                money2(r.curCpc), money2(r.targetCpc),
                r.roasV < 0.9 ? 'PAUSE' : money2(r.targetCpc),
            ]),
        }
    }

    if (kind === 'raise') {
        // Gate: enough signal only. Winner = ROAS ≥ 5 with room (current below ceiling).
        const picked = enriched
            .filter((r) => r.roasV >= 5 && r.orders >= MIN_ORDERS && (r.curCpc * (1 + STEP_UP)) > 0
                && r.spend / r.curCpc >= MIN_CLICKS)   // clicks = spend/cpc ≥ 25
            .filter((r) => r.targetCpc > r.curCpc)      // actually has room to raise
            .sort((a, b) => b.roasV - a.roasV).slice(0, 12)
        return {
            head: ['Keyword', 'Match', 'ROAS', 'Current CPC', 'Next step (+20%)', 'Target bid'],
            align: ['left', 'left', 'right', 'right', 'right', 'right'],
            body: picked.map((r) => {
                const nextStep = Math.min(r.curCpc * (1 + STEP_UP), r.targetCpc)
                return [r.kw || '—', (r.match || '—'), roas(r.roasV), money2(r.curCpc), money2(nextStep), money2(r.targetCpc)]
            }),
        }
    }

    // trim: profitable but paying above its ceiling → stage down 20% per step.
    const picked = enriched
        .filter((r) => r.roasV >= 1 && r.roasV < 5 && r.curCpc > r.targetCpc)
        .sort((a, b) => b.spend - a.spend).slice(0, 12)
    return {
        head: ['Keyword', 'Match', 'ROAS', 'Current CPC', 'Next step (−20%)', 'Target bid'],
        align: ['left', 'left', 'right', 'right', 'right', 'right'],
        body: picked.map((r) => {
            const nextStep = Math.max(r.curCpc * (1 - STEP_DOWN), r.targetCpc)
            return [r.kw || '—', (r.match || '—'), roas(r.roasV), money2(r.curCpc), money2(nextStep), money2(r.targetCpc)]
        }),
    }
}

export const TABLE_KEYS = Object.keys(TABLES)

export default function SpecTable({ spec, admin = false, workspaceId, platform = null, onPinChange, windowOverride = null }) {
    const def = TABLES[spec.table]
    // Per-card date picker (re-datable when pinned to the Cockpit).
    const { win, dateChip } = useCardDate(spec, windowOverride)
    const body = useMemo(() => {
        if (!def) return null
        // Adapt any metric_time__* grain in the table's query to the window span
        // (day/week/month) so a short window shows the right buckets — not a whole
        // month total (MetricFlow truncates month regardless of the date filter).
        const { groupBy, orderBy } = adaptTimeGrain(def.query.groupBy, def.query.orderBy, win)
        return { ...def.query, groupBy, orderBy, ...win }
    }, [def, win])
    const q = useMetrics(body || { metrics: [] }, {
        admin, workspaceId, platform: spec.platformScoped ? platform : null,
    })

    const [pinned, setPinned] = React.useState(() => isPinned(spec.id))
    React.useEffect(() => {
        const sync = () => setPinned(isPinned(spec.id))
        sync()
        window.addEventListener(PINS_CHANGED_EVENT, sync)
        return () => window.removeEventListener(PINS_CHANGED_EVENT, sync)
    }, [spec.id])
    const onToggle = () => { const now = togglePin(spec); setPinned(now); onPinChange?.(now) }

    const shaped = def ? def.shape(q.rows) : { head: [], body: [] }
    const empty = !q.loading && shaped.body.length === 0

    return (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-foreground" title={spec.title}>{spec.title}</h3>
                    {spec.subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground/70" title={spec.subtitle}>{spec.subtitle}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {dateChip}
                    <button type="button" onClick={onToggle}
                        title={pinned ? 'Unpin from Cockpit' : 'Pin to Cockpit'}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                            pinned ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'}`}>
                        {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        {pinned ? 'Pinned' : 'Pin'}
                    </button>
                </div>
            </div>
            {q.loading ? (
                <div className="animate-pulse space-y-2 py-2">
                    {[...Array(5)].map((_, i) => <div key={i} className="h-5 w-full rounded bg-muted" />)}
                </div>
            ) : empty ? (
                <div className="flex h-28 items-center justify-center text-xs text-muted-foreground/60">No data for this window</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground/70">
                                {shaped.head.map((h, i) => (
                                    <th key={h} className={`py-2 font-medium ${shaped.align?.[i] === 'right' ? 'text-right' : 'text-left'}`}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {shaped.body.map((row, ri) => (
                                <tr key={ri} className="text-foreground">
                                    {row.map((cell, ci) => (
                                        <td key={ci} className={`py-2 tabular-nums ${shaped.align?.[ci] === 'right' ? 'text-right' : 'text-left'} ${ci === 0 ? 'max-w-[220px] truncate font-medium text-foreground' : ''}`}
                                            title={ci === 0 ? String(cell) : undefined}>
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
