/**
 * exportExcel.js — writes the Reporting Pack to a styled multi-sheet .xlsx that
 * mirrors the source workbook (colored platform header bands, ₹/×/% number formats,
 * a totals row per sheet). Built with exceljs (cell fills/fonts/merges/number
 * formats — the SheetJS community build can't do styling), saved via file-saver.
 *
 * Sheets (only the ones with data): Daily Log · Weekly Summary · Monthly Summary ·
 * Weekly Placement · Placement MoM. Driven by the SAME derived numbers as the UI
 * tabs (imported from reporting.js), so the export matches the screen exactly.
 */
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import {
  groupsFor, cellOfRow, weekBuckets, monthBuckets, placementGrid,
  PLACEMENT_METRIC_COLS, PLATFORM_META,
  colsForGroup, weeklyColsForGroup, monthlyRowsForGroup, headlineOf,
  roas, acos, cpc, cvr, ctr, aov, dayParts, sumCells, roasFillArgb,
} from './reporting.js';

// Excel number formats matching the on-screen formatting.
const FMT = {
  money: '₹#,##0',
  money2: '₹#,##0.00',
  int: '#,##0',
  mult: '0.00"x"',
  pct: '0.0%',
  pct2: '0.00%',
};
const numFmtFor = (kind) =>
  kind === 'money' ? FMT.money : kind === 'int' ? FMT.int : kind === 'mult' ? FMT.mult : kind === 'pct' ? FMT.pct2 : undefined;

const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const SUBHEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin', color: { argb: 'FFE5E7EB' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

// Raw metric value for a cell by metric key (for the Excel number cells).
const rawMetric = (c, k) =>
  k === 'roas' ? roas(c) : k === 'acos' ? acos(c) : k === 'cpc' ? cpc(c)
  : k === 'cvr' ? cvr(c) : k === 'ctr' ? ctr(c) : k === 'aov' ? aov(c)
  : c[k];

// Write a value into a cell with the right number format (null → em dash text).
// `fillArgb` (optional) tints the cell — used for the ROAS red/orange/green highlight.
function put(cell, value, kind, fillArgb) {
  if (fillArgb) cell.fill = fill(fillArgb);
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) {
    cell.value = '—';
    cell.alignment = { horizontal: 'right' };
    return;
  }
  cell.value = value;
  const f = numFmtFor(kind);
  if (f) cell.numFmt = f;
  cell.alignment = { horizontal: 'right' };
}
// Write a metric column's value into a cell, applying the ROAS highlight fill when
// the column is a ROAS-family ratio (roas/roi/conv_val_cost). `value` is the raw
// number the fill tier is derived from (same value that's written).
const putMetric = (cell, m, value) => put(cell, value, m.num, roasFillArgb(m.k, value));

// Extra/impression-share columns (Google) can't aggregate — drop from Excel totals but
// still show per-day. We blank them in the total row.
const IS_EXTRA_COL = (k) => k === 'search_impression_share' || k === 'search_lost_is_budget';

// ── Sheet: Daily Log ─────────────────────────────────────────────────────────
// Per-platform NATIVE columns (matches the UI Daily Log exactly, daily-report-tables spec).
function sheetDailyLog(wb, { platforms, rows }) {
  if (!rows?.length) return;
  const ws = wb.addWorksheet('Daily Log', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
  const groups = groupsFor(platforms).map((g) => ({ ...g, cols: colsForGroup(g.key) }));
  const totalCols = groups.reduce((n, g) => n + g.cols.length, 0);

  // Row 1: group bands (Date merged down 2). Row 2: metric labels.
  ws.getCell(1, 1).value = 'Date';
  ws.mergeCells(1, 1, 2, 1);
  ws.getCell(1, 1).font = { bold: true };
  let c = 2;
  groups.forEach((g) => {
    const start = c;
    g.cols.forEach((m) => {
      ws.getCell(2, c).value = m.label;
      ws.getCell(2, c).fill = SUBHEAD_FILL;
      ws.getCell(2, c).font = { size: 9, bold: true, color: { argb: 'FF6B7280' } };
      ws.getCell(2, c).alignment = { horizontal: 'right' };
      c += 1;
    });
    ws.mergeCells(1, start, 1, c - 1);
    const band = ws.getCell(1, start);
    band.value = g.meta.label;
    band.fill = fill(g.meta.hex);
    band.font = HEADER_FONT;
    band.alignment = { horizontal: 'center' };
  });

  // Data rows.
  rows.forEach((r) => {
    const row = ws.addRow([]);
    const { day, mon, dow } = dayParts(r.date);
    row.getCell(1).value = `${day} ${mon} · ${dow}`;
    row.getCell(1).font = { bold: true };
    let ci = 2;
    groups.forEach((g) => {
      const cell = cellOfRow(r, g.key);
      g.cols.forEach((m) => { putMetric(row.getCell(ci), m, m.get(cell)); ci += 1; });
    });
  });

  // Totals row.
  const totals = {};
  groups.forEach((g) => { totals[g.key] = sumCells(rows.map((r) => cellOfRow(r, g.key))); });
  const tr = ws.addRow([]);
  tr.getCell(1).value = `Total · ${rows.length}d`;
  let ti = 2;
  groups.forEach((g) => {
    // Totals row keeps the dark TOTAL_FILL (styleTotals below), so no ROAS tint here —
    // a light fill would be clobbered and read poorly on the dark band.
    g.cols.forEach((m) => { put(tr.getCell(ti), IS_EXTRA_COL(m.k) ? null : m.get(totals[g.key]), m.num); ti += 1; });
  });
  styleTotals(tr, 1 + totalCols);
  autoWidth(ws, 1 + totalCols, 12);
  ws.getColumn(1).width = 16;
}

// ── Sheet: Weekly Summary ────────────────────────────────────────────────────
// Per-platform compact NATIVE columns + Spend WoW + headline-efficiency WoW (matches UI).
function sheetWeekly(wb, { platforms, rows }) {
  if (!rows?.length) return;
  const ws = wb.addWorksheet('Weekly Summary', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
  const groups = groupsFor(platforms).map((g) => ({ ...g, cols: weeklyColsForGroup(g.key), headline: headlineOf(g.key) }));
  const weeks = weekBuckets(rows, platforms);
  const effLabel = (g) => (g.headline ? g.headline.label.replace('Conv. Val / Cost', 'Conv.V/Cost') : 'ROAS');

  ws.getCell(1, 1).value = 'Week'; ws.mergeCells(1, 1, 2, 1); ws.getCell(1, 1).font = { bold: true };
  ws.getCell(1, 2).value = 'Dates'; ws.mergeCells(1, 2, 2, 2); ws.getCell(1, 2).font = { bold: true };
  let c = 3;
  groups.forEach((g) => {
    const start = c;
    g.cols.forEach((m) => {
      ws.getCell(2, c).value = m.label;
      ws.getCell(2, c).fill = SUBHEAD_FILL;
      ws.getCell(2, c).font = { size: 9, bold: true, color: { argb: 'FF6B7280' } };
      c += 1;
    });
    // Spend WoW + headline-efficiency WoW deltas per group.
    ws.getCell(2, c).value = 'Spend WoW'; ws.getCell(2, c).fill = SUBHEAD_FILL; c += 1;
    ws.getCell(2, c).value = `${effLabel(g)} WoW`; ws.getCell(2, c).fill = SUBHEAD_FILL; c += 1;
    ws.mergeCells(1, start, 1, c - 1);
    const band = ws.getCell(1, start);
    band.value = g.meta.label; band.fill = fill(g.meta.hex); band.font = HEADER_FONT;
    band.alignment = { horizontal: 'center' };
  });
  const width = c - 1;

  // weeks are newest-first; WoW compares to the NEXT (older) week in the list.
  weeks.forEach((wk, i) => {
    const prev = weeks[i + 1];
    const row = ws.addRow([]);
    row.getCell(1).value = `Week ${wk.weekNo}`; row.getCell(1).font = { bold: true };
    row.getCell(2).value = wk.label;
    let ci = 3;
    groups.forEach((g) => {
      const cell = wk.byGroup[g.key];
      g.cols.forEach((m) => { putMetric(row.getCell(ci), m, m.get(cell)); ci += 1; });
      const pc = prev?.byGroup[g.key];
      const spendWoW = pc && pc.spend > 0 ? (cell.spend - pc.spend) / pc.spend : null;
      const eff = g.headline ? g.headline.get : roas;
      const eNow = eff(cell); const ePrev = pc ? eff(pc) : null;
      const effWoW = eNow != null && ePrev != null && ePrev !== 0 ? (eNow - ePrev) / ePrev : null;
      put(row.getCell(ci), spendWoW, 'pct'); ci += 1;
      put(row.getCell(ci), effWoW, 'pct'); ci += 1;
    });
  });

  // Month total.
  const tot = {};
  groups.forEach((g) => { tot[g.key] = sumCells(weeks.map((w) => w.byGroup[g.key])); });
  const tr = ws.addRow([]);
  tr.getCell(1).value = 'MONTH'; tr.getCell(2).value = `${weeks.length} weeks`;
  let ti = 3;
  groups.forEach((g) => {
    g.cols.forEach((m) => { put(tr.getCell(ti), m.get(tot[g.key]), m.num); ti += 1; });
    ti += 2; // skip WoW cols in total
  });
  styleTotals(tr, width);
  autoWidth(ws, width, 12);
  ws.getColumn(1).width = 10; ws.getColumn(2).width = 16;
}

// ── Sheet: Monthly Summary (month-on-month, metric per row, per platform) ─────
function sheetMonthly(wb, { platforms, rows }) {
  if (!rows?.length) return;
  const ws = wb.addWorksheet('Monthly Summary');
  const months = monthBuckets(rows, platforms); // newest first
  const monthsAsc = [...months].reverse();
  const groups = groupsFor(platforms);
  let r = 1;

  groups.forEach((g) => {
    // Section band: "GOOGLE — MONTH ON MONTH".
    const bandEnd = 1 + monthsAsc.length + 2; // Metric + months + Δ + Best
    ws.mergeCells(r, 1, r, bandEnd);
    const band = ws.getCell(r, 1);
    band.value = `${g.meta.label.toUpperCase()} — MONTH ON MONTH`;
    band.fill = fill(g.meta.hex); band.font = HEADER_FONT;
    r += 1;

    // Header: Metric | <months asc> | Δ last | Best month
    const hdr = ws.getRow(r);
    hdr.getCell(1).value = 'Metric';
    monthsAsc.forEach((m, i) => { hdr.getCell(2 + i).value = m.label; });
    hdr.getCell(2 + monthsAsc.length).value = 'Δ (last vs prev)';
    hdr.getCell(3 + monthsAsc.length).value = 'Best month';
    hdr.eachCell((cell) => { cell.fill = SUBHEAD_FILL; cell.font = { bold: true, size: 9, color: { argb: 'FF6B7280' } }; });
    r += 1;

    // One row per metric — per-platform NATIVE rows (matches UI Monthly Summary).
    monthlyRowsForGroup(g.key).forEach((mr) => {
      const row = ws.getRow(r);
      row.getCell(1).value = mr.label;
      row.getCell(1).font = { bold: !!mr.strong };
      const vals = monthsAsc.map((mo) => mr.get(mo.byGroup[g.key]));
      vals.forEach((v, i) => putMetric(row.getCell(2 + i), mr, v));
      const last = vals[vals.length - 1]; const prev = vals[vals.length - 2];
      const d = last != null && prev != null && prev !== 0 ? (last - prev) / prev : null;
      put(row.getCell(2 + monthsAsc.length), d, 'pct');
      // Best month = max value (for cost-like metrics ACOS/CPC lower is better, but
      // keep it simple = highest, matching the sheet's "Best Month" = peak).
      let bi = -1, bv = -Infinity;
      vals.forEach((v, i) => { if (v != null && v > bv) { bv = v; bi = i; } });
      ws.getCell(r, 3 + monthsAsc.length).value = bi >= 0 ? monthsAsc[bi].label : '—';
      r += 1;
    });
    r += 1; // gap between platform sections
  });
  autoWidth(ws, 3 + monthsAsc.length, 14);
  ws.getColumn(1).width = 14;
}
// ── Sheet: placement (weekly or monthly) ─────────────────────────────────────
// Placement rows (platform × placement) with a column-BLOCK per period (week/month):
// Spend/Sales/ROAS/ACOS/CPC/CVR + "% of period spend" + ROAS Δ (WoW/MoM). The MoM
// sheet leads with a "ROAS by placement" headline grid (placement × month).
const PLC_COLS = PLACEMENT_METRIC_COLS.map((m) => ({ k: m.k, label: m.label, num: m.num }));
const EMERALD = ['FF047857', 'FF065F46']; // alternating period-band fills

function sheetPlacement(wb, name, placementRows, mode) {
  if (!placementRows?.length) return;
  const grid = placementGrid(placementRows, mode);
  if (!grid.rows.length) return;
  const { rows, periods, periodLabel, shareOf } = grid;
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2, xSplit: 2 }] });
  let top = 1;

  // (A) MoM headline: ROAS by placement (placement × month + Δ last).
  if (mode === 'month') {
    const bandEnd = 2 + periods.length + 1;
    ws.mergeCells(top, 1, top, bandEnd);
    const band = ws.getCell(top, 1);
    band.value = 'A.  ROAS BY PLACEMENT'; band.fill = fill('FF10B981'); band.font = HEADER_FONT;
    top += 1;
    const hdrA = ws.getRow(top);
    hdrA.getCell(1).value = 'Platform'; hdrA.getCell(2).value = 'Placement';
    periods.forEach((p, i) => { hdrA.getCell(3 + i).value = periodLabel(p); });
    hdrA.getCell(3 + periods.length).value = 'Δ last';
    hdrA.eachCell((cell) => { cell.fill = SUBHEAD_FILL; cell.font = { bold: true, size: 9, color: { argb: 'FF6B7280' } }; });
    top += 1;
    rows.forEach((pr) => {
      const row = ws.getRow(top);
      const pm = PLATFORM_META[pr.platform] || { label: pr.platform, hex: 'FF374151' };
      row.getCell(1).value = pm.label; row.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.getCell(1).fill = fill(pm.hex);
      row.getCell(2).value = pr.placement;
      const vals = periods.map((p) => roas(pr.byPeriod[p]));
      vals.forEach((v, i) => put(row.getCell(3 + i), v, 'mult', roasFillArgb('roas', v)));
      const last = vals[vals.length - 1]; const prev = vals[vals.length - 2];
      const d = last != null && prev != null && prev !== 0 ? (last - prev) / prev : null;
      put(row.getCell(3 + periods.length), d, 'pct');
      top += 1;
    });
    top += 1; // gap before the detail block

    // (B) label band for the full detail section.
    ws.mergeCells(top, 1, top, 2 + periods.length * (PLC_COLS.length + 2));
    const bandB = ws.getCell(top, 1);
    bandB.value = 'B.  FULL DETAIL — by month & placement'; bandB.fill = fill('FF10B981'); bandB.font = HEADER_FONT;
    top += 1;
  }

  // Detail header: Platform | Placement | <period bands over metric labels>.
  const perBlock = PLC_COLS.length + 2; // metrics + % spend + ROAS Δ
  const groupRow = top; const labelRow = top + 1;
  ws.getCell(groupRow, 1).value = 'Platform'; ws.mergeCells(groupRow, 1, labelRow, 1);
  ws.getCell(groupRow, 2).value = 'Placement'; ws.mergeCells(groupRow, 2, labelRow, 2);
  ws.getCell(groupRow, 1).font = { bold: true }; ws.getCell(groupRow, 2).font = { bold: true };
  let c = 3;
  periods.forEach((p, pi) => {
    const start = c;
    PLC_COLS.forEach((m) => {
      ws.getCell(labelRow, c).value = m.label;
      ws.getCell(labelRow, c).fill = SUBHEAD_FILL;
      ws.getCell(labelRow, c).font = { size: 9, bold: true, color: { argb: 'FF6B7280' } };
      ws.getCell(labelRow, c).alignment = { horizontal: 'right' };
      c += 1;
    });
    ws.getCell(labelRow, c).value = '% spend'; ws.getCell(labelRow, c).fill = SUBHEAD_FILL; c += 1;
    ws.getCell(labelRow, c).value = mode === 'month' ? 'ROAS MoM' : 'ROAS WoW'; ws.getCell(labelRow, c).fill = SUBHEAD_FILL; c += 1;
    ws.mergeCells(groupRow, start, groupRow, c - 1);
    const band = ws.getCell(groupRow, start);
    band.value = periodLabel(p); band.fill = fill(EMERALD[pi % 2]); band.font = HEADER_FONT;
    band.alignment = { horizontal: 'center' };
  });
  const width = c - 1;

  // Detail rows.
  let r = labelRow + 1;
  rows.forEach((pr) => {
    const row = ws.getRow(r);
    const pm = PLATFORM_META[pr.platform] || { label: pr.platform, hex: 'FF374151' };
    row.getCell(1).value = pm.label; row.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.getCell(1).fill = fill(pm.hex);
    row.getCell(2).value = pr.placement;
    let ci = 3;
    periods.forEach((p, pi) => {
      const cell = pr.byPeriod[p];
      const prevC = pi > 0 ? pr.byPeriod[periods[pi - 1]] : null;
      PLC_COLS.forEach((m) => { const v = rawMetric(cell, m.k); put(row.getCell(ci), v, m.num, roasFillArgb(m.k, v)); ci += 1; });
      put(row.getCell(ci), shareOf(pr.platform, p, cell), 'pct'); ci += 1;
      const rNow = roas(cell); const rPrev = prevC ? roas(prevC) : null;
      const roasChg = rNow != null && rPrev != null && rPrev !== 0 ? (rNow - rPrev) / rPrev : null;
      put(row.getCell(ci), roasChg, 'pct'); ci += 1;
    });
    r += 1;
  });
  autoWidth(ws, width, 11);
  ws.getColumn(1).width = 12; ws.getColumn(2).width = 26;
}

// ── shared styling helpers ───────────────────────────────────────────────────
function styleTotals(row, width) {
  for (let i = 1; i <= width; i += 1) {
    const cell = row.getCell(i);
    cell.fill = TOTAL_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  }
}
function autoWidth(ws, width, def) {
  for (let i = 1; i <= width; i += 1) {
    if (!ws.getColumn(i).width) ws.getColumn(i).width = def;
  }
  ws.eachRow((row) => row.eachCell((cell) => { cell.border = border; }));
}

/**
 * Build + download the workbook. `bundle` = the /cdp/daily-log response
 * ({ platforms, rows, placement, placementPlatforms, startDate, endDate }).
 * `title` (workspace/date) goes into the filename.
 */
export async function exportReportingPack(bundle, title = 'reporting-pack') {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Meerkats';
  wb.created = new Date(bundle.endDate + 'T00:00:00');

  sheetDailyLog(wb, bundle);
  sheetWeekly(wb, bundle);
  sheetMonthly(wb, bundle);
  sheetPlacement(wb, 'Weekly Placement', bundle.placement, 'week');
  sheetPlacement(wb, 'Placement MoM', bundle.placement, 'month');

  // If no data at all, still give an empty Daily Log so the file isn't corrupt.
  if (wb.worksheets.length === 0) wb.addWorksheet('Daily Log');

  const buf = await wb.xlsx.writeBuffer();
  const safe = `${title}_${bundle.startDate}_${bundle.endDate}`.replace(/[^\w.-]+/g, '-');
  saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safe}.xlsx`);
}
