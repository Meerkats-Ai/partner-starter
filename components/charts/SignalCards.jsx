/**
 * SignalCards — "what happened · why · what to do" cards for the founder /
 * marketer dashboards.
 *
 * deriveSignals(inputs) is a PURE rule engine over already-fetched metric rows
 * (v1 — deterministic thresholds; agent-generated signals can replace it later
 * without changing the presentational component). Each signal:
 *   { severity: 'alert'|'watch'|'win', title, why, action, cta }
 *
 * Severity is encoded by icon + border (never color alone). `cta` is the short
 * button label; `action` (the full sentence) feeds the investor rollup text.
 */
import React from 'react'
import { fmtMoney, fmtPct } from './chartSetup'

const SEVERITY = {
    alert: { icon: '⚠', border: 'border-red-200', bg: 'bg-red-100/70', title: 'text-red-900', iconCls: 'text-red-600' },
    watch: { icon: '↘', border: 'border-amber-200', bg: 'bg-amber-100/70', title: 'text-amber-900', iconCls: 'text-amber-600' },
    win: { icon: '★', border: 'border-green-200', bg: 'bg-green-100/70', title: 'text-green-900', iconCls: 'text-green-600' },
}

const num = (v) => {
    const x = Number(v)
    return isFinite(x) ? x : 0
}

/**
 * v1 rules. inputs:
 *   kpis / prevKpis  — single-row objects from the KPI strip query (current/previous window)
 *   campaigns        — rows with campaign_row__campaign_name, campaign_spend, real_roas
 *   tierRows         — rows with order__pin_tier, rto_rate, all_orders (optional)
 */
export function deriveSignals({ kpis = {}, prevKpis = {}, campaigns = [], tierRows = [] }) {
    const signals = []

    // 1. Blended ROAS drop >15% WoW → act.
    const roas = num(kpis.roas)
    const prevRoas = num(prevKpis.roas)
    if (prevRoas > 0 && roas > 0 && (prevRoas - roas) / prevRoas > 0.15) {
        signals.push({
            severity: 'alert',
            title: `Blended ROAS fell ${((prevRoas - roas) / prevRoas * 100).toFixed(0)}% — ${roas.toFixed(2)}× vs ${prevRoas.toFixed(2)}×`,
            why: `Ad spend ${fmtMoney(kpis.total_ad_spend)} returned ${fmtMoney(kpis.net_revenue)} net this window. Revenue growth is not keeping pace with spend growth — marginal dollars are converting worse.`,
            action: 'Check the campaign table: shift budget away from the lowest real-ROAS campaign.',
            cta: 'Reallocation model',
        })
    }

    // 2. RTO spike: rate > 12% or +3pp WoW → alert; cite worst tier.
    const rto = num(kpis.rto_rate)
    const prevRto = num(prevKpis.rto_rate)
    if (rto > 0.12 || (prevRto > 0 && rto - prevRto > 0.03)) {
        const worstTier = [...tierRows]
            .filter((t) => num(t.all_orders) >= 5)
            .sort((a, b) => num(b.rto_rate) - num(a.rto_rate))[0]
        signals.push({
            severity: 'alert',
            title: `RTO rate at ${fmtPct(rto)}${prevRto ? ` (${rto > prevRto ? '+' : ''}${((rto - prevRto) * 100).toFixed(1)}pp WoW)` : ''}`,
            why: worstTier
                ? `${worstTier.order__pin_tier} pins are the worst segment at ${fmtPct(worstTier.rto_rate)} RTO — COD orders from low-intent traffic.`
                : 'Returned-to-origin orders are eating margin before restatement.',
            action: 'Open the RTO drill-down: exclude the worst pin prefixes from prospecting.',
            cta: 'Drill into RTO by pin',
        })
    }

    // 3. Underfunded winner: campaign with real ROAS ≥ 1.3× blended on < 15% spend share.
    const totalSpend = campaigns.reduce((a, c) => a + num(c.campaign_spend), 0)
    if (roas > 0 && totalSpend > 0) {
        const winner = [...campaigns]
            .filter((c) => num(c.campaign_spend) > 0 && num(c.real_roas) >= roas * 1.3
                && num(c.campaign_spend) / totalSpend < 0.15)
            .sort((a, b) => num(b.real_roas) - num(a.real_roas))[0]
        if (winner) {
            const share = num(winner.campaign_spend) / totalSpend
            signals.push({
                severity: 'win',
                title: `${winner.campaign_row__campaign_name} at ${num(winner.real_roas).toFixed(2)}× real ROAS — underfunded`,
                why: `Only ${fmtPct(share)} of spend (${fmtMoney(winner.campaign_spend)}) at ${(num(winner.real_roas) / roas).toFixed(1)}× the blended ROAS. Corrected numbers say the headroom is real.`,
                action: 'Scale this campaign; fund it from the weakest prospecting adset.',
                cta: `Scale ${winner.campaign_row__campaign_name}`,
            })
        }
    }

    // 4. Refund creep: refund_rate > 5% and rising → watch.
    const refund = num(kpis.refund_rate)
    const prevRefund = num(prevKpis.refund_rate)
    if (refund > 0.05 && refund > prevRefund) {
        signals.push({
            severity: 'watch',
            title: `Refund rate at ${fmtPct(refund)} and rising`,
            why: `${fmtMoney(kpis.refund_amount)} refunded this window (${fmtPct(prevRefund)} last window).`,
            action: 'Review recent refund reasons; check for a product-quality or sizing issue.',
            cta: 'Review refund reasons',
        })
    }

    return signals.slice(0, 3)
}

export default function SignalCards({ signals = [], loading = false }) {
    if (loading) {
        return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading">
                {[0, 1, 2].map((i) => (
                    <div key={i} className="animate-pulse space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-5">
                        <div className="h-4 w-4 rounded bg-gray-200" />
                        <div className="h-4 w-3/4 rounded bg-gray-200" />
                        <div className="h-3 w-full rounded bg-gray-100" />
                        <div className="h-3 w-2/3 rounded bg-gray-100" />
                    </div>
                ))}
            </div>
        )
    }
    if (!signals.length) {
        return (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-400">
                No signals this window — metrics are inside normal ranges.
            </div>
        )
    }
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {signals.map((s, i) => {
                const sv = SEVERITY[s.severity] || SEVERITY.watch
                return (
                    <div key={i} className={`flex flex-col rounded-xl border ${sv.border} ${sv.bg} p-5`}>
                        <div className={`mb-2 text-lg leading-none ${sv.iconCls}`} aria-hidden="true">{sv.icon}</div>
                        <div className={`mb-1.5 text-sm font-semibold leading-snug ${sv.title}`}>{s.title}</div>
                        <div className="mb-4 text-xs leading-relaxed text-gray-700">{s.why}</div>
                        {(s.cta || s.action) && (
                            <div className="mt-auto">
                                <button type="button" title={s.action}
                                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 shadow-sm hover:bg-gray-50">
                                    {s.cta || s.action} ↗
                                </button>
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
