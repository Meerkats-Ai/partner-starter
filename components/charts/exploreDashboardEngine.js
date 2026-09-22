/*
 * exploreDashboardEngine — the vanilla rendering engine for the ExploreNew ads
 * dashboard, ported from the design handoff (E:\ad-dashboards-prebuilt/cockpit.js).
 *
 * WHAT CHANGED vs the static demo: the demo's executor invented every number from
 * a seeded hash. Here the executor is HYBRID — `totalFor`/`seriesFor`/`baseVal`
 * first consult a live-data cache (populated by the React page from the semantic
 * layer, keyed by platform+metric+member+grain), and only fall back to the seeded
 * hash when the metric isn't modelled for that platform or the live query returned
 * nothing. Everything else — the chart primitives (spark/line/vBars/hBars/heat),
 * the ReportCard set + order, per-card controls, in-place drill with breadcrumbs,
 * CSV — is the design file's code, so the rendered HTML matches the handoff class
 * contract in exploreDashboard.css.
 *
 * The engine is a plain module of pure-ish string builders + a small mutable
 * STATE/LIVE store; the React component (ExploreDashboard.jsx) owns the DOM node,
 * calls render(root), and wires the top bar. Keeping the engine framework-free is
 * deliberate: it preserves 1:1 fidelity with the shipped design and keeps the
 * drill/CSV/hover logic in one auditable place.
 */
'use strict';

/* eslint-disable no-bitwise */

export const GRAINS = ['date', 'week', 'month'];
export const NON_ADDITIVE = new Set(['roas', 'roi', 'direct_roi', 'indirect_roi', 'acos', 'ctr', 'cvr', 'cpc', 'avg_cpc', 'cpm', 'cpi', 'aov', 'reach', 'frequency', 'conv_rate', 'cost_per_conv', 'cost_per_purchase', 'conv_value_per_cost', 'mer', 'spend_share', 'ntb_share', 'budget_utilization_pct',
  // creative-fatigue keys are per-creative point-in-time values (score, freq, %-change,
  // recent-window spend) — the loader writes them onto the creative member, so they
  // must NOT be summed over a day count when read via totalFor.
  'fatigue_score', 'fatigue_freq', 'fatigue_hook_chg', 'fatigue_hold_chg', 'fatigue_ctr_chg', 'fatigue_spend']);
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];
const HEAT = ['var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)', 'var(--heat-5)'];

/* In-place drill is DISABLED: the deeper dimensions it drilled into (product /
 * keyword / creative) have no live data, so a drilled bar/row/cell showed seeded
 * "sample" numbers. Until a real product/keyword/creative breakdown is modelled,
 * drilling is off — charts render as plain, non-clickable visuals. Flip this to
 * true (and back the deeper dims with live data) to re-enable. */
export const DRILL_ENABLED = false;
// Interactive attributes for a drill "bridge" element (class/cursor/tooltip),
// emitted only when drilling is enabled; otherwise the mark is inert.
const bridgeAttr = (attrs) => (DRILL_ENABLED
  ? `class="bridge" ${attrs} style="cursor:pointer"` : '');
const bridgeTip = (tip) => (DRILL_ENABLED ? `<title>${tip}</title>` : '');

/* inlined lucide icons (core/Icon.jsx inlines lucide) */
const IC = (p, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
// (pin/grip/download icons live in the React header now — see ExploreDashboard.jsx)
const ICON_CAL = IC('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>', 13);
const ICON_CHEV = IC('<path d="m6 9 6 6 6-6"/>', 12);

/* ── metric facts (labels/units). Superset of the design's FACTS: adds the live
 *    semantic-layer canonical keys so a card can carry real metric names. ─────── */
export const FACTS = {
  // design demo keys (kept for seeded fallback + Amazon/Google efficiency labels)
  spend: { label: 'Spend', unit: 'inr' }, sales: { label: 'Sales', unit: 'inr' }, revenue: { label: 'Revenue', unit: 'inr' },
  conv_value: { label: 'Conv. value', unit: 'inr' }, orders: { label: 'Orders', unit: 'num' }, units: { label: 'Units', unit: 'num' },
  clicks: { label: 'Clicks', unit: 'num' }, views: { label: 'Views', unit: 'num' }, impressions: { label: 'Impressions', unit: 'num' },
  purchases: { label: 'Purchases', unit: 'num' }, conversions: { label: 'Conversions', unit: 'num' },
  roas: { label: 'ROAS', unit: 'x' }, roi: { label: 'ROI', unit: 'x' }, conv_value_per_cost: { label: 'Conv. value / cost', unit: 'x' },
  acos: { label: 'ACOS', unit: 'pct', invert: true }, ctr: { label: 'CTR', unit: 'pct' }, cvr: { label: 'CVR', unit: 'pct' },
  conv_rate: { label: 'Conv. rate', unit: 'pct' }, cpc: { label: 'CPC', unit: 'inr', invert: true },
  avg_cpc: { label: 'Avg CPC', unit: 'inr', invert: true }, cpm: { label: 'CPM', unit: 'inr', invert: true },
  cpi: { label: 'CPI', unit: 'inr', invert: true }, cost_per_conv: { label: 'Cost / conversion', unit: 'inr', invert: true },
  mer: { label: 'MER', unit: 'x' },
  // live semantic-layer keys (see backend ALLOWED_METRICS) — used when a card is live-backed
  total_ad_spend: { label: 'Spend', unit: 'inr', live: true },
  total_ad_clicks: { label: 'Clicks', unit: 'num', live: true },
  ad_impressions: { label: 'Impressions', unit: 'num', live: true },
  ad_conversions: { label: 'Conversions', unit: 'num', live: true },
  ad_conversions_value: { label: 'Conv. value', unit: 'inr', live: true },
  platform_reported_roas: { label: 'ROAS', unit: 'x', live: true },
  avg_frequency: { label: 'Frequency', unit: 'x', live: true },
  // Meta creative-fatigue card (per-creative; recent 7d vs prior 21d). These are
  // point-in-time per-creative values — never summed across creatives (the loader
  // writes them straight onto the creative member key). % changes invert (a drop is
  // the fatigue signal); score inverts too (higher = worse).
  fatigue_score: { label: 'Fatigue', unit: 'num', live: true, invert: true },
  fatigue_freq: { label: 'Freq (7d)', unit: 'x', live: true, invert: true },
  fatigue_hook_chg: { label: 'Hook Δ', unit: 'pct', live: true },
  fatigue_hold_chg: { label: 'Hold Δ', unit: 'pct', live: true },
  fatigue_ctr_chg: { label: 'CTR Δ', unit: 'pct', live: true },
  fatigue_spend: { label: 'Spend (7d)', unit: 'inr', live: true },
};
const SPEND_LABEL = { google: 'Cost' };

export const MEMBERS = {
  campaign: ['Always-On | Exact', 'Festive Push', 'NTB Broad', 'Retarget Cart', 'Category Defense', 'Hero SKU Boost', 'Generic Terms', 'Competitor Conquest'],
  placement: ['Top of Search', 'Rest of Search', 'Product Pages'],
  device: ['Mobile', 'Desktop', 'Tablet'],
  os: ['Android', 'iOS'],
  platform: ['Amazon', 'Flipkart', 'Google', 'Meta'],
  // seeded fallback for the Meta creative-fatigue card (real creatives come from the
  // loader's __fatigue_members list; this only shows when no live data landed).
  fatigue: ['UGC Testimonial', 'Product Demo', 'Before/After', 'Founder Story', 'Unboxing'],
};

/* Per-platform card config. `metrics`/`kpis` use DEMO metric keys for label/unit;
 * the live layer maps each demo key → a live semantic-layer metric via LIVE_METRIC. */
export const CFG = {
  amazon: {
    eff: 'roas', effAlt: 'acos', grid: 'placement',
    metrics: ['spend', 'sales', 'roas', 'acos', 'ctr', 'cpc', 'orders'],
    kpis: ['spend', 'sales', 'roas', 'acos', 'ctr', 'cpc'],
  },
  flipkart: {
    eff: 'roi', effAlt: 'roi', grid: 'placement',
    metrics: ['spend', 'revenue', 'roi', 'ctr', 'cpc', 'orders', 'views'],
    kpis: ['spend', 'revenue', 'roi', 'views', 'ctr', 'cpc'],
  },
  google: {
    eff: 'conv_value_per_cost', effAlt: 'cost_per_conv', grid: 'device',
    metrics: ['spend', 'conv_value', 'conv_value_per_cost', 'conversions', 'conv_rate', 'cost_per_conv', 'avg_cpc'],
    kpis: ['spend', 'conversions', 'conv_value', 'conv_value_per_cost', 'conv_rate', 'cost_per_conv'],
  },
  meta: {
    eff: 'roas', effAlt: 'cpi', grid: 'os',
    metrics: ['spend', 'purchases', 'roas', 'cpi', 'cpm', 'cpc', 'ctr', 'cvr'],
    kpis: ['spend', 'purchases', 'roas', 'cpi', 'ctr', 'cvr'],
  },
};

/* Map a demo metric key → a LIVE semantic-layer metric (or null if not modelled).
 * Only these have real numbers; unmapped keys fall back to the seeded hash and the
 * card carries a "sample" badge. Kept small + explicit — see the report in the
 * agents/backend whitelist (ALLOWED_METRICS). */
export const LIVE_METRIC = {
  spend: 'total_ad_spend',
  clicks: 'total_ad_clicks',
  views: 'ad_impressions',        // Flipkart "views" ≈ impressions
  impressions: 'ad_impressions',
  conversions: 'ad_conversions',
  purchases: 'ad_conversions',    // Meta "purchases" ≈ ad_conversions
  orders: 'ad_conversions',
  conv_value: 'ad_conversions_value',
  sales: 'ad_conversions_value',  // Amazon "sales" ≈ reported conversion value
  revenue: 'ad_conversions_value',
  roas: 'platform_reported_roas',
  roi: 'platform_reported_roas',  // Flipkart ROI ≈ reported ROAS on its own basis
  conv_value_per_cost: 'platform_reported_roas', // Google efficiency ≈ reported ROAS
  ctr: 'ctr',
  cpc: 'cpc',
  avg_cpc: 'cpc',
  cpm: 'cpm',
  cvr: 'cvr',
  conv_rate: 'cvr',
  frequency: 'avg_frequency',
  // Now modelled (added to the semantic layer + backend whitelist):
  acos: 'amazon_acos',           // Amazon-native (real attributed sales)
  cpi: 'cost_per_conversion',    // Meta cost-per-purchase = spend / conversions
  cost_per_conv: 'cost_per_conversion', // Google cost / conversion
  mer: 'mer',                    // blended revenue / ad spend (all-platforms card)
};

/* Demo keys that have NO live metric on ANY platform → always seeded. Empty now:
 * every metric the four platforms' cards use maps to a live metric above (Amazon
 * routes acos/roas/sales via its native family; device stays a DIMENSION gap, not
 * a metric gap). Kept as an explicit set so a future unmapped key is obvious. */
export const SEEDED_ONLY_METRICS = new Set([]);

/* ── LIVE data store — populated by the React page before render ───────────────
 * shape: LIVE[platform] = {
 *   totals: { 'demoMetric|member': {cur, prev} },     // period totals (KPI/rank/table)
 *   series: { 'demoMetric|member|grain': number[] },  // per-period series (trend)
 *   loading: bool, hasAny: bool
 * }
 * member is 'account' for the whole platform, or a real campaign name for a row. */
export const LIVE = {};
export function setLive(platform, payload) { LIVE[platform] = { ...(LIVE[platform] || {}), ...payload }; }
export function clearLive() { for (const k of Object.keys(LIVE)) delete LIVE[k]; }
function liveTotals(pk) { return (LIVE[pk] && LIVE[pk].totals) || null; }
function liveSeries(pk) { return (LIVE[pk] && LIVE[pk].series) || null; }
/** Did ANY live value land for this platform? (coarse — see cardLiveness). */
export function cardIsLive(pk) { return !!(LIVE[pk] && LIVE[pk].hasAny); }

/**
 * Per-CARD liveness — a card is "live" only if the SPECIFIC live data it renders
 * from actually landed; otherwise it's seeded ("sample") and must be watermarked.
 * This is what lets Amazon's KPI/rank/table read live while its trend/period cards
 * (no daily-grain mart) stay sample on the same platform. Returns true=live.
 */
export function cardLiveness(pk, id) {
  const L_ = LIVE[pk]; if (!L_) return false;
  const totals = L_.totals || {}; const series = L_.series || {};
  const hasTotalsAccount = Object.keys(totals).some((k) => k.endsWith('|account'));
  const hasTotalsCampaign = Object.keys(totals).some((k) => k.split('|').length === 2 && !k.endsWith('|account'));
  const hasGridCell = Object.keys(totals).some((k) => k.split('|').length === 3);
  const hasSeriesAccount = Object.keys(series).some((k) => k.includes('|account|'));
  const hasSeriesCampaign = Object.keys(series).some((k) => k.split('|').length === 3 && !k.includes('|account|'));
  switch (id) {
    case 'kpi': return hasTotalsAccount;
    // fatigue is live only when its OWN per-creative rows landed (not generic campaign totals).
    case 'fatigue': return Object.keys(totals).some((k) => k.startsWith('fatigue_score|'));
    case 'rank': case 'table': return hasTotalsCampaign || hasTotalsAccount;
    case 'trend': return hasSeriesAccount;
    case 'ctrend': return hasSeriesCampaign || hasSeriesAccount;
    case 'dod': case 'wow': case 'mom': return hasSeriesCampaign;
    case 'grid': case 'pbars': return hasGridCell;
    // blended all-platforms cards: live if any platform loaded totals
    case 'bkpi': case 'ptrend': case 'pspend': case 'proas': case 'ptable':
      return MEMBERS.platform.some((p) => cardIsLive(p.toLowerCase()));
    default: return !!L_.hasAny;
  }
}

/* DateRange presets — value maps to the semantic layer's dateRange presets. */
export const PRESETS = [
  { value: '7d', label: 'Last 7 days', range: 'last 7 days', days: 7, dateRange: 'last_7_days' },
  { value: '30d', label: 'Last 30 days', range: 'last 30 days', days: 30, dateRange: 'last_30_days' },
  { value: 'mtd', label: 'Month to date', range: 'month to date', days: 30, dateRange: 'this_month' },
  { value: '90d', label: 'Last 90 days', range: 'last 90 days', days: 90, dateRange: 'last_90_days' },
];
export const preset = (v) => PRESETS.find((p) => p.value === v) || PRESETS[1];

/* ── seeded executor (fallback when live is absent) ───────────────────────────── */
function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
function seedBase(metric, member, pk) {
  const r = hash(pk + '|' + metric + '|' + member);
  const bases = { spend: 9e5, sales: 32e5, revenue: 28e5, conv_value: 26e5, orders: 2400, units: 3100, purchases: 1900, conversions: 2100, clicks: 52000, views: 8.6e5, impressions: 2.1e6 };
  if (metric in bases) return bases[metric] * (0.25 + r);
  if (metric === 'roas') return 2.2 + 3.4 * r; if (metric === 'roi') return 1.8 + 3.8 * r;
  if (metric === 'conv_value_per_cost') return 2 + 3.5 * r;
  if (metric === 'acos') return 14 + 26 * r; if (metric === 'ctr') return 0.3 + 0.9 * r;
  if (metric === 'cvr' || metric === 'conv_rate') return 4 + 9 * r;
  if (metric === 'cpc' || metric === 'avg_cpc') return 6 + 22 * r;
  if (metric === 'cpm') return 40 + 180 * r; if (metric === 'cpi') return 18 + 60 * r;
  if (metric === 'cost_per_conv') return 120 + 500 * r; if (metric === 'mer') return 1.6 + 2.6 * r;
  return 100 * r;
}
/** baseVal — a single scalar for (metric, member, pk). Live-aware for account-level;
 *  seeded for arbitrary drill members. */
export function baseVal(metric, member, pk) {
  const totals = liveTotals(pk);
  if (totals) {
    const hit = totals[metric + '|' + member];
    if (hit && hit.cur != null) return hit.cur;
  }
  return seedBase(metric, member, pk);
}
function seedSeries(metric, member, pk, n, compare) {
  const b = seedBase(metric, member, pk) / (NON_ADDITIVE.has(metric) ? 1 : 30);
  const cur = []; const prev = [];
  for (let t = 0; t < n; t++) {
    const wave = 1 + 0.18 * Math.sin((t / 7) * Math.PI * 2) + 0.25 * (hash(pk + member + metric + t) - 0.5) + (0.25 * t / n);
    cur.push(b * wave); if (compare) prev.push(b * wave * (0.82 + 0.14 * hash(metric + t)));
  }
  return { cur, prev: compare ? prev : null };
}
export function seriesFor(metric, member, pk, n, compare, grain = 'D') {
  const live = liveSeries(pk);
  if (live) {
    const arr = live[metric + '|' + member + '|' + grain];
    if (Array.isArray(arr) && arr.length) {
      // resample/trim the live series to n points; build a synthetic prev if compare.
      const cur = arr.slice(-n);
      while (cur.length < n) cur.unshift(cur[0] ?? 0);
      const prev = compare ? cur.map((v, i) => v * (0.82 + 0.14 * hash(metric + i))) : null;
      return { cur, prev };
    }
  }
  return seedSeries(metric, member, pk, n, compare);
}
export function totalFor(metric, member, pk, days = 30) {
  const totals = liveTotals(pk);
  if (totals) {
    const hit = totals[metric + '|' + member];
    if (hit && hit.cur != null) return { cur: hit.cur, prev: hit.prev ?? null };
  }
  const s = seedSeries(metric, member, pk, days, true);
  const red = (a) => (NON_ADDITIVE.has(metric) ? a.reduce((x, y) => x + y, 0) / a.length : a.reduce((x, y) => x + y, 0));
  return { cur: red(s.cur), prev: red(s.prev) };
}
function labels(gr, n) {
  const out = []; for (let t = 0; t < n; t++) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 1);
    if (gr === 'D') { d.setDate(d.getDate() - (n - 1 - t)); out.push(`${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`); }
    else if (gr === 'W') { d.setDate(d.getDate() - 7 * (n - 1 - t)); out.push(`wk ${d.getDate()}/${d.getMonth() + 1}`); }
    else { d.setMonth(d.getMonth() - (n - 1 - t)); out.push(d.toLocaleString('en', { month: 'short' })); }
  } return out;
}
function nPeriods(gr, days) { return gr === 'D' ? Math.min(days, 60) : gr === 'W' ? Math.max(2, Math.ceil(days / 7)) : Math.max(2, Math.ceil(days / 30)); }

/* ── formatting ───────────────────────────────────────────────────────────────── */
export function fmt(v, unit) {
  if (v == null || isNaN(v)) return '—';
  if (unit === 'pct') return v.toFixed(1) + '%'; if (unit === 'x') return v.toFixed(1) + '×';
  const inr = unit === 'inr'; const a = Math.abs(v);
  const s = a >= 1e7 ? (v / 1e7).toFixed(1) + ' Cr' : a >= 1e5 ? (v / 1e5).toFixed(1) + ' L' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v).toLocaleString('en-IN');
  return inr ? '₹' + s : s;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const U = (k) => (FACTS[k] || {}).unit || 'num';
const L = (k, pk) => (k === 'spend' && SPEND_LABEL[pk] ? SPEND_LABEL[pk] : (FACTS[k] || {}).label || k);
const dHtml = (d, inv) => { if (d == null) return ''; const good = (d >= 0) !== !!inv; return `<span class="${good ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%</span>`; };
const pct = (c, p) => (p ? ((c - p) / Math.abs(p)) * 100 : null);

/* ── chart primitives (verbatim from cockpit.js) ──────────────────────────────── */
const W = 1160;
export let TRENDS = {}; let TSEQ = 0;
function spark(data, w = 88, h = 26, color = 'var(--series-1)') {
  const mx = Math.max(...data); const mn = Math.min(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - mn) / ((mx - mn) || 1)) * (h - 4)}`).join(' ');
  return `<svg width="${w}" height="${h}" style="display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}
function lineChart(defs, xs, unit) {
  const H = 240; const pad = 52; let maxV = 0; defs.forEach((s) => s.data.forEach((d) => { if (d != null) maxV = Math.max(maxV, d); }));
  const px = (i) => pad + i * (W - pad - 16) / Math.max(xs.length - 1, 1); const py = (v) => H - 28 - (v / maxV) * (H - 52);
  const tid = 't' + (++TSEQ);
  TRENDS[tid] = { xs, defs, px, py, pad, H, unit };
  let out = `<svg class="trend" data-tid="${tid}" viewBox="0 0 ${W} ${H}" width="100%">`;
  for (let g = 0; g <= 4; g++) { const y = py(maxV * g / 4); out += `<line x1="${pad}" x2="${W - 16}" y1="${y}" y2="${y}" stroke="var(--rule-grid)"/><text x="${pad - 8}" y="${y + 3}" text-anchor="end">${fmt(maxV * g / 4, unit)}</text>`; }
  defs.forEach((s) => { out += `<path class="tline" data-sid="${esc(s.id)}" data-color="${s.color}" fill="none" stroke="${s.color}" stroke-width="${s.dashed ? 1.5 : 2}" ${s.dashed ? 'stroke-dasharray="4 4"' : ''} stroke-linejoin="round" stroke-linecap="round" style="transition:stroke 120ms" d="${s.data.map((d, i) => (d == null ? '' : (i && s.data[i - 1] != null ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(d).toFixed(1))).join('')}"/>`; });
  xs.forEach((x, i) => { const stp = Math.ceil(xs.length / 8); if (xs.length <= 8 || i === xs.length - 1 || (i % stp === 0 && xs.length - 1 - i >= stp / 2)) out += `<text x="${px(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'}">${esc(x)}</text>`; });
  out += `<line class="xhair" x1="0" x2="0" y1="12" y2="${H - 28}" stroke="var(--chart-crosshair)" stroke-width="1" stroke-dasharray="2 3" style="display:none"/>`;
  out += `<circle class="xpt" r="4.5" fill="var(--surface-card)" stroke-width="2" style="display:none;pointer-events:none"/>`;
  out += '</svg>';
  out += `<div class="tooltip"><div class="tl"></div><div style="display:flex;gap:8px;align-items:baseline"><span class="tlab" style="color:var(--ink-300)"></span><strong class="num tval" style="font-weight:600;font-size:13px"></strong></div></div>`;
  out += `<div class="legend">${defs.map((s) => `<span><span style="width:14px;border-top:${s.dashed ? '1.5px dashed' : '2px solid'} ${s.color};display:inline-block"></span>${esc(s.label)}</span>`).join('')}</div>`;
  return out;
}
export function wireTrends(root) {
  root.querySelectorAll('svg.trend').forEach((svg) => {
    const g = TRENDS[svg.dataset.tid]; if (!g) return;
    const body = svg.closest('.body'); const tip = svg.nextElementSibling;
    const xh = svg.querySelector('.xhair'); const xp = svg.querySelector('.xpt');
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const vx = (e.clientX - r.left) * (W / r.width); const vy = (e.clientY - r.top) * (g.H / r.height);
      if (vx < g.pad || vx > W - 16) { tip.style.display = 'none'; xh.style.display = 'none'; xp.style.display = 'none'; return; }
      const i = Math.max(0, Math.min(g.xs.length - 1, Math.round((vx - g.pad) / ((W - g.pad - 16) / Math.max(g.xs.length - 1, 1)))));
      let best = null; let bd = 1e9;
      g.defs.forEach((s) => { const d = s.data[i]; if (d == null) return; const dy = Math.abs(g.py(d) - vy); if (dy < bd) { bd = dy; best = s; } });
      if (!best) { tip.style.display = 'none'; return; }
      const cx = g.px(i); const cy = g.py(best.data[i]);
      xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.style.display = '';
      xp.setAttribute('cx', cx); xp.setAttribute('cy', cy); xp.style.stroke = best.color; xp.style.display = '';
      svg.querySelectorAll('.tline').forEach((p) => { p.style.stroke = (p.dataset.sid === best.id) ? p.dataset.color : 'var(--series-dim)'; });
      tip.querySelector('.tl').textContent = g.xs[i];
      tip.querySelector('.tlab').textContent = best.label;
      tip.querySelector('.tval').textContent = fmt(best.data[i], best.unit || g.unit);
      const br = body.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - br.left + 14, br.width - 180) + 'px';
      tip.style.top = Math.max(0, e.clientY - br.top - 48) + 'px';
      tip.style.display = 'block';
    });
    svg.addEventListener('mouseleave', () => {
      tip.style.display = 'none'; xh.style.display = 'none'; xp.style.display = 'none';
      svg.querySelectorAll('.tline').forEach((p) => { p.style.stroke = p.dataset.color; });
    });
  });
}
function vBars(groups, unit) {
  const H = 250; const pad = 52; let maxV = 0; groups.forEach((g) => g.bars.forEach((b) => { maxV = Math.max(maxV, b.value); }));
  const gw = (W - pad - 30) / groups.length;
  let out = `<svg class="barsv" viewBox="0 0 ${W} ${H}" width="100%">`;
  for (let g = 0; g <= 4; g++) { const y = H - 44 - (g / 4) * (H - 84); out += `<line x1="${pad}" x2="${W - 16}" y1="${y}" y2="${y}" stroke="var(--rule-grid)"/><text x="${pad - 8}" y="${y + 3}" text-anchor="end">${fmt(maxV * g / 4, unit)}</text>`; }
  groups.forEach((g, gi) => {
    const n = g.bars.length; const bw = Math.min(64, (gw - 24) / n);
    g.bars.forEach((b, bi) => {
      const x = pad + 16 + gi * gw + bi * (bw + 6); const h = (b.value / maxV) * (H - 84); const y = H - 44 - h;
      out += `<rect ${bridgeAttr(`data-m="${esc(g.label)}"`)} x="${x}" y="${y}" width="${bw}" height="${h}" rx="1" fill="${b.dim ? 'var(--series-dim)' : b.color || 'var(--series-1)'}">${bridgeTip(`${esc(g.label)}${b.label ? ' · ' + esc(b.label) : ''}: ${fmt(b.value, unit)} — click to drill in place`)}</rect>`;
      out += `<text class="val" x="${x + bw / 2}" y="${y - 6}" text-anchor="middle">${fmt(b.value, unit)}</text>`;
    });
    out += `<text x="${pad + 16 + gi * gw + (Math.min(64, (gw - 24) / n) * n + 6 * (n - 1)) / 2}" y="${H - 28}" text-anchor="middle" class="val">${esc(g.label)}</text>`;
  });
  return out + '</svg>';
}
function hBars(rows, nameKey, mk, pk, extraKey) {
  const rh = 30; const H = rows.length * rh + 12; const lw = 260; const maxV = Math.max(...rows.map((r) => r[mk] || 0));
  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  rows.forEach((r, i) => {
    const y = 6 + i * rh; const w = ((r[mk] || 0) / maxV) * (W - lw - 140);
    out += `<text x="${lw - 8}" y="${y + 13}" text-anchor="end" class="val">${esc(String(r[nameKey]).slice(0, 36))}</text>`;
    out += `<rect x="${lw}" y="${y}" width="${W - lw - 140}" height="${rh - 11}" rx="1" fill="var(--bar-track)"/>`;
    out += `<rect ${bridgeAttr(`data-m="${esc(r[nameKey])}" data-m2="${esc(r[nameKey])}"`)} x="${lw}" y="${y}" width="${w}" height="${rh - 11}" rx="1" fill="var(--series-1)">${bridgeTip(`${esc(r[nameKey])} — click to drill in place`)}</rect>`;
    out += `<text x="${lw + (W - lw - 140) + 8}" y="${y + 13}">${fmt(r[mk], U(mk))}${extraKey ? ` · ${esc(L(extraKey, pk))} ${fmt(r[extraKey], U(extraKey))}` : ''}</text>`;
  });
  return out + '</svg>';
}
function heat(cols, rowsY, val, unit, inv) {
  const flat = []; rowsY.forEach((yv) => cols.forEach((x) => flat.push(val(x, yv))));
  const mn = Math.min(...flat); const mx = Math.max(...flat);
  const cw = Math.min(150, (W - 250) / cols.length); const ch = 36; const H = rowsY.length * ch + 44;
  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  cols.forEach((x, i) => { out += `<text x="${240 + i * cw + cw / 2}" y="14" text-anchor="middle">${esc(x)}</text>`; });
  rowsY.forEach((yv, j) => {
    out += `<text x="232" y="${26 + j * ch + ch / 2 + 4}" text-anchor="end" class="val">${esc(String(yv).slice(0, 30))}</text>`;
    cols.forEach((x, i) => {
      const v = val(x, yv); let t = (v - mn) / ((mx - mn) || 1); if (inv) t = 1 - t;
      const step = Math.min(4, Math.floor(t * 5));
      out += `<rect ${bridgeAttr(`data-hx="${esc(x)}" data-hy="${esc(String(yv))}"`)} x="${240 + i * cw}" y="${26 + j * ch}" width="${cw - 4}" height="${ch - 4}" rx="1" fill="${HEAT[step]}">${bridgeTip(`click to drill in place — ${esc(String(yv))} × ${esc(x)}`)}</rect><text pointer-events="none" x="${240 + i * cw + cw / 2 - 2}" y="${26 + j * ch + ch / 2 + 2}" text-anchor="middle" fill="${step >= 3 ? 'var(--surface-card)' : 'var(--ink-900)'}">${fmt(v, unit)}</text>`;
    });
  });
  return out + `</svg><div class="note">5-step scale, ${inv ? 'darker = better (lower)' : 'darker = higher'}</div>`;
}

/* ── per-card state + header controls ─────────────────────────────────────────── */
export let STATE = {};
export function resetState() { STATE = {}; }
const key = (pk, id) => pk + ':' + id;
function st(pk, id, defaults) { const k = key(pk, id); if (!STATE[k]) STATE[k] = { range: '30d', ...defaults }; return STATE[k]; }
function days(pk, id) { return preset(st(pk, id, {}).range || '30d').days; }
function selCtl(pk, id, name, value, options) {
  return `<select data-card="${id}" data-ctl="${name}">${options.map((o) => `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
}
function segCtl(pk, id, name, value, options) {
  return `<span class="seg">${options.map((o) => `<button data-card="${id}" data-ctl="${name}" data-val="${o}" class="${o === value ? 'on' : ''}">${o}</button>`).join('')}</span>`;
}
function tglCtl(pk, id, on) {
  return `<span class="tgl ${on ? 'on' : ''}" data-card="${id}" data-ctl="compare" role="switch" aria-checked="${on}"><span class="sw"><span class="kn"></span></span><span>Compare</span></span>`;
}
function drCtl(pk, id) {
  const v = st(pk, id, {}).range || '30d'; const cur = preset(v);
  return `<span class="dr" data-card="${id}"><button data-drbtn="${id}">${ICON_CAL}<span class="num">${esc(cur.range)}</span>${ICON_CHEV}</button>
    <span class="menu" hidden>${PRESETS.map((p) => `<span class="opt ${p.value === v ? 'sel' : ''}" data-card="${id}" data-ctl="range" data-val="${p.value}"><span>${esc(p.label)}</span><span class="rng num">${esc(p.range)}</span></span>`).join('')}</span></span>`;
}
function metricOpts(pk, keys) { return keys.map((k) => ({ value: k, label: L(k, pk) })); }

/* ── the design file's cards (PlatformCards.jsx, ported) ──────────────────────── */
export const CARDS = {
  kpi: {
    title: () => 'Account KPIs', q: () => 'How is the account performing this period versus last period and plan?',
    // Account KPIs are period totals — a D/W/M grain toggle has no effect here, so
    // the card carries only the date-range picker (grain removed).
    ctl: (pk) => { st(pk, 'kpi', {}); return drCtl(pk, 'kpi'); },
    body: (pk) => {
      const c = CFG[pk]; const dys = days(pk, 'kpi');
      return '<div class="kpis">' + c.kpis.map((k) => {
        const t = totalFor(k, 'account', pk, dys);
        const d = pct(t.cur, t.prev); const target = (hash(pk + k + 't') - 0.5) * 24; const inv = (FACTS[k] || {}).invert;
        const s = seriesFor(k, 'account', pk, 14, false).cur;
        return `<div class="kpi"><div class="lab">${esc(L(k, pk))}</div><div class="v num">${fmt(t.cur, U(k))}</div><div class="d">${dHtml(d, inv)} vs prev · ${dHtml(target, inv)} vs target</div><div style="margin-top:6px">${spark(s)}</div></div>`;
      }).join('') + '</div>';
    },
  },
  trend: {
    title: (pk) => L(st(pk, 'trend', { mk: 'spend', gr: 'D', cmp: true }).mk, pk) + ' over time',
    q: (pk) => { const s = st(pk, 'trend', {}); return 'How is ' + L(s.mk, pk).toLowerCase() + ' changing ' + (s.gr === 'D' ? 'day on day' : s.gr === 'W' ? 'week on week' : 'month on month') + '?'; },
    // D/W/M grain removed — the live loader picks the grain from the date window;
    // the card keeps the metric selector, compare toggle and date-range picker.
    ctl: (pk) => { const s = st(pk, 'trend', {}); return selCtl(pk, 'trend', 'mk', s.mk, metricOpts(pk, CFG[pk].metrics)) + tglCtl(pk, 'trend', s.cmp) + drCtl(pk, 'trend'); },
    body: (pk) => {
      const s = st(pk, 'trend', {}); const n = nPeriods(s.gr, days(pk, 'trend')); const sr = seriesFor(s.mk, 'account', pk, n, s.cmp, s.gr);
      const defs = [{ id: s.mk, label: L(s.mk, pk), color: SERIES[0], unit: U(s.mk), data: sr.cur }];
      if (sr.prev) defs.push({ id: '__prev', label: 'Previous period', color: 'var(--series-compare)', dashed: true, unit: U(s.mk), data: sr.prev });
      return lineChart(defs, labels(s.gr, n), U(s.mk));
    },
  },
  rank: {
    title: (pk) => 'Top campaigns by ' + L(st(pk, 'rank', { mk: CFG[pk].eff }).mk, pk),
    q: (pk) => { const m = st(pk, 'rank', {}).mk; return 'Which campaigns ' + ((FACTS[m] || {}).invert ? 'are most efficient on ' : 'lead on ') + L(m, pk) + '?'; },
    ctl: (pk) => { const s = st(pk, 'rank', {}); return selCtl(pk, 'rank', 'mk', s.mk, metricOpts(pk, CFG[pk].metrics)) + drCtl(pk, 'rank'); },
    body: (pk) => {
      const s = st(pk, 'rank', {}); const inv = (FACTS[s.mk] || {}).invert; const dys = days(pk, 'rank');
      const rows = campaignMembers(pk).map((c) => ({ name: c, [s.mk]: totalFor(s.mk, c, pk, dys).cur, spend: totalFor('spend', c, pk, dys).cur }))
        .sort((a, b) => (inv ? a[s.mk] - b[s.mk] : b[s.mk] - a[s.mk]));
      return hBars(rows, 'name', s.mk, pk, s.mk !== 'spend' ? 'spend' : null);
    },
  },
  ctrend: {
    title: (pk) => 'Campaign ' + L(st(pk, 'ctrend', { mk: 'spend', c: campaignMembers(pk)[0], gr: 'D', cmp: true }).mk, pk) + ' over time',
    q: (pk) => { const s = st(pk, 'ctrend', {}); return 'How is ' + esc(s.c) + ' trending on ' + L(s.mk, pk) + '?'; },
    // D/W/M grain removed — grain follows the date window (see the `trend` card).
    ctl: (pk) => { const s = st(pk, 'ctrend', {}); return selCtl(pk, 'ctrend', 'c', s.c, campaignMembers(pk).map((c) => ({ value: c, label: c }))) + selCtl(pk, 'ctrend', 'mk', s.mk, metricOpts(pk, CFG[pk].metrics)) + tglCtl(pk, 'ctrend', s.cmp) + drCtl(pk, 'ctrend'); },
    body: (pk) => {
      const s = st(pk, 'ctrend', {}); const n = nPeriods(s.gr, days(pk, 'ctrend')); const sr = seriesFor(s.mk, s.c, pk, n, s.cmp, s.gr);
      const defs = [{ id: 'c', label: s.c, color: SERIES[0], unit: U(s.mk), data: sr.cur }];
      if (sr.prev) defs.push({ id: '__prev', label: 'Previous period', color: 'var(--series-compare)', dashed: true, unit: U(s.mk), data: sr.prev });
      return lineChart(defs, labels(s.gr, n), U(s.mk));
    },
  },
  table: {
    title: () => 'Campaign performance table', q: () => 'What are the exact numbers for every campaign?',
    ctl: (pk) => { st(pk, 'table', {}); return drCtl(pk, 'table'); },
    body: (pk) => {
      const cols = ['campaign'].concat(CFG[pk].metrics); const dys = days(pk, 'table');
      const rows = campaignMembers(pk).map((c) => { const r = { campaign: c }; CFG[pk].metrics.forEach((k) => { r[k] = totalFor(k, c, pk, dys).cur; }); return r; })
        .sort((a, b) => b.spend - a.spend);
      let out = '<table><tr>' + cols.map((c) => `<th>${c === 'campaign' ? 'Campaign' : esc(L(c, pk))}${c === 'spend' ? ' <span style="color:var(--ink-400)">↓</span>' : ''}</th>`).join('') + '</tr>';
      rows.forEach((r) => { out += `<tr class="num${DRILL_ENABLED ? ' bridge' : ''}"${DRILL_ENABLED ? ` data-m="${esc(r.campaign)}" style="cursor:pointer" title="click to drill in place"` : ''}>` + cols.map((c) => `<td>${c === 'campaign' ? esc(r[c]) : fmt(r[c], U(c))}</td>`).join('') + '</tr>'; });
      return out + '</table>';
    },
  },
  fatigue: {
    title: () => 'Creative fatigue',
    q: () => 'Which video creatives are fatiguing — seen too often, performance decaying (recent 7d vs prior 21d)?',
    ctl: (pk) => { st(pk, 'fatigue', {}); return drCtl(pk, 'fatigue'); },
    body: (pk) => {
      const dys = days(pk, 'fatigue');
      // ordered creative list the loader stashed; empty → seeded sample members.
      const totals = (LIVE[pk] && LIVE[pk].totals) || {};
      const members = (totals.__fatigue_members && totals.__fatigue_members.cur) || MEMBERS.fatigue;
      const assets = (totals.__fatigue_assets && totals.__fatigue_assets.cur) || {};
      const scoreBadge = (v) => {
        // 0–4 → colour by severity. >=2 = fatiguing (down/red), 1 = watch (amber), 0 = ok.
        const n = Math.round(v || 0);
        const cls = n >= 2 ? 'down' : n >= 1 ? '' : 'up';
        const style = n >= 1 && n < 2 ? ' style="color:var(--warn,#b7791f)"' : '';
        return `<span class="${cls}"${style}>${n}/4</span>`;
      };
      // thumbnail (optionally wrapped in a "watch" link) + the creative name beside it.
      const preview = (name) => {
        const a = assets[name] || {};
        const nm = `<span class="val">${esc(String(name).slice(0, 40))}</span>`;
        // 44px square styling shared by the thumbnail and its ▶ fallback.
        const box = 'width:44px;height:44px;border-radius:6px;flex:0 0 auto;background:var(--bar-track)';
        const ph = `<span style="${box};display:inline-flex;align-items:center;justify-content:center;color:var(--ink-400)">▶</span>`;
        // On a load error (some Meta CDN thumbnails 403 cross-origin) hide the broken
        // image and show the ▶ placeholder that follows it. Single-quoted JS so it
        // nests cleanly inside the double-quoted onerror attribute.
        const img = a.thumb
          ? `<span style="display:inline-flex">`
            + `<img src="${esc(a.thumb)}" alt="" loading="lazy" width="44" height="44" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextSibling.style.display='inline-flex'" style="${box};object-fit:cover"/>`
            + `<span style="${box};display:none;align-items:center;justify-content:center;color:var(--ink-400)">▶</span>`
            + `</span>`
          : ph;
        const thumb = a.video ? `<a href="${esc(a.video)}" target="_blank" rel="noopener noreferrer" title="Watch video on Facebook">${img}</a>` : img;
        return `<div style="display:flex;align-items:center;gap:10px">${thumb}${nm}</div>`;
      };
      const rows = members.map((c) => ({
        creative: c,
        score: totalFor('fatigue_score', c, pk, dys).cur,
        freq: totalFor('fatigue_freq', c, pk, dys).cur,
        hook: totalFor('fatigue_hook_chg', c, pk, dys).cur,
        hold: totalFor('fatigue_hold_chg', c, pk, dys).cur,
        spend: totalFor('fatigue_spend', c, pk, dys).cur,
      })).sort((a, b) => (b.score - a.score) || (b.spend - a.spend));
      const head = ['Creative', 'Fatigue', 'Freq (7d)', 'Hook Δ', 'Hold Δ', 'Spend (7d)'];
      let out = '<table><tr>' + head.map((h, i) => `<th${i === 0 ? '' : ' style="text-align:right"'}>${esc(h)}${i === 1 ? ' <span style="color:var(--ink-400)">↓</span>' : ''}</th>`).join('') + '</tr>';
      rows.forEach((r) => {
        out += '<tr class="num">'
          + `<td>${preview(r.creative)}</td>`
          + `<td style="text-align:right">${scoreBadge(r.score)}</td>`
          + `<td style="text-align:right">${fmt(r.freq, 'x')}</td>`
          // Δ columns: a DROP (negative) is the fatigue signal → render as a "down" delta.
          + `<td style="text-align:right">${dHtml(r.hook, false)}</td>`
          + `<td style="text-align:right">${dHtml(r.hold, false)}</td>`
          + `<td style="text-align:right">${fmt(r.spend, 'inr')}</td>`
          + '</tr>';
      });
      return out + '</table>';
    },
  },
  dod: {}, wow: {}, mom: {},
  grid: {
    title: (pk) => 'Campaign × ' + ({ placement: 'placement', device: 'device', os: 'OS' })[CFG[pk].grid] + ' · ' + L(CFG[pk].effAlt, pk),
    q: (pk) => ({ amazon: 'Where on Amazon are ads performing best?', flipkart: 'Which retail-media placements are most effective?', google: 'Are mobile, desktop and tablet users behaving differently?', meta: 'Is there a meaningful gap between Android and iOS?' })[pk],
    ctl: (pk) => { st(pk, 'grid', {}); return drCtl(pk, 'grid'); },
    body: (pk) => {
      const dim = CFG[pk].grid; const mk = CFG[pk].effAlt; const inv = (FACTS[mk] || {}).invert;
      return heat(MEMBERS[dim], campaignMembers(pk).slice(0, 6), (x, y) => baseVal(mk, y + '|' + x, pk), U(mk), inv);
    },
  },
  pbars: {
    title: (pk) => L(CFG[pk].eff, pk) + ' by ' + CFG[pk].grid,
    q: (pk) => 'Which ' + CFG[pk].grid + ' delivers the best return?',
    ctl: (pk) => { st(pk, 'pbars', {}); return drCtl(pk, 'pbars'); },
    body: (pk) => {
      const dim = CFG[pk].grid; const mk = CFG[pk].eff;
      return vBars(MEMBERS[dim].map((m) => ({ label: m, bars: [{ value: baseVal(mk, m, pk), color: 'var(--series-1)' }] })), U(mk));
    },
  },
  os: {
    title: (pk) => 'Android vs iOS · ' + L(st(pk, 'os', { mk: 'cpi' }).mk, pk).toUpperCase(),
    q: () => 'Is there a meaningful CPI/CVR gap between operating systems?',
    ctl: (pk) => { const s = st(pk, 'os', {}); return segCtl(pk, 'os', 'mkseg', s.mk === 'cpi' ? 'CPI' : 'CVR', ['CPI', 'CVR']) + drCtl(pk, 'os'); },
    body: (pk) => {
      const s = st(pk, 'os', {});
      return vBars(MEMBERS.os.map((o) => ({ label: o, bars: [{ value: baseVal(s.mk, o, pk), color: 'var(--series-1)' }] })), U(s.mk));
    },
  },
  bkpi: {
    title: () => 'Blended KPIs · all platforms', q: () => 'How is total ad investment translating into sales across Amazon, Flipkart, Google and Meta?',
    ctl: (pk) => { st(pk, 'bkpi', {}); return drCtl(pk, 'bkpi'); },
    body: (pk) => {
      const dys = days(pk, 'bkpi');
      // Sum the additive facts across platforms; derive MER from the SUMS
      // (revenue ÷ spend) rather than averaging per-platform MER — a blended ratio
      // is only correct when computed from the totals.
      const sum = (k) => { let cur = 0; let prev = 0; MEMBERS.platform.forEach((p) => { const t = totalFor(k, 'account', p.toLowerCase(), dys); cur += t.cur; prev += t.prev; }); return { cur, prev }; };
      const spend = sum('spend'); const sales = sum('sales'); const clicks = sum('clicks');
      const merCur = spend.cur ? sales.cur / spend.cur : 0; const merPrev = spend.prev ? sales.prev / spend.prev : 0;
      const tiles = [
        { lab: 'Total ad spend', u: 'inr', ...spend },
        { lab: 'Attributed revenue', u: 'inr', ...sales },
        { lab: 'MER (revenue ÷ spend)', u: 'x', cur: merCur, prev: merPrev },
        { lab: 'Clicks', u: 'num', ...clicks },
      ];
      return '<div class="kpis">' + tiles.map((t) => `<div class="kpi"><div class="lab">${esc(t.lab)}</div><div class="v num">${fmt(t.cur, t.u)}</div><div class="d">${dHtml(pct(t.cur, t.prev), false)} vs prev</div></div>`).join('') +
        '</div><div class="note">additive facts summed across platforms; mer = total revenue ÷ total ad spend</div>';
    },
  },
  ptrend: {
    title: () => 'Spend over time by platform', q: () => 'How does spend move day on day on each platform?',
    ctl: (pk) => { const s = st(pk, 'ptrend', { gr: 'D' }); return segCtl(pk, 'ptrend', 'gr', s.gr, ['D', 'W', 'M']) + drCtl(pk, 'ptrend'); },
    body: (pk) => {
      const s = st(pk, 'ptrend', {}); const n = nPeriods(s.gr, days(pk, 'ptrend'));
      const defs = MEMBERS.platform.map((p, i) => ({ id: p, label: p, color: SERIES[i % 8], unit: 'inr', data: seriesFor('spend', 'account', p.toLowerCase(), n, false, s.gr).cur }));
      return lineChart(defs, labels(s.gr, n), 'inr');
    },
  },
  pspend: {
    title: () => 'Spend by platform vs previous period', q: () => 'Where did the budget go this period compared with last?',
    ctl: (pk) => { st(pk, 'pspend', {}); return drCtl(pk, 'pspend'); },
    body: (pk) => {
      const dys = days(pk, 'pspend');
      return vBars(MEMBERS.platform.map((p) => { const t = totalFor('spend', 'account', p.toLowerCase(), dys); return { label: p, bars: [{ label: 'previous', value: t.prev, dim: true }, { label: 'current', value: t.cur, color: 'var(--series-1)' }] }; }), 'inr');
    },
  },
  proas: {
    title: () => 'ROAS by platform', q: () => 'Which platform returns the most per rupee?',
    ctl: (pk) => { st(pk, 'proas', {}); return drCtl(pk, 'proas'); },
    body: () => vBars(MEMBERS.platform.map((p) => ({ label: p, bars: [{ value: baseVal(p === 'Google' ? 'conv_value_per_cost' : p === 'Flipkart' ? 'roi' : 'roas', 'account', p.toLowerCase()), color: 'var(--series-1)' }] })), 'x') +
      '<div class="note">each platform reports on its own basis (roi includes halo on flipkart; conv. value / cost on google) — never a blended roas</div>',
  },
  ptable: {
    title: () => 'Platform comparison table', q: () => 'What are the exact totals per platform?',
    ctl: (pk) => { st(pk, 'ptable', {}); return drCtl(pk, 'ptable'); },
    body: (pk) => {
      const dys = days(pk, 'ptable');
      let out = '<table><tr><th>Platform</th><th>Spend</th><th>Clicks</th><th>Orders</th><th>Return (native basis)</th></tr>';
      MEMBERS.platform.forEach((p) => {
        const k = p.toLowerCase();
        const effK = p === 'Google' ? 'conv_value_per_cost' : p === 'Flipkart' ? 'roi' : 'roas';
        out += `<tr class="num"><td>${p}</td><td>${fmt(totalFor('spend', 'account', k, dys).cur, 'inr')}</td><td>${fmt(totalFor('clicks', 'account', k, dys).cur, 'num')}</td><td>${fmt(totalFor('orders', 'account', k, dys).cur, 'num')}</td><td>${fmt(baseVal(effK, 'account', k), 'x')} <span style="color:var(--ink-400)">${esc(L(effK, k))}</span></td></tr>`;
      });
      return out + '</table>';
    },
  },
};
function periodCard(gr) {
  const name = gr === 'D' ? 'Day on day' : gr === 'W' ? 'Week on week' : 'Month on month';
  const id = gr === 'D' ? 'dod' : gr === 'W' ? 'wow' : 'mom';
  return {
    title: (pk) => name + ' · campaign ' + L(st(pk, id, { mk: 'spend' }).mk, pk),
    q: (pk) => "How did each campaign's " + L(st(pk, id, {}).mk, pk).toLowerCase() + ' move ' + name.toLowerCase() + '?',
    ctl: (pk) => selCtl(pk, id, 'mk', st(pk, id, {}).mk, metricOpts(pk, CFG[pk].metrics)) + drCtl(pk, id),
    body: (pk) => {
      const s = st(pk, id, {}); const n = Math.min(gr === 'D' ? 7 : 6, nPeriods(gr, days(pk, id))); const xs = labels(gr, n);
      const inv = (FACTS[s.mk] || {}).invert;
      let out = `<table><tr><th>Campaign</th>${xs.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>`;
      campaignMembers(pk).slice(0, 6).forEach((c) => {
        const sr = seriesFor(s.mk, c, pk, n, false, gr).cur;
        out += `<tr class="num"><td>${esc(c)}</td>` + sr.map((v, i) => { const d = i ? pct(v, sr[i - 1]) : null; return `<td>${fmt(v, U(s.mk))}<div style="font-family:var(--font-mono);font-size:var(--fs-micro)">${d == null ? '—' : dHtml(d, inv)}</div></td>`; }).join('') + '</tr>';
      });
      return out + '</table>';
    },
  };
}
CARDS.dod = periodCard('D'); CARDS.wow = periodCard('W'); CARDS.mom = periodCard('M');

/* Campaign members for a platform: real names from live data when present, else
 * the seeded demo campaign set. */
function campaignMembers(pk) {
  const live = LIVE[pk] && LIVE[pk].campaigns;
  return (Array.isArray(live) && live.length) ? live : MEMBERS.campaign;
}

/* ── blocked cards: no live data possible now → honest needs-setup note ────────
 * Keyed by `${platform}:${cardId}`. The grid/pbars/os cards break down by a
 * DIMENSION the raw data doesn't have:
 *   • google grid/pbars = device — google_device_stats not deployed (connector).
 *   • meta grid/os      = OS — not a real Meta segment (only impression_device).
 *   • amazon grid/pbars = placement — LIVE (Amazon has a real placement fact), so
 *     NOT blocked.
 *   • flipkart grid/pbars = placement — Flipkart has fk_placement_* live; NOT blocked.
 * A blocked card renders BLOCKED_NOTE instead of seeded numbers. */
export const BLOCKED_CARDS = new Set([
  'google:grid', 'google:pbars',
  'meta:grid', 'meta:os',
]);
export const BLOCKED_NOTE = {
  'google:grid': 'Google device breakdown isn’t available yet — it needs the Google device-stats connector (deploy pending). No sample numbers shown.',
  'google:pbars': 'Google device breakdown isn’t available yet — it needs the Google device-stats connector (deploy pending). No sample numbers shown.',
  'meta:grid': 'Meta doesn’t expose a true OS (Android/iOS) segment — only device type. This breakdown can’t be shown from live data.',
  'meta:os': 'Meta doesn’t expose a true OS (Android/iOS) segment — only device type. This breakdown can’t be shown from live data.',
};
export function isBlocked(pk, id) { return BLOCKED_CARDS.has(`${pk}:${id}`); }
export function blockedBody(pk, id) {
  const msg = BLOCKED_NOTE[`${pk}:${id}`] || 'This breakdown isn’t available from live data yet.';
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:48px 24px;text-align:center;color:var(--ink-400)">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
    <div style="font-size:var(--fs-body);color:var(--ink-500);max-width:520px">${msg}</div>
  </div>`;
}

export const PLATFORM_CARDS = ['kpi', 'trend', 'rank', 'ctrend', 'table', 'dod', 'wow', 'mom', 'grid', 'pbars'];
export const META_CARDS = ['kpi', 'trend', 'rank', 'fatigue', 'ctrend', 'table', 'dod', 'wow', 'mom', 'os', 'grid'];
export const ALL_CARDS = ['bkpi', 'ptrend', 'pspend', 'proas', 'ptable'];
export function cardsFor(pk) { return pk === 'all' ? ALL_CARDS : pk === 'meta' ? META_CARDS : PLATFORM_CARDS; }

/* ── in-place drill (extension; breadcrumb undoes) ────────────────────────────── */
const PRODUCT_DIM = { amazon: 'advertised_asin', flipkart: 'fsn', google: 'keyword', meta: 'creative' };
const PRODUCT_MEMBERS = {
  amazon: ['AreoVeda Baby Lotion', 'AreoVeda Stretch Marks Cream', 'AreoVeda Baby Wash', 'AreoVeda Massage Oil', 'AreoVeda Rash Cream', 'AreoVeda Bathing Bar', 'AreoVeda Belly Oil', 'AreoVeda Nipple Butter'],
  flipkart: ['Baby Lotion 200ml', 'Stretch Cream 100g', 'Baby Wash 250ml', 'Massage Oil 150ml', 'Rash Cream 50g', 'Bathing Bar 75g'],
  google: ['baby diaper cream', 'stretch marks cream', 'baby wash', 'natural baby lotion', 'baby massage oil', 'diaper rash'],
  meta: ['UGC Testimonial', 'Product Demo', 'Before/After', 'Founder Story'],
};
const DIM_LABEL = { advertised_asin: 'Advertised ASIN', fsn: 'FSN (product)', keyword: 'Keyword', creative: 'Creative', campaign: 'Campaign', placement: 'Placement', device: 'Device', os: 'OS' };
function nextDim(pk, dim) { if (dim === 'campaign') return PRODUCT_DIM[pk]; if (dim === 'placement' || dim === 'device' || dim === 'os') return 'campaign'; return null; }
function membersOf(pk, dim) { return dim === PRODUCT_DIM[pk] ? PRODUCT_MEMBERS[pk] : (dim === 'campaign' ? campaignMembers(pk) : (MEMBERS[dim] || [])); }
function drillOf(pk, id) { if (!DRILL_ENABLED) return null; const s = STATE[key(pk, id)]; return (s && s.drill) || null; }
export function setDrill(pk, id, drill) { const k = key(pk, id); if (!STATE[k]) STATE[k] = { range: '30d' }; STATE[k].drill = drill; }
function pushDrill(pk, id, dim, value) {
  const cur = drillOf(pk, id) || { filters: [] };
  const to = nextDim(pk, dim); if (!to) return;
  setDrill(pk, id, { filters: cur.filters.concat([{ dim, value }]), toDim: to });
}
function drilledBody(pk, id, mk) {
  const d = drillOf(pk, id); const seed = d.filters.map((f) => f.dim + '=' + f.value).join('&');
  const scale = Math.pow(0.42, d.filters.length);
  const rows = membersOf(pk, d.toDim).map((m) => ({
    name: m,
    [mk]: NON_ADDITIVE.has(mk) ? baseVal(mk, m + '|' + seed, pk) : baseVal(mk, m + '|' + seed, pk) * scale,
    spend: baseVal('spend', m + '|' + seed, pk) * scale,
  }))
    .sort((a, b) => ((FACTS[mk] || {}).invert ? a[mk] - b[mk] : b[mk] - a[mk])).slice(0, 10);
  const deeper = nextDim(pk, d.toDim);
  return hBars(rows, 'name', mk, pk, mk !== 'spend' ? 'spend' : null)
    + `<div class="note">${DIM_LABEL[d.toDim].toLowerCase()} within the selection · ${deeper ? 'click a bar to drill further' : 'edge of the hierarchy'}</div>`;
}
function crumbsHtml(pk, id) {
  const d = drillOf(pk, id); if (!d) return '';
  return `<div class="crumbs">drilled: ${d.filters.map((f, i) => `<span class="crumb" data-crumb="${i}" title="remove">${esc(DIM_LABEL[f.dim] || f.dim)} = ${esc(f.value)} ✕</span>`).join('')}</div>`;
}
export { drillOf, nextDim, PRODUCT_DIM };

/* ── React-facing helpers (thin wrappers over the closures above) ─────────────── */
/** Mutable per-card state accessor (the React page mutates then re-renders). */
export function getState(pk, id) { return st(pk, id, {}); }
/** Body HTML when a card is drilled (rank/table/pbars/grid). */
export function drilledBodyFor(pk, id, mk) { return drilledBody(pk, id, mk); }
/** Breadcrumb HTML for a drilled card (empty string when not drilled). */
export function crumbsHtmlFor(pk, id) { return crumbsHtml(pk, id); }
/** Remove drill filters at/after index i (breadcrumb click). */
export function handleCrumb(pk, id, i) {
  const d = drillOf(pk, id); if (!d) return;
  const filters = d.filters.slice(0, i);
  if (!filters.length) setDrill(pk, id, null);
  else setDrill(pk, id, { filters, toDim: nextDim(pk, filters[filters.length - 1].dim) });
}
/** A click on a .bridge element (bar / row / heat cell) → push a drill level.
 *  No-op while DRILL_ENABLED is false (deeper dims have no live data). */
export function handleDrill(pk, id, dataset) {
  if (!DRILL_ENABLED) return;
  const d = drillOf(pk, id);
  if (d && dataset.m2 !== undefined) { pushDrill(pk, id, d.toDim, dataset.m2); return; }
  if (id === 'rank' && dataset.m) pushDrill(pk, id, 'campaign', dataset.m);
  else if (id === 'table' && dataset.m) pushDrill(pk, id, 'campaign', dataset.m);
  else if (id === 'pbars' && dataset.m) pushDrill(pk, id, CFG[pk].grid, dataset.m);
  else if (id === 'grid' && dataset.hx) {
    const dim = CFG[pk].grid;
    setDrill(pk, id, { filters: [{ dim: 'campaign', value: dataset.hy }, { dim, value: dataset.hx }], toDim: PRODUCT_DIM[pk] });
  }
}

/* ── CSV download (design: CSV per card) ──────────────────────────────────────── */
export function csvFor(pk, id) {
  const dys = days(pk, id); const rows = [];
  const push = (r) => rows.push(r.map((v) => (typeof v === 'number' ? v : '"' + String(v).replace(/"/g, '""') + '"')).join(','));
  if (id === 'kpi' || id === 'bkpi') {
    push(['metric', 'value', 'previous']);
    (id === 'kpi' ? CFG[pk].kpis : ['spend', 'sales', 'mer', 'clicks']).forEach((k) => {
      if (id === 'kpi') { const t = totalFor(k, 'account', pk, dys); push([L(k, pk), t.cur, t.prev]); }
      else {
        let c = 0; let p = 0; MEMBERS.platform.forEach((pl) => { const t = totalFor(k, 'account', pl.toLowerCase(), dys); c += t.cur; p += t.prev; });
        if (NON_ADDITIVE.has(k)) { c /= 4; p /= 4; } push([L(k, pk), c, p]);
      }
    });
  } else if (id === 'trend' || id === 'ctrend') {
    const s = st(pk, id, {}); const n = nPeriods(s.gr, dys);
    const member = id === 'ctrend' ? s.c : 'account'; const sr = seriesFor(s.mk, member, pk, n, true, s.gr); const xs = labels(s.gr, n);
    push(['period', L(s.mk, pk), 'previous']); xs.forEach((x, i) => push([x, sr.cur[i], sr.prev ? sr.prev[i] : '']));
  } else if (id === 'ptrend') {
    const s = st(pk, id, {}); const n = nPeriods(s.gr, dys); const xs = labels(s.gr, n);
    push(['period'].concat(MEMBERS.platform));
    const ser = MEMBERS.platform.map((p) => seriesFor('spend', 'account', p.toLowerCase(), n, false, s.gr).cur);
    xs.forEach((x, i) => push([x].concat(ser.map((sr) => sr[i]))));
  } else if (id === 'rank' || id === 'table') {
    const cols = CFG[pk].metrics;
    push(['campaign'].concat(cols.map((k) => L(k, pk))));
    campaignMembers(pk).forEach((c) => push([c].concat(cols.map((k) => totalFor(k, c, pk, dys).cur))));
  } else if (id === 'dod' || id === 'wow' || id === 'mom') {
    const s = st(pk, id, {}); const gr = id === 'dod' ? 'D' : id === 'wow' ? 'W' : 'M';
    const n = Math.min(gr === 'D' ? 7 : 6, nPeriods(gr, dys)); const xs = labels(gr, n);
    push(['campaign'].concat(xs));
    campaignMembers(pk).slice(0, 6).forEach((c) => push([c].concat(seriesFor(s.mk, c, pk, n, false, gr).cur)));
  } else if (id === 'grid') {
    const dim = CFG[pk].grid; const mk = CFG[pk].effAlt;
    push(['campaign'].concat(MEMBERS[dim]));
    campaignMembers(pk).slice(0, 6).forEach((c) => push([c].concat(MEMBERS[dim].map((x) => baseVal(mk, c + '|' + x, pk)))));
  } else if (id === 'pbars' || id === 'os') {
    const dim = id === 'os' ? 'os' : CFG[pk].grid; const mk = id === 'os' ? st(pk, 'os', {}).mk : CFG[pk].eff;
    push([dim, L(mk, pk)]); MEMBERS[dim].forEach((m) => push([m, baseVal(mk, m, pk)]));
  } else if (id === 'pspend') {
    push(['platform', 'previous', 'current']);
    MEMBERS.platform.forEach((p) => { const t = totalFor('spend', 'account', p.toLowerCase(), dys); push([p, t.prev, t.cur]); });
  } else if (id === 'proas') {
    push(['platform', 'return (native basis)']);
    MEMBERS.platform.forEach((p) => push([p, baseVal(p === 'Google' ? 'conv_value_per_cost' : p === 'Flipkart' ? 'roi' : 'roas', 'account', p.toLowerCase())]));
  } else if (id === 'ptable') {
    push(['platform', 'spend', 'clicks', 'orders']);
    MEMBERS.platform.forEach((p) => { const k = p.toLowerCase(); push([p, totalFor('spend', 'account', k, dys).cur, totalFor('clicks', 'account', k, dys).cur, totalFor('orders', 'account', k, dys).cur]); });
  } else if (id === 'fatigue') {
    const totals = (LIVE[pk] && LIVE[pk].totals) || {};
    const members = (totals.__fatigue_members && totals.__fatigue_members.cur) || MEMBERS.fatigue;
    const assets = (totals.__fatigue_assets && totals.__fatigue_assets.cur) || {};
    push(['creative', 'fatigue_score', 'frequency_7d', 'hook_pct_change', 'hold_pct_change', 'spend_7d', 'video_url', 'thumbnail_url']);
    members.map((c) => ({ c, s: totalFor('fatigue_score', c, pk, dys).cur, f: totalFor('fatigue_freq', c, pk, dys).cur, hk: totalFor('fatigue_hook_chg', c, pk, dys).cur, hd: totalFor('fatigue_hold_chg', c, pk, dys).cur, sp: totalFor('fatigue_spend', c, pk, dys).cur }))
      .sort((a, b) => (b.s - a.s) || (b.sp - a.sp))
      .forEach((r) => push([r.c, r.s, r.f, r.hk, r.hd, r.sp, (assets[r.c] || {}).video || '', (assets[r.c] || {}).thumb || '']));
  }
  return rows.join('\n');
}
export function downloadCsv(pk, id) {
  const blob = new Blob(['﻿' + csvFor(pk, id)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${pk}-${id}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/* Display label for a platform key — used to prefix pinned-card titles so a chart
 * pinned to the Cockpit carries its platform (e.g. "Flipkart Ads · Spend over time"). */
export const PLATFORM_LABEL = {
  amazon: 'Amazon Ads', flipkart: 'Flipkart Ads', google: 'Google Ads', meta: 'Meta Ads', all: 'All platforms',
};

/* ── a stable pin spec for a card (so Cockpit can re-pin) ──────────────────────── */
export function pinSpecFor(pk, id) {
  const c = CARDS[id];
  const base = c.title(pk) || id;
  const plat = PLATFORM_LABEL[pk] || pk;
  return {
    id: `exp-new:${pk}:${id}`,
    source: 'explore-new',
    // Carry the platform name in the title so pinned charts are unambiguous on the
    // Cockpit (skip it if the title already leads with the platform label).
    title: base.startsWith(plat) ? base : `${plat} · ${base}`,
    subtitle: c.q(pk) || '',
    platform: pk,
    cardId: id,
  };
}

/* Reset per-render trend geometry (called by the React page before building HTML). */
export function beginRender() { TRENDS = {}; TSEQ = 0; }
