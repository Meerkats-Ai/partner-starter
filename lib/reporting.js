/**
 * reporting.js — the shared model for the Reporting Pack page (Daily Log, Weekly
 * Summary, Monthly Summary, Weekly Placement, Placement MoM tabs + Excel export).
 *
 * ONE fetch (GET /cdp/daily-log → { platforms, rows (per-day), placement (per-day),
 * placementPlatforms }) feeds every tab. This module owns:
 *   • metric derivations (ROAS / ACOS / CPC / CVR / CTR / AOV) from a raw cell,
 *   • aggregation of daily cells into week / month buckets,
 *   • the platform display metadata (labels + the Excel/CSS colors),
 * so the tabs + the Excel writer stay in lockstep (same numbers, same look).
 *
 * All metrics are platform-REPORTED SIGNAL: Sales/Units are the ad console's
 * attributed figures, matching what the founder sees in each console.
 */

// ── platform display (label + colors, shared by UI + Excel) ──────────────────
// `hex` = header fill for Excel (ARGB); `head`/`tint` = Tailwind classes for the UI.
export const PLATFORM_META = {
  google: { label: 'Google', hex: 'FF1D4ED8', head: 'bg-blue-700', tint: 'bg-blue-50/40' },
  meta: { label: 'Meta', hex: 'FF4338CA', head: 'bg-indigo-700', tint: 'bg-indigo-50/40' },
  amazon: { label: 'Amazon', hex: 'FFB45309', head: 'bg-orange-700', tint: 'bg-orange-50/40' },
  flipkart: { label: 'Flipkart', hex: 'FFCA8A04', head: 'bg-yellow-600', tint: 'bg-yellow-50/40' },
};
export const COMBINED_META = { label: 'Combined', hex: 'FF065F46', head: 'bg-emerald-800', tint: 'bg-emerald-50/40' };
export const metaFor = (key) => (key === 'combined' ? COMBINED_META : PLATFORM_META[key] || { label: key, hex: 'FF374151', head: 'bg-gray-700', tint: '' });

export const ZERO = { spend: 0, sales: 0, units: 0, clicks: 0, impressions: 0 };

// The Meta App-Install `extra` fields are ADDITIVE (unlike Google's impression-share
// ratios), so they must survive week/month/placement aggregation. addCell sums them
// into a merged `extra` when either side carries them; ratio-style extras (impression
// share) are intentionally NOT summed here — those columns are dropped from aggregated
// tabs by AGGREGATABLE, so they never reach a summed cell.
const ADDITIVE_EXTRA_KEYS = ['app_installs', 'app_registrations', 'app_add_to_carts', 'app_purchase_value'];
const addExtra = (a, b) => {
  const ea = a?.extra, eb = b?.extra;
  if (!ea && !eb) return undefined;
  const out = {};
  for (const k of ADDITIVE_EXTRA_KEYS) {
    const va = ea?.[k], vb = eb?.[k];
    if (va != null || vb != null) out[k] = (Number(va) || 0) + (Number(vb) || 0);
  }
  return Object.keys(out).length ? out : undefined;
};
export const addCell = (a, b) => {
  const extra = addExtra(a, b);
  return {
    spend: a.spend + b.spend,
    sales: a.sales + b.sales,
    units: a.units + b.units,
    clicks: a.clicks + b.clicks,
    impressions: a.impressions + b.impressions,
    ...(extra ? { extra } : {}),
  };
};
export const sumCells = (cells) => cells.reduce((acc, c) => addCell(acc, c || ZERO), { ...ZERO });

// ── derived metrics (null = undefined / division by zero) ────────────────────
export const roas = (c) => (c.spend > 0 ? c.sales / c.spend : null);        // sales ÷ spend
export const acos = (c) => (c.sales > 0 ? c.spend / c.sales : null);        // spend ÷ sales
export const cpc = (c) => (c.clicks > 0 ? c.spend / c.clicks : null);       // spend ÷ clicks
export const cvr = (c) => (c.clicks > 0 ? c.units / c.clicks : null);       // units ÷ clicks
export const ctr = (c) => (c.impressions > 0 ? c.clicks / c.impressions : null); // clicks ÷ impr
export const aov = (c) => (c.units > 0 ? c.sales / c.units : null);         // sales ÷ units

// ── ROAS highlight tiers ─────────────────────────────────────────────────────
// The sales/spend efficiency ratio goes by different NAMES per platform but is the
// same number: ROAS (Meta/Amazon/Combined), ROI (Flipkart), Conv. Val / Cost (Google).
// These column keys all carry that ratio and get the red/orange/green highlight.
export const ROAS_LIKE_KEYS = new Set(['roas', 'roi', 'conv_val_cost']);
export const isRoasCol = (k) => ROAS_LIKE_KEYS.has(k);
// Map a ROAS value → a highlight tier. <1 = red (losing money on ad-attributed
// sales), 1–2 = orange (thin), >2 = green (healthy). null/0-spend → no tint.
// `roasTier` returns the semantic tier; the UI/Excel map it to their own styles.
export const roasTier = (v) => {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < 1) return 'bad';
  if (v <= 2) return 'warn';
  return 'good';
};
// Tailwind bg+text classes per tier (light tint so the number stays readable).
const ROAS_TIER_CLASS = {
  bad: 'bg-red-100 text-red-700',
  warn: 'bg-orange-100 text-orange-700',
  good: 'bg-green-100 text-green-700',
};
// Highlight classes for a metric column's cell given its value. Only ROAS-like
// columns are tinted; everything else returns '' (unchanged).
export const roasCellClass = (colKey, value) =>
  (isRoasCol(colKey) ? (ROAS_TIER_CLASS[roasTier(value)] || '') : '');
// Same tiers for the DARK total row — coloured text (no light bg on a dark row).
const ROAS_TIER_CLASS_DARK = {
  bad: 'text-red-400', warn: 'text-orange-300', good: 'text-green-400',
};
export const roasCellClassDark = (colKey, value) =>
  (isRoasCol(colKey) ? (ROAS_TIER_CLASS_DARK[roasTier(value)] || '') : '');
// Excel ARGB fill per tier (matches the UI tints), or null for no fill.
export const ROAS_TIER_ARGB = { bad: 'FFFEE2E2', warn: 'FFFFEDD5', good: 'FFDCFCE7' };
export const roasFillArgb = (colKey, value) =>
  (isRoasCol(colKey) ? (ROAS_TIER_ARGB[roasTier(value)] || null) : null);

// ── formatters (₹ = INR, matching the rest of the Data Spine) ────────────────
export const inr = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: Math.abs(n) >= 1000 || n % 1 === 0 ? 0 : 2 })}`;
export const num = (n) => Number(n || 0).toLocaleString('en-IN');
export const pct = (f, d = 1) => (f == null ? '—' : `${(f * 100).toFixed(d)}%`);
export const mult = (f) => (f == null ? '—' : `${f.toFixed(2)}x`);
export const money = (n) => (n == null ? '—' : inr(n));
export const delta = (f) => (f == null ? '—' : `${f >= 0 ? '+' : ''}${(f * 100).toFixed(1)}%`);

// ── date helpers (local, Sun–Sat weeks: week starts Sunday, ends Saturday) ────
const parse = (d) => new Date(d + 'T00:00:00');
const iso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const sundayOf = (date) => {
  const d = new Date(date);
  const dow = d.getDay(); // Sun=0 … Sat=6
  d.setDate(d.getDate() - dow);
  return d;
};
export const monthKey = (d) => d.slice(0, 7); // 'YYYY-MM'
export const monthLabel = (mk) =>
  parse(mk + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayParts = (d) => {
  const dt = parse(d);
  return { day: dt.getDate(), mon: dt.toLocaleDateString(undefined, { month: 'short' }), dow: DOW[dt.getDay()] };
};
const shortDate = (d) => {
  const dt = parse(d);
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

// The display column-groups: connected platforms + Combined (Combined only when >1
// platform — a single-platform workspace would duplicate it).
export const groupsFor = (platforms) => {
  const g = (platforms || []).map((p) => ({ key: p, meta: metaFor(p) }));
  if ((platforms || []).length > 1) g.push({ key: 'combined', meta: COMBINED_META });
  return g;
};

// Pull a group's cell out of a per-day row ({ platforms:{}, combined:{} }).
export const cellOfRow = (row, groupKey) =>
  (groupKey === 'combined' ? row.combined : row.platforms?.[groupKey]) || ZERO;

/**
 * Bucket per-day rows into WEEKS (Sun–Sat). Returns [{ key, label, dates:[start,end],
 * byGroup: { groupKey → cell } }], newest first. Weeks are keyed by their Sunday, so
 * a window spanning weeks yields one bucket per Sun–Sat slice it touches.
 */
export function weekBuckets(rows, platforms) {
  const groups = groupsFor(platforms).map((g) => g.key);
  const map = new Map(); // sundayISO → { start, end, byGroup }
  for (const r of rows) {
    const mk = iso(sundayOf(parse(r.date)));
    let b = map.get(mk);
    if (!b) {
      const start = parse(mk);
      const end = new Date(start); end.setDate(end.getDate() + 6);
      b = { key: mk, start: mk, end: iso(end), byGroup: {} };
      for (const g of groups) b.byGroup[g] = { ...ZERO };
      map.set(mk, b);
    }
    for (const g of groups) b.byGroup[g] = addCell(b.byGroup[g], cellOfRow(r, g));
  }
  const out = Array.from(map.values()).sort((a, b) => (a.start < b.start ? 1 : -1));
  return out.map((b, i, arr) => ({
    ...b,
    label: `${shortDate(b.start)} – ${shortDate(b.end)}`,
    // Week number counting from the OLDEST week in view = 1 (like the sheet's Week 1–4).
    weekNo: arr.length - i,
  }));
}

/**
 * Bucket per-day rows into MONTHS. Returns [{ key:'YYYY-MM', label, byGroup }],
 * newest first.
 */
export function monthBuckets(rows, platforms) {
  const groups = groupsFor(platforms).map((g) => g.key);
  const map = new Map();
  for (const r of rows) {
    const mk = monthKey(r.date);
    let b = map.get(mk);
    if (!b) {
      b = { key: mk, label: monthLabel(mk), byGroup: {} };
      for (const g of groups) b.byGroup[g] = { ...ZERO };
      map.set(mk, b);
    }
    for (const g of groups) b.byGroup[g] = addCell(b.byGroup[g], cellOfRow(r, g));
  }
  return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
}

/**
 * Placement grid: pivot the placement daily rows into per-platform, per-placement,
 * per-PERIOD cells (period = week or month). This is the spreadsheet's Placement
 * sheets: one row per platform × placement, with a column-BLOCK per period.
 *
 * `periodMode` = 'week' | 'month'. Returns:
 *   • periods       — period keys, OLDEST→NEWEST (spreadsheet reads left→right in time)
 *   • periodLabel   — key → human label ("1–7 Sep" / "September 2026")
 *   • platforms     — placement platforms that returned data
 *   • rows          — [{ platform, placement, byPeriod:{period→cell}, total }]
 *   • periodSpend   — Map("platform|period" → total spend of ALL placements in that
 *                     platform+period), for the sheet's "% of period spend" column.
 * Only placement platforms with data appear (Meta / Amazon / Flipkart).
 */
export function placementGrid(placementRows, periodMode = 'week') {
  const periodOf =
    periodMode === 'month'
      ? (d) => monthKey(d)
      : (d) => iso(sundayOf(parse(d)));
  const byPlatform = new Map(); // platform → Map(placement → Map(period → cell))
  const periods = new Set();
  const periodSpend = new Map(); // "platform|period" → spend
  for (const r of placementRows || []) {
    const per = periodOf(r.date);
    periods.add(per);
    if (!byPlatform.has(r.platform)) byPlatform.set(r.platform, new Map());
    const pl = byPlatform.get(r.platform);
    if (!pl.has(r.placement)) pl.set(r.placement, new Map());
    const perMap = pl.get(r.placement);
    perMap.set(per, addCell(perMap.get(per) || { ...ZERO }, r));
    const psKey = `${r.platform}|${per}`;
    periodSpend.set(psKey, (periodSpend.get(psKey) || 0) + (r.spend || 0));
  }
  // Oldest → newest so time reads left→right like the sheet.
  const periodList = Array.from(periods).sort();
  const periodLabel =
    periodMode === 'month'
      ? (p) => monthLabel(p)
      : (p) => {
          const start = parse(p);
          const end = new Date(start); end.setDate(end.getDate() + 6);
          return `${shortDate(p)} – ${shortDate(iso(end))}`;
        };
  const rows = Array.from(byPlatform.entries()).flatMap(([platform, plMap]) =>
    Array.from(plMap.entries()).map(([placement, perMap]) => {
      const byPeriod = {};
      for (const p of periodList) byPeriod[p] = perMap.get(p) || { ...ZERO };
      return { platform, placement, byPeriod, total: sumCells(Object.values(byPeriod)) };
    })
  );
  // Stable order: platform, then descending total spend within a platform.
  rows.sort((a, b) => (a.platform === b.platform ? b.total.spend - a.total.spend : a.platform < b.platform ? -1 : 1));
  return {
    platforms: Array.from(byPlatform.keys()),
    periods: periodList,
    periodLabel,
    periodSpend,
    rows,
    // Share of the platform+period spend this placement took (for "% of period spend").
    shareOf: (platform, period, cell) => {
      const tot = periodSpend.get(`${platform}|${period}`) || 0;
      return tot > 0 ? cell.spend / tot : null;
    },
  };
}

// Placement metrics shown per period-block in the Placement sheets (spreadsheet
// parity). Compact so multiple period blocks fit side by side.
export const PLACEMENT_METRIC_COLS = [
  { k: 'spend', label: 'Spend', get: (c) => c.spend, fmt: (c) => inr(c.spend), num: 'money' },
  { k: 'sales', label: 'Sales', get: (c) => c.sales, fmt: (c) => inr(c.sales), num: 'money' },
  { k: 'roas', label: 'ROAS', get: (c) => roas(c), fmt: (c) => mult(roas(c)), num: 'mult', strong: true },
  { k: 'acos', label: 'ACOS', get: (c) => acos(c), fmt: (c) => pct(acos(c)), num: 'pct' },
  { k: 'cpc', label: 'CPC', get: (c) => cpc(c), fmt: (c) => money(cpc(c)), num: 'money' },
  { k: 'cvr', label: 'CVR', get: (c) => cvr(c), fmt: (c) => pct(cvr(c), 2), num: 'pct' },
];

// The 10 metric columns per group (spreadsheet parity). `k` key, `label`, `get`
// returns the raw number (or null), `fmt` the display string, `strong` = emphasize.
export const METRIC_COLS = [
  { k: 'spend', label: 'Spend', get: (c) => c.spend, fmt: (c) => inr(c.spend), num: 'money' },
  { k: 'sales', label: 'Sales', get: (c) => c.sales, fmt: (c) => inr(c.sales), num: 'money' },
  { k: 'units', label: 'Units', get: (c) => c.units, fmt: (c) => num(c.units), num: 'int' },
  { k: 'clicks', label: 'Clicks', get: (c) => c.clicks, fmt: (c) => num(c.clicks), num: 'int' },
  { k: 'impressions', label: 'Impr.', get: (c) => c.impressions, fmt: (c) => num(c.impressions), num: 'int' },
  { k: 'roas', label: 'ROAS', get: (c) => roas(c), fmt: (c) => mult(roas(c)), num: 'mult', strong: true },
  { k: 'acos', label: 'ACOS', get: (c) => acos(c), fmt: (c) => pct(acos(c)), num: 'pct' },
  { k: 'cpc', label: 'CPC', get: (c) => cpc(c), fmt: (c) => money(cpc(c)), num: 'money' },
  { k: 'cvr', label: 'CVR', get: (c) => cvr(c), fmt: (c) => pct(cvr(c), 2), num: 'pct' },
  { k: 'aov', label: 'AOV', get: (c) => aov(c), fmt: (c) => money(aov(c)), num: 'money' },
];

// ── PER-PLATFORM native columns (daily-report-tables spec) ───────────────────
// Each platform keeps its OWN vocabulary — never mixed (see daily-report-tables
// repo). A cell carries { spend, sales, units, clicks, impressions, extra:{…} }
// where the backend maps each platform's native names into the shared 5 fields
// (units = conversions/purchases/orders, sales = conv value/purchase value/…) and
// `extra` holds columns unique to one platform (e.g. Google's impression share).
// `headline: true` = the platform's native efficiency metric (bold).

// Google Ads — google.yaml. No column named ROAS, no ACOS; headline = Conv. Val/Cost.
export const GOOGLE_COLS = [
  { k: 'cost', label: 'Cost', get: (c) => c.spend, fmt: (c) => inr(c.spend), num: 'money' },
  { k: 'impressions', label: 'Impr.', get: (c) => c.impressions, fmt: (c) => num(c.impressions), num: 'int' },
  { k: 'clicks', label: 'Clicks', get: (c) => c.clicks, fmt: (c) => num(c.clicks), num: 'int' },
  { k: 'ctr', label: 'CTR', get: (c) => ctr(c), fmt: (c) => pct(ctr(c), 2), num: 'pct' },
  { k: 'avg_cpc', label: 'Avg. CPC', get: (c) => cpc(c), fmt: (c) => money(cpc(c)), num: 'money' },
  { k: 'conversions', label: 'Conversions', get: (c) => c.units, fmt: (c) => num(c.units), num: 'int' },
  { k: 'conv_rate', label: 'Conv. Rate', get: (c) => (c.clicks > 0 ? c.units / c.clicks : null), fmt: (c) => pct(c.clicks > 0 ? c.units / c.clicks : null, 2), num: 'pct' },
  { k: 'cost_per_conv', label: 'Cost / Conv.', get: (c) => (c.units > 0 ? c.spend / c.units : null), fmt: (c) => money(c.units > 0 ? c.spend / c.units : null), num: 'money' },
  { k: 'conv_value', label: 'Conv. Value', get: (c) => c.sales, fmt: (c) => inr(c.sales), num: 'money' },
  { k: 'conv_val_cost', label: 'Conv. Val / Cost', get: (c) => (c.spend > 0 ? c.sales / c.spend : null), fmt: (c) => mult(c.spend > 0 ? c.sales / c.spend : null), num: 'mult', strong: true, headline: true },
  { k: 'search_impression_share', label: 'Search Impr. Share', get: (c) => c.extra?.search_impression_share ?? null, fmt: (c) => pct(c.extra?.search_impression_share ?? null), num: 'pct' },
  { k: 'search_lost_is_budget', label: 'Lost IS (Budget)', get: (c) => c.extra?.search_lost_is_budget ?? null, fmt: (c) => pct(c.extra?.search_lost_is_budget ?? null), num: 'pct' },
];

// Meta Ads — meta.yaml. Headline = ROAS. Clicks = link clicks; CTR/CPC on that basis.
// (Reach/Frequency need a unique-people field the daily-log cell doesn't carry — omitted;
// they'd be wrong summed anyway.)
export const META_COLS = [
  { k: 'spend', label: 'Amount Spent', get: (c) => c.spend, fmt: (c) => inr(c.spend), num: 'money' },
  { k: 'impressions', label: 'Impr.', get: (c) => c.impressions, fmt: (c) => num(c.impressions), num: 'int' },
  { k: 'cpm', label: 'CPM', get: (c) => (c.impressions > 0 ? (c.spend / c.impressions) * 1000 : null), fmt: (c) => money(c.impressions > 0 ? (c.spend / c.impressions) * 1000 : null), num: 'money' },
  { k: 'link_clicks', label: 'Link Clicks', get: (c) => c.clicks, fmt: (c) => num(c.clicks), num: 'int' },
  { k: 'ctr', label: 'CTR', get: (c) => ctr(c), fmt: (c) => pct(ctr(c), 2), num: 'pct' },
  { k: 'cpc', label: 'CPC', get: (c) => cpc(c), fmt: (c) => money(cpc(c)), num: 'money' },
  { k: 'purchases', label: 'Purchases', get: (c) => c.units, fmt: (c) => num(c.units), num: 'int' },
  { k: 'purchase_value', label: 'Purchase Value', get: (c) => c.sales, fmt: (c) => inr(c.sales), num: 'money' },
  { k: 'roas', label: 'ROAS', get: (c) => roas(c), fmt: (c) => mult(roas(c)), num: 'mult', strong: true, headline: true },
  { k: 'cost_per_purchase', label: 'Cost per Purchase', get: (c) => (c.units > 0 ? c.spend / c.units : null), fmt: (c) => money(c.units > 0 ? c.spend / c.units : null), num: 'money' },
  // App Install campaigns (OUTCOME_APP_PROMOTION). These read from the Meta cell's
  // `extra` (app_installs is 0 for non-app campaigns → renders 0 / — there). Cost /
  // Install = spend ÷ installs. iOS-vs-Android split lives in the OS breakdown, not here.
  { k: 'app_installs', label: 'App Installs', get: (c) => c.extra?.app_installs ?? 0, fmt: (c) => num(c.extra?.app_installs ?? 0), num: 'int' },
  { k: 'cost_per_install', label: 'Cost / Install', get: (c) => ((c.extra?.app_installs ?? 0) > 0 ? c.spend / c.extra.app_installs : null), fmt: (c) => money((c.extra?.app_installs ?? 0) > 0 ? c.spend / c.extra.app_installs : null), num: 'money' },
  { k: 'app_registrations', label: 'App Regs', get: (c) => c.extra?.app_registrations ?? 0, fmt: (c) => num(c.extra?.app_registrations ?? 0), num: 'int' },
  { k: 'app_purchase_value', label: 'App Revenue', get: (c) => c.extra?.app_purchase_value ?? 0, fmt: (c) => inr(c.extra?.app_purchase_value ?? 0), num: 'money' },
];

// Amazon Ads — amazon.yaml. Headline = ACOS; ROAS beside it. (Units/Top-of-Search IS/
// NTB% need fields the daily-log cell doesn't carry — omitted.)
export const AMAZON_COLS = [
  { k: 'spend', label: 'Spend', get: (c) => c.spend, fmt: (c) => inr(c.spend), num: 'money' },
  { k: 'sales', label: 'Sales', get: (c) => c.sales, fmt: (c) => inr(c.sales), num: 'money' },
  { k: 'orders', label: 'Orders', get: (c) => c.units, fmt: (c) => num(c.units), num: 'int' },
  { k: 'clicks', label: 'Clicks', get: (c) => c.clicks, fmt: (c) => num(c.clicks), num: 'int' },
  { k: 'impressions', label: 'Impr.', get: (c) => c.impressions, fmt: (c) => num(c.impressions), num: 'int' },
  { k: 'ctr', label: 'CTR', get: (c) => ctr(c), fmt: (c) => pct(ctr(c), 2), num: 'pct' },
  { k: 'cpc', label: 'CPC', get: (c) => cpc(c), fmt: (c) => money(cpc(c)), num: 'money' },
  { k: 'cvr', label: 'CVR', get: (c) => cvr(c), fmt: (c) => pct(cvr(c), 2), num: 'pct' },
  { k: 'acos', label: 'ACOS', get: (c) => acos(c), fmt: (c) => pct(acos(c)), num: 'pct', strong: true, headline: true },
  { k: 'roas', label: 'ROAS', get: (c) => roas(c), fmt: (c) => mult(roas(c)), num: 'mult' },
];

// Flipkart Ads — flipkart.yaml. Views = impressions; headline = ROI. (PPV/ATC + the
// direct/indirect split need fields the daily-log cell doesn't carry — the cell's `sales`
// is direct_revenue, so ROI here = direct-only; the full split lives in the placement /
// canonical tables.)
export const FLIPKART_COLS = [
  { k: 'spend', label: 'Spend', get: (c) => c.spend, fmt: (c) => inr(c.spend), num: 'money' },
  { k: 'views', label: 'Views', get: (c) => c.impressions, fmt: (c) => num(c.impressions), num: 'int' },
  { k: 'clicks', label: 'Clicks', get: (c) => c.clicks, fmt: (c) => num(c.clicks), num: 'int' },
  { k: 'ctr', label: 'CTR', get: (c) => ctr(c), fmt: (c) => pct(ctr(c), 2), num: 'pct' },
  { k: 'cpc', label: 'CPC', get: (c) => cpc(c), fmt: (c) => money(cpc(c)), num: 'money' },
  { k: 'orders', label: 'Orders', get: (c) => c.units, fmt: (c) => num(c.units), num: 'int' },
  { k: 'cvr', label: 'CVR', get: (c) => cvr(c), fmt: (c) => pct(cvr(c), 2), num: 'pct' },
  { k: 'direct_revenue', label: 'Direct Revenue', get: (c) => c.sales, fmt: (c) => inr(c.sales), num: 'money' },
  { k: 'roi', label: 'ROI', get: (c) => roas(c), fmt: (c) => mult(roas(c)), num: 'mult', strong: true, headline: true },
];

// Combined (cross-platform total) — a neutral mixed set (no single platform's vocabulary
// fits a sum across platforms). Keeps ROAS as the universal efficiency read, but DROPS
// ACOS: Combined sums spend across ALL platforms while sales is only attributed on some
// (Amazon/Flipkart report attributed sales; Meta/Google purchase-value is often ~0), so
// spend/sales explodes to absurd figures (e.g. 1833% / 162939%) or is undefined. ACOS is
// a marketplace metric and stays on Amazon (its native headline), not on the cross-
// platform sum. ROAS conveys the same efficiency without the near-zero-denominator blowup.
// App-campaign columns (installs / registrations / cost-per-install) carried on the
// cell's ADDITIVE `extra` — populated by Meta (the only platform with app campaigns)
// and mirrored onto the combined cell's extra by the backend, so a cross-platform
// sum is correct. They render 0 / — when there's no app-campaign spend in the window.
const APP_COLS = [
  { k: 'app_installs', label: 'App Installs', get: (c) => c.extra?.app_installs ?? 0, fmt: (c) => num(c.extra?.app_installs ?? 0), num: 'int' },
  { k: 'app_registrations', label: 'App Regs', get: (c) => c.extra?.app_registrations ?? 0, fmt: (c) => num(c.extra?.app_registrations ?? 0), num: 'int' },
  { k: 'cost_per_install', label: 'Cost / Install', get: (c) => ((c.extra?.app_installs ?? 0) > 0 ? c.spend / c.extra.app_installs : null), fmt: (c) => money((c.extra?.app_installs ?? 0) > 0 ? c.spend / c.extra.app_installs : null), num: 'money' },
];
export const COMBINED_COLS = [...METRIC_COLS.filter((m) => m.k !== 'acos'), ...APP_COLS];

// Per-platform NATIVE column set for the Daily Log. Combined + any not-mapped group fall
// back to the shared METRIC_COLS.
export const PLATFORM_COLS = {
  google: GOOGLE_COLS,
  meta: META_COLS,
  amazon: AMAZON_COLS,
  flipkart: FLIPKART_COLS,
  combined: COMBINED_COLS,
};
export const colsForGroup = (groupKey) => PLATFORM_COLS[groupKey] || METRIC_COLS;

// ── Derived per-platform variants for the Weekly / Monthly tabs ───────────────
// Aggregated tabs (week/month buckets) sum cells, so `extra`-based columns (Google's
// impression share) can't appear — drop them. Weekly stays COMPACT (spend + native
// value + headline efficiency + CPC) so several platforms + WoW fit side by side;
// Monthly shows the full native set as rows.
const AGGREGATABLE = (m) => !m.k.startsWith('search_'); // drop extra/impression-share cols
const WEEKLY_KEYS_BY_PLATFORM = {
  google: ['cost', 'conv_value', 'conv_val_cost', 'avg_cpc'],
  meta: ['spend', 'purchase_value', 'roas', 'app_installs', 'cost_per_install'],
  amazon: ['spend', 'sales', 'acos', 'roas'],
  flipkart: ['spend', 'direct_revenue', 'roi', 'cpc'],
  // No ACOS on Combined — see COMBINED_COLS (cross-platform sum makes spend/sales blow up).
  combined: ['spend', 'sales', 'roas', 'cpc'],
};
// Weekly compact native columns for a group.
export const weeklyColsForGroup = (groupKey) => {
  const full = (PLATFORM_COLS[groupKey] || METRIC_COLS).filter(AGGREGATABLE);
  const keys = WEEKLY_KEYS_BY_PLATFORM[groupKey];
  if (!keys) return full.filter((m) => ['spend', 'sales', 'roas', 'acos', 'cpc'].includes(m.k));
  // Preserve declared order, keep only the compact keys.
  return full.filter((m) => keys.includes(m.k));
};
// Numeric formatter by a column's declared `num` type — for tabs that format a raw
// number (Monthly rows) rather than a cell.
export const fmtByType = (v, type) => {
  if (v == null) return '—';
  switch (type) {
    case 'money': return money(v);
    case 'int': return num(v);
    case 'pct': return pct(v, type === 'pct' ? 2 : 1);
    case 'mult': return mult(v);
    default: return String(v);
  }
};
// Monthly native ROWS for a group = the full aggregatable native set (metric-per-row).
// Monthly formats a RAW number (get→number, fmt→string), so wrap each native col's
// cell-based fmt with a number-based one derived from its `num` type.
export const monthlyRowsForGroup = (groupKey) =>
  (PLATFORM_COLS[groupKey] || METRIC_COLS).filter(AGGREGATABLE).map((m) => ({
    k: m.k,
    label: m.label,
    get: m.get,
    num: m.num,                       // format kind (for the Excel export)
    fmt: (v) => fmtByType(v, m.num),
    strong: !!(m.strong || m.headline),
  }));

// The group whose headline efficiency metric drives the WoW/MoM delta column. Falls back
// to ROAS for non-native groups.
export const headlineOf = (groupKey) => {
  const set = PLATFORM_COLS[groupKey] || METRIC_COLS;
  return set.find((m) => m.headline) || set.find((m) => m.k === 'roas') || null;
};

// Legacy shared sets (kept for the Excel export until it's migrated to per-platform).
export const WEEKLY_METRIC_COLS = METRIC_COLS.filter((m) =>
  ['spend', 'sales', 'roas', 'acos', 'cpc'].includes(m.k)
);
export const MONTHLY_METRIC_ROWS = [
  { k: 'spend', label: 'Spend', get: (c) => c.spend, fmt: money },
  { k: 'sales', label: 'Sales', get: (c) => c.sales, fmt: money },
  { k: 'units', label: 'Units', get: (c) => c.units, fmt: (v) => num(v) },
  { k: 'clicks', label: 'Clicks', get: (c) => c.clicks, fmt: (v) => num(v) },
  { k: 'impressions', label: 'Impressions', get: (c) => c.impressions, fmt: (v) => num(v) },
  { k: 'roas', label: 'ROAS', get: (c) => roas(c), fmt: mult, strong: true },
  { k: 'acos', label: 'ACOS', get: (c) => acos(c), fmt: (v) => pct(v) },
  { k: 'cvr', label: 'CVR', get: (c) => cvr(c), fmt: (v) => pct(v, 2) },
  { k: 'ctr', label: 'CTR', get: (c) => ctr(c), fmt: (v) => pct(v, 2) },
  { k: 'cpc', label: 'CPC', get: (c) => cpc(c), fmt: money },
  { k: 'aov', label: 'AOV', get: (c) => aov(c), fmt: money },
];
