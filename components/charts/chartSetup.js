/**
 * Central chart.js registration — import this ONCE per bundle before rendering any
 * react-chartjs-2 chart. Registers only the pieces we use (tree-shakeable) so we
 * don't pull the whole chart.js registry.
 */
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    TimeScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js'

ChartJS.register(
    CategoryScale,
    LinearScale,
    TimeScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement, // Doughnut/Pie (Explore "Sales by Source" donut) needs this
    Tooltip,
    Legend,
    Filler,
)

// Brand palette (matches the CDP page accent + neutral greys).
export const COLORS = {
    primary: '#4f46e5',      // indigo
    primarySoft: 'rgba(79,70,229,0.15)',
    green: '#059669',
    greenSoft: 'rgba(5,150,105,0.15)',
    amber: '#d97706',
    amberSoft: 'rgba(217,119,6,0.15)',
    rose: '#e11d48',
    slate: '#64748b',
    grid: 'rgba(100,116,139,0.12)',
}

// A rotating palette for categorical (channel/platform) bars.
export const SERIES = ['#4f46e5', '#059669', '#d97706', '#e11d48', '#0891b2', '#7c3aed', '#65a30d', '#db2777']

// Semantic good/warn/bad trio — performance-coloured marks (ROAS bars, deltas)
// use these instead of the rotating SERIES palette.
export const SEMANTIC = {
    good: '#16a34a',   // green-600
    warn: '#f59e0b',   // amber-500
    bad: '#ef4444',    // red-500
}

// ROAS → semantic colour. Bands: ≥2× healthy, 0.9–2× marginal, <0.9× losing money.
export const roasColor = (v) => {
    const x = Number(v)
    if (!isFinite(x)) return '#94a3b8'
    return x >= 2 ? SEMANTIC.good : x >= 0.9 ? SEMANTIC.warn : SEMANTIC.bad
}

// One compact segment: K at 1dp ("3.1"), L/Cr at 2dp under 10 ("2.28") else 1dp,
// trailing zeros trimmed ("4.20" → "4.2", "3.0" → "3").
const inrSegment = (v, div, dp) => (v / div).toFixed(dp).replace(/\.?0+$/, '')

// Compact Indian notation — ₹3.1K / ₹4.2L / ₹1.2Cr for headline KPIs and axis
// ticks; exact number below 1,000.
export const fmtMoneyInr = (n) => {
    if (n == null || !isFinite(Number(n))) return '—'
    const v = Number(n)
    const a = Math.abs(v)
    if (a >= 1e7) return `₹${inrSegment(v, 1e7, a >= 1e8 ? 1 : 2)}Cr`
    if (a >= 1e5) return `₹${inrSegment(v, 1e5, a >= 1e6 ? 1 : 2)}L`
    if (a >= 1e3) return `₹${inrSegment(v, 1e3, 1)}K`
    return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

// Plain counts (orders, units, impressions, clicks). Show the FULL grouped number
// (2900 → "2,900", 12340 → "12,340") — no K/L/Cr abbreviation — until the value is
// genuinely huge (≥ 1 billion), where "1.2B" is unavoidable. Rounding counts to
// "2.9K" hides real magnitude, so we only compact at the billions boundary.
export const fmtNumCompact = (n) => {
    if (n == null || !isFinite(Number(n))) return '—'
    const v = Number(n)
    const a = Math.abs(v)
    if (a >= 1e9) return `${inrSegment(v, 1e9, a >= 1e10 ? 1 : 2)}B`
    return v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

// ---- formatters ------------------------------------------------------------
export const fmtMoney = (n, currency = '₹') =>
    n == null ? '—' : `${currency}${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export const fmtNum = (n) =>
    n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })

export const fmtPct = (n) => (n == null ? '—' : `${(Number(n) * 100).toFixed(1)}%`)

// metric_time__* values come back as ISO datetime → short month label.
export const fmtMonth = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

export const fmtDay = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Week label = the week-start date (MetricFlow labels weeks by their start day).
export const fmtWeek = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
