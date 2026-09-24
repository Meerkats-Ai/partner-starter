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

// The app's live accent, read from the theme's --primary token (set by the skin /
// theme_config / brand color). Chart.js accepts `hsl(var(--x))` color strings, so
// charts follow the agency's theme instead of a hard-coded indigo. Falls back to
// the raw hsl() if the var is unset. `<alpha>` fills work via the /-alpha syntax.
// All chart colors resolve to theme TOKENS (globals.css / skin / theme_config), so
// charts re-theme with the rest of the app. Chart.js accepts `hsl(var(--x))` strings.
// Helpers take optional alpha via the /-alpha syntax. `token()` centralizes the pattern.
const token = (name, fallback, alpha) => {
    const ref = fallback ? `var(${name}, ${fallback})` : `var(${name})`;
    return alpha == null ? `hsl(${ref})` : `hsl(${ref} / ${alpha})`;
};
export const primaryColor = (alpha) => token('--primary', null, alpha);
export const chartColor = (alpha) => token('--chart-1', 'var(--primary)', alpha);

// Brand palette. Every entry is a GETTER so each read resolves the current token at
// paint time (they change when the theme changes). green/amber/rose now map to the
// --success/--warning/--info + --chart tokens instead of fixed hex.
export const COLORS = {
    get primary() { return primaryColor(); },
    get primarySoft() { return primaryColor(0.15); },
    get green() { return token('--success'); },
    get greenSoft() { return token('--success', null, 0.15); },
    get amber() { return token('--warning'); },
    get amberSoft() { return token('--warning', null, 0.15); },
    get rose() { return token('--destructive'); },
    get slate() { return token('--muted-foreground'); },
    get grid() { return token('--muted-foreground', null, 0.12); },
}

// A rotating palette for categorical (channel/platform) bars, all token-driven so
// the whole set follows the theme. --chart-1 leads (it falls back to --primary).
export const SERIES = [
    'hsl(var(--chart-1, var(--primary)))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
    'hsl(var(--primary))',
    'hsl(var(--success))',
    'hsl(var(--info))',
]

// Semantic good/warn/bad trio — performance-coloured marks (ROAS bars, deltas)
// use these instead of the rotating SERIES palette. Getters so they re-theme.
export const SEMANTIC = {
    get good() { return token('--success'); },
    get warn() { return token('--warning'); },
    get bad() { return token('--destructive'); },
}

// ROAS → semantic colour. Bands: ≥2× healthy, 0.9–2× marginal, <0.9× losing money.
export const roasColor = (v) => {
    const x = Number(v)
    if (!isFinite(x)) return token('--muted-foreground')
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
