/**
 * exploreTheme — the shared design tokens for the Explore board's readymade
 * dashboards (Sales / Marketing / Product / Customers). These mirror the
 * reference product's palette 1:1 so the cloned cards read as one system.
 *
 * The old board leaned orange/amber (the Flipkart-analysis accent). The
 * readymade dashboards use the reference scheme instead: indigo/violet primary,
 * a fixed channel palette, and dark KPI values on white cards. Keep every new
 * card sourcing its colours from here — no ad-hoc hexes in card components.
 */

// ── Channel / source palette (Sales by Source, Source-wise Overview) ─────────
// Exact swatches from the reference "Sales by Source" donut + legend.
export const CHANNEL_COLORS = {
    Direct: '#7c3aed',       // violet-600
    Organic: '#86efac',      // green-300
    Others: '#f97316',       // orange-500
    'Paid Google': '#6366f1', // indigo-500
    'Paid Meta': '#4ade80',  // green-400
    Social: '#c4b5fd',       // violet-300
}
// Fallback rotation for any channel not named above (keeps the same family).
export const CHANNEL_FALLBACK = ['#6366f1', '#4ade80', '#f97316', '#7c3aed', '#c4b5fd', '#22d3ee', '#f472b6', '#a3e635']

// Map a raw order__channel value → a display label + colour. The semantic layer
// returns lower/mixed-case channel strings ("paid_google", "direct", …); we
// normalise to the reference's Title Case labels so the legend matches exactly.
// Maps EVERY value the CDP channel classifier (sessioniser classifyChannel) can
// emit — paid_search | paid_social | email | organic_social | organic_search |
// referral | direct | unknown — plus common aliases, to the reference's 6 buckets:
// Direct · Organic · Others · Paid Google · Paid Meta · Social.
const CHANNEL_LABELS = {
    direct: 'Direct',
    // organic search (SEO) + generic organic → "Organic"
    organic: 'Organic', organic_search: 'Organic', seo: 'Organic',
    // referral / email / unmatched / no-attribution → "Others"
    other: 'Others', others: 'Others', referral: 'Others', email: 'Others',
    newsletter: 'Others', unknown: 'Others', '': 'Others',
    // paid search (gclid / cpc on google) → "Paid Google"
    paid_search: 'Paid Google', paid_google: 'Paid Google', google: 'Paid Google',
    'paid google': 'Paid Google', cpc: 'Paid Google', ppc: 'Paid Google',
    // paid social (fbclid / paid on meta) → "Paid Meta"
    paid_social: 'Paid Meta', paid_meta: 'Paid Meta', meta: 'Paid Meta',
    facebook: 'Paid Meta', fb: 'Paid Meta', 'paid meta': 'Paid Meta', 'paid social': 'Paid Meta',
    // ORGANIC social (no ad click) → "Social"
    organic_social: 'Social', social: 'Social', instagram: 'Social', 'social organic': 'Social',
}
export function channelLabel(raw) {
    const key = String(raw ?? '').trim().toLowerCase()
    return CHANNEL_LABELS[key] || (raw ? String(raw).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Others')
}
export function channelColor(label, i = 0) {
    return CHANNEL_COLORS[label] || CHANNEL_FALLBACK[i % CHANNEL_FALLBACK.length]
}

// ── Funnel (Customer Journey) — light→dark indigo ramp, exactly the reference ─
export const FUNNEL_RAMP = ['#c7d2fe', '#a5b4fc', '#818cf8', '#4f46e5', '#312e9e']

// ── Campaign-goal donut (Ad Spend Split) ─────────────────────────────────────
export const GOAL_COLORS = { 'Outcome Sales': '#14b8a6', 'Link Clicks': '#ec4899' }

// ── Semantic deltas (reference uses green ↑ / red ↓) ─────────────────────────
export const DELTA_UP = '#16a34a'    // green-600
export const DELTA_DOWN = '#dc2626'  // red-600

// ── Heatmap green→red conditional cells (Ad Campaign Table) ──────────────────
export const CELL_GOOD_BG = '#bbf7d0'  // green-200
export const CELL_BAD_BG = '#fecaca'   // red-200
export const CELL_GOOD_TX = '#166534'
export const CELL_BAD_TX = '#991b1b'

// ── RFM segment palette (Customer Dashboard mekko) ───────────────────────────
export const RFM_COLORS = {
    Champions: '#f59e0b', 'Loyal Customers': '#059669', 'Potential Loyalist': '#d946ef',
    'New Customers': '#86efac', Promising: '#38bdf8', 'Need Attention': '#f87171',
    'About To Sleep': '#3b82f6', "Can't Lose Them": '#fbbf24', 'At Risk': '#ec4899',
    Hibernating: '#1e3a8a',
}
