/**
 * TrendDelta — "↗ +18% vs last week" line under a KPI value.
 *
 * Direction is encoded by BOTH glyph and color (never color alone). `invert`
 * flips the good/bad coloring for metrics where DOWN is good (CAC, RTO rate,
 * CPM, refund rate). `tone="caution"` renders the bad direction in amber
 * instead of red — for metrics that are a watch-item when they rise (ad spend,
 * CAC) rather than an outright loss (RTO, refunds). `fmtAbs` renders the
 * absolute delta instead of a percentage (e.g. ROAS "−0.21×").
 * Renders an em-dash when there is no previous value.
 */
import React from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'

const colorFor = (good, tone) => {
    if (good == null) return 'text-muted-foreground/70'
    if (good) return 'text-success'
    return tone === 'caution' ? 'text-warning' : 'text-destructive'
}

// Trend glyph: lucide trending arrows (direction is also in the signed number,
// so meaning never rests on the icon or color alone).
const TrendGlyph = ({ up, down }) => {
    if (up) return <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    if (down) return <TrendingDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    return <span aria-hidden="true">—</span>
}

export default function TrendDelta({ current, previous, invert = false, tone = 'bad', suffix = 'vs last week', fmtAbs }) {
    const cur = current == null ? NaN : Number(current)
    const prev = previous == null ? NaN : Number(previous)
    if (!isFinite(cur) || !isFinite(prev) || prev === 0) {
        return <span className="text-xs text-muted-foreground/60">no comparison data</span>
    }
    const pct = (cur - prev) / Math.abs(prev)
    const up = pct > 0.0005
    const down = pct < -0.0005
    const good = up ? !invert : down ? invert : null
    const pctLabel = `${pct > 0 ? '+' : ''}${(pct * 100).toFixed(Math.abs(pct) < 0.1 ? 1 : 0)}%`
    return (
        <span className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${colorFor(good, tone)}`}>
            <TrendGlyph up={up} down={down} />
            <span>{fmtAbs ? fmtAbs(cur - prev) : pctLabel} {suffix}</span>
        </span>
    )
}

/**
 * Percentage-POINT delta for rate metrics (RTO rate 12% → 14.2% is "+2.2pp",
 * not "+18%"). Same glyph+color rules.
 */
export function TrendDeltaPoints({ current, previous, invert = false, tone = 'bad', suffix = 'vs last week' }) {
    const cur = current == null ? NaN : Number(current)
    const prev = previous == null ? NaN : Number(previous)
    if (!isFinite(cur) || !isFinite(prev)) {
        return <span className="text-xs text-muted-foreground/60">no comparison data</span>
    }
    const pp = (cur - prev) * 100
    const up = pp > 0.05
    const down = pp < -0.05
    const good = up ? !invert : down ? invert : null
    return (
        <span className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${colorFor(good, tone)}`}>
            <TrendGlyph up={up} down={down} />
            <span>{`${pp > 0 ? '+' : ''}${pp.toFixed(1)}pp`} {suffix}</span>
        </span>
    )
}
