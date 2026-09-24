"use client";
/**
 * ReportingPack — the cross-platform Data-Spine reporting workbook, ported from the
 * Meerkats dashboard. Tabbed like the founder's Excel: Daily Log · Weekly Summary ·
 * Monthly Summary · Weekly Placement · Placement MoM, plus an "Export to Excel".
 *
 * ONE fetch (GET /cdp/daily-log → the bundle, via the public-API proxy) drives every
 * tab + the export; the week/month/placement pivots are derived client-side in
 * lib/reporting.js. Only CONNECTED (has-data) platforms show — any combination works.
 * Metrics are platform-REPORTED SIGNAL (ad-console attributed figures).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, Database, FileSpreadsheet } from 'lucide-react';
import cdpApi from '@/lib/cdpApi';
import WindowSelector, { useWindow } from '@/components/charts/WindowSelector';
import { lastNDays, monthWindow } from '@/components/charts/dateWindows';
import { toast } from 'sonner';
import {
  groupsFor, cellOfRow, weekBuckets, monthBuckets, placementGrid,
  PLACEMENT_METRIC_COLS, PLATFORM_META, ZERO, addCell,
  colsForGroup, weeklyColsForGroup, monthlyRowsForGroup, headlineOf,
  metaFor, roas, dayParts, mult, pct, delta, roasCellClass, roasCellClassDark,
} from '@/lib/reporting';
import { exportReportingPack } from '@/lib/exportExcel';

const WINDOWS = [
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_14_days', label: 'Last 14 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_90_days', label: 'Last 3 months' },
];
const resolveWindow = (win) => {
  if (win === 'last_7_days') return lastNDays(7);
  if (win === 'last_14_days') return lastNDays(14);
  if (win === 'last_90_days') return lastNDays(90);
  if (win === 'this_month') return monthWindow(new Date());
  if (win === 'last_month') {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    return monthWindow(d);
  }
  return lastNDays(30);
};

const TABS = [
  { id: 'daily', label: 'Daily Log' },
  { id: 'weekly', label: 'Weekly Summary' },
  { id: 'monthly', label: 'Monthly Summary' },
  { id: 'placement_w', label: 'Weekly Placement' },
  { id: 'placement_m', label: 'Placement MoM' },
];

const dash = <span className="text-gray-300">—</span>;

export default function ReportingPack() {
  const [loading, setLoading] = useState(false);
  const [bundle, setBundle] = useState(null); // { platforms, rows, placement, placementPlatforms, startDate, endDate }
  const [tab, setTab] = useState('daily');

  const winCtrl = useWindow(resolveWindow, 'last_30_days');
  const win = winCtrl.window_;

  // Month-comparison tabs (Monthly / Placement MoM) need several months present, so
  // they always fetch a WIDE window (≥90d); the other tabs use the selected window.
  const monthMode = tab === 'monthly' || tab === 'placement_m';
  const fetchWin = useMemo(() => {
    if (!monthMode) return win;
    const wide = lastNDays(90);
    const start = win.startDate && win.startDate < wide.startDate ? win.startDate : wide.startDate;
    const end = win.endDate && win.endDate > wide.endDate ? win.endDate : wide.endDate;
    return { startDate: start, endDate: end };
  }, [monthMode, win.startDate, win.endDate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cdpApi.cdp.getDailyLog(fetchWin.startDate, fetchWin.endDate);
      setBundle(res.data || null);
    } catch (e) {
      toast.error(`Load failed: ${e.message}`);
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, [fetchWin.startDate, fetchWin.endDate]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fetchWin.startDate, fetchWin.endDate]);
  // Re-pull when the workspace switches (the sidebar fires this on change).
  useEffect(() => {
    const onRefresh = () => load();
    window.addEventListener('mk-metrics-refresh', onRefresh);
    return () => window.removeEventListener('mk-metrics-refresh', onRefresh);
  }, [load]);

  const platforms = bundle?.platforms || [];
  const rows = bundle?.rows || [];
  const groups = useMemo(() => groupsFor(platforms), [platforms]);
  const hasData = groups.length > 0 && rows.length > 0;

  const onExport = useCallback(async () => {
    if (!bundle || !rows.length) return;
    const t = toast.loading('Building Excel workbook…');
    try {
      await exportReportingPack(bundle, 'reporting-pack');
      toast.success('Workbook downloaded.', { id: t });
    } catch (e) {
      toast.error(`Export failed: ${e.message}`, { id: t });
    }
  }, [bundle, rows.length]);

  return (
    <div className="p-6 max-w-full">
      <div className="flex items-center gap-2 mb-1">
        <Database className="h-4 w-4 text-emerald-700" />
        <h1 className="text-lg font-semibold text-gray-900">Reporting Pack</h1>
      </div>
      <p className="mb-4 text-xs text-gray-400">
        Amazon / Flipkart / Google / Meta performance across your connected platforms. Spend, clicks &amp; impressions
        are as-reported; sales &amp; units are the ad console&apos;s attributed figures. ROAS / ACOS / CPC / CVR / AOV are derived.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex-1" />
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-gray-400">Window</span>
          <WindowSelector presets={WINDOWS} ctrl={winCtrl} suffix="" />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1.5">Refresh</span>
        </Button>
        <Button onClick={onExport} variant="outline" disabled={!hasData}
          className="text-emerald-700 border-emerald-200 hover:bg-emerald-50">
          <FileSpreadsheet className="h-4 w-4" />
          <span className="ml-1.5">Export to Excel</span>
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              tab === t.id ? 'border-emerald-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400 bg-white rounded-lg border">
          <Loader2 className="h-5 w-5 animate-spin" /><span className="text-xs">Loading…</span>
        </div>
      ) : !hasData ? (
        <div className="py-12 text-center text-gray-400 text-sm bg-white rounded-lg border">
          No ad data for this window. Connect a platform (Google / Meta / Amazon / Flipkart) and sync, or widen the range.
        </div>
      ) : (
        <>
          {tab === 'daily' && <DailyLogTab groups={groups} rows={rows} />}
          {tab === 'weekly' && <WeeklyTab groups={groups} rows={rows} platforms={platforms} />}
          {tab === 'monthly' && <MonthlyTab groups={groups} rows={rows} platforms={platforms} />}
          {tab === 'placement_w' && <PlacementTab placement={bundle.placement} mode="week" />}
          {tab === 'placement_m' && <PlacementTab placement={bundle.placement} mode="month" />}
        </>
      )}
    </div>
  );
}

// ── Daily Log tab ────────────────────────────────────────────────────────────
function DailyLogTab({ groups, rows }) {
  const groupCols = useMemo(
    () => groups.map((g) => ({ ...g, cols: colsForGroup(g.key) })),
    [groups]
  );
  const totals = useMemo(() => {
    const t = {}; groups.forEach((g) => { t[g.key] = { ...ZERO }; });
    rows.forEach((r) => groups.forEach((g) => { t[g.key] = addCell(t[g.key], cellOfRow(r, g.key)); }));
    return t;
  }, [groups, rows]);

  return (
    <div className="bg-white rounded-lg border overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th rowSpan={2} className="sticky left-0 z-20 bg-gray-50 border-b border-r px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Date</th>
            {groupCols.map((g) => (
              <th key={g.key} colSpan={g.cols.length} className={`border-b border-l px-3 py-1.5 text-center text-[12px] font-bold uppercase tracking-wider text-white ${g.meta.head}`}>{g.meta.label}</th>
            ))}
          </tr>
          <tr className="bg-gray-50">
            {groupCols.map((g) => g.cols.map((m, i) => (
              <th key={`${g.key}:${m.k}`} className={`border-b px-2.5 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap ${i === 0 ? 'border-l' : ''}`}>{m.label}</th>
            )))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => {
            const { day, mon, dow } = dayParts(r.date);
            return (
              <tr key={r.date} className="hover:bg-gray-50/70">
                <td className="sticky left-0 z-10 bg-white border-r px-3 py-1.5 whitespace-nowrap">
                  <span className="font-semibold text-gray-800">{day} {mon}</span>
                  <span className="ml-1.5 text-[11px] text-gray-400">{dow}</span>
                </td>
                {groupCols.map((g) => {
                  const c = cellOfRow(r, g.key);
                  return g.cols.map((m, i) => {
                    const hl = roasCellClass(m.k, m.get(c));
                    return (
                      <td key={`${g.key}:${m.k}`} className={`px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap ${i === 0 ? 'border-l' : ''} ${hl || g.meta.tint} ${m.strong ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{m.fmt(c)}</td>
                    );
                  });
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-gray-800 text-white">
            <td className="sticky left-0 z-10 bg-gray-800 border-r border-gray-700 px-3 py-2 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">Total · {rows.length}d</td>
            {groupCols.map((g) => g.cols.map((m, i) => {
              const hlDark = roasCellClassDark(m.k, m.get(totals[g.key]));
              return (
                <td key={`${g.key}:${m.k}`} className={`px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-[12px] ${i === 0 ? 'border-l border-gray-700' : ''} ${hlDark || (m.strong ? 'font-bold text-white' : 'text-gray-200')} ${hlDark && m.strong ? 'font-bold' : ''}`}>{m.k === 'search_impression_share' || m.k === 'search_lost_is_budget' ? '—' : m.fmt(totals[g.key])}</td>
              );
            }))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const deltaCls = (f) => (f == null ? 'text-gray-300' : f >= 0 ? 'text-emerald-600' : 'text-rose-600');

// ── Weekly Summary tab ───────────────────────────────────────────────────────
function WeeklyTab({ groups, rows, platforms }) {
  const groupCols = useMemo(
    () => groups.map((g) => ({ ...g, cols: weeklyColsForGroup(g.key), headline: headlineOf(g.key) })),
    [groups]
  );
  const weeks = useMemo(() => weekBuckets(rows, platforms), [rows, platforms]);
  const monthTot = useMemo(() => {
    const t = {}; groups.forEach((g) => { t[g.key] = { spend: 0, sales: 0, units: 0, clicks: 0, impressions: 0 }; });
    weeks.forEach((w) => groups.forEach((g) => {
      const c = w.byGroup[g.key];
      t[g.key].spend += c.spend; t[g.key].sales += c.sales; t[g.key].units += c.units;
      t[g.key].clicks += c.clicks; t[g.key].impressions += c.impressions;
    }));
    return t;
  }, [groups, weeks]);

  const effLabel = (g) => (g.headline ? g.headline.label.replace('Conv. Val / Cost', 'Conv.V/Cost') : 'ROAS');

  return (
    <div className="bg-white rounded-lg border overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th rowSpan={2} className="sticky left-0 z-20 bg-gray-50 border-b border-r px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Week</th>
            <th rowSpan={2} className="bg-gray-50 border-b border-r px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Dates</th>
            {groupCols.map((g) => (
              <th key={g.key} colSpan={g.cols.length + 2} className={`border-b border-l px-3 py-1.5 text-center text-[12px] font-bold uppercase tracking-wider text-white ${g.meta.head}`}>{g.meta.label}</th>
            ))}
          </tr>
          <tr className="bg-gray-50">
            {groupCols.map((g) => (
              <React.Fragment key={g.key}>
                {g.cols.map((m, i) => (
                  <th key={`${g.key}:${m.k}`} className={`border-b px-2.5 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap ${i === 0 ? 'border-l' : ''}`}>{m.label}</th>
                ))}
                <th className="border-b px-2.5 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-gray-400 whitespace-nowrap">Spend WoW</th>
                <th className="border-b px-2.5 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-gray-400 whitespace-nowrap">{effLabel(g)} WoW</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {weeks.map((wk, idx) => {
            const prev = weeks[idx + 1];
            return (
              <tr key={wk.key} className="hover:bg-gray-50/70">
                <td className="sticky left-0 z-10 bg-white border-r px-3 py-1.5 whitespace-nowrap font-semibold text-gray-800">Week {wk.weekNo}</td>
                <td className="border-r px-3 py-1.5 whitespace-nowrap text-gray-500 text-[12px]">{wk.label}</td>
                {groupCols.map((g) => {
                  const c = wk.byGroup[g.key]; const pc = prev?.byGroup[g.key];
                  const spendWoW = pc && pc.spend > 0 ? (c.spend - pc.spend) / pc.spend : null;
                  const eff = g.headline ? g.headline.get : roas;
                  const eNow = eff(c); const ePrev = pc ? eff(pc) : null;
                  const effWoW = eNow != null && ePrev != null && ePrev !== 0 ? (eNow - ePrev) / ePrev : null;
                  return (
                    <React.Fragment key={g.key}>
                      {g.cols.map((m, i) => {
                        const hl = roasCellClass(m.k, m.get(c));
                        return (
                          <td key={m.k} className={`px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap ${i === 0 ? 'border-l' : ''} ${hl || g.meta.tint} ${m.strong ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{m.fmt(c)}</td>
                        );
                      })}
                      <td className={`px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap text-[12px] ${deltaCls(spendWoW)}`}>{delta(spendWoW)}</td>
                      <td className={`px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap text-[12px] ${deltaCls(effWoW)}`}>{delta(effWoW)}</td>
                    </React.Fragment>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-gray-800 text-white">
            <td className="sticky left-0 z-10 bg-gray-800 border-r border-gray-700 px-3 py-2 text-[11px] font-bold uppercase tracking-wider">MONTH</td>
            <td className="border-r border-gray-700 px-3 py-2 text-[11px] text-gray-300">{weeks.length} weeks</td>
            {groupCols.map((g) => (
              <React.Fragment key={g.key}>
                {g.cols.map((m, i) => {
                  const hlDark = roasCellClassDark(m.k, m.get(monthTot[g.key]));
                  return (
                    <td key={m.k} className={`px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-[12px] ${i === 0 ? 'border-l border-gray-700' : ''} ${hlDark || (m.strong ? 'font-bold text-white' : 'text-gray-200')} ${hlDark && m.strong ? 'font-bold' : ''}`}>{m.fmt(monthTot[g.key])}</td>
                  );
                })}
                <td className="px-2.5 py-2" /><td className="px-2.5 py-2" />
              </React.Fragment>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Monthly Summary tab (month-on-month, one metric per row, per platform) ────
function MonthlyTab({ groups, rows, platforms }) {
  const months = useMemo(() => monthBuckets(rows, platforms), [rows, platforms]);
  const monthsAsc = useMemo(() => [...months].reverse(), [months]);

  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const metricRows = monthlyRowsForGroup(g.key);
        return (
        <div key={g.key} className="bg-white rounded-lg border overflow-x-auto">
          <div className={`px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-white ${g.meta.head}`}>
            {g.meta.label} — Month on Month
          </div>
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="border-b px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Metric</th>
                {monthsAsc.map((m) => (
                  <th key={m.key} className="border-b border-l px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">{m.label}</th>
                ))}
                <th className="border-b border-l px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">Δ last</th>
                <th className="border-b border-l px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">Best</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {metricRows.map((mr) => {
                const vals = monthsAsc.map((mo) => mr.get(mo.byGroup[g.key]));
                const last = vals[vals.length - 1]; const prev = vals[vals.length - 2];
                const d = last != null && prev != null && prev !== 0 ? (last - prev) / prev : null;
                let bi = -1, bv = -Infinity;
                vals.forEach((v, i) => { if (v != null && v > bv) { bv = v; bi = i; } });
                return (
                  <tr key={mr.k} className="hover:bg-gray-50/70">
                    <td className={`px-3 py-1.5 whitespace-nowrap ${mr.strong ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{mr.label}</td>
                    {vals.map((v, i) => {
                      const hl = roasCellClass(mr.k, v);
                      return (
                        <td key={i} className={`border-l px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${hl || ''} ${mr.strong ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{v == null ? dash : mr.fmt(v)}</td>
                      );
                    })}
                    <td className={`border-l px-3 py-1.5 text-right tabular-nums whitespace-nowrap text-[12px] ${deltaCls(d)}`}>{delta(d)}</td>
                    <td className="border-l px-3 py-1.5 text-left whitespace-nowrap text-[12px] text-gray-500">{bi >= 0 ? monthsAsc[bi].label : dash}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        );
      })}
    </div>
  );
}

// ── Placement tabs (Weekly Placement / Placement MoM) ────────────────────────
const emptyPlacement = (
  <div className="py-12 text-center text-gray-400 text-sm bg-white rounded-lg border">
    No placement data for this window. Placement breakdowns come from Meta, Amazon &amp; Flipkart
    (Google Ads has no placement report). Sync those platforms&apos; placement reports to populate this tab.
  </div>
);

function PlacementTab({ placement, mode }) {
  const grid = useMemo(() => placementGrid(placement, mode), [placement, mode]);
  if (!grid.rows.length) return emptyPlacement;
  return (
    <div className="space-y-6">
      {mode === 'month' && <PlacementRoasHeadline grid={grid} />}
      <PlacementDetail grid={grid} mode={mode} />
    </div>
  );
}

function PlacementRoasHeadline({ grid }) {
  const { rows, periods, periodLabel } = grid;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">A</span>
        <span className="text-sm font-semibold text-gray-800">ROAS by placement</span>
      </div>
      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border-b px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Platform</th>
              <th className="border-b border-l px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Placement</th>
              {periods.map((p) => (
                <th key={p} className="border-b border-l px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">{periodLabel(p)}</th>
              ))}
              <th className="border-b border-l px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">Δ last</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((pr, i) => {
              const pm = PLATFORM_META[pr.platform] || metaFor(pr.platform);
              const vals = periods.map((p) => roas(pr.byPeriod[p]));
              const last = vals[vals.length - 1]; const prev = vals[vals.length - 2];
              const d = last != null && prev != null && prev !== 0 ? (last - prev) / prev : null;
              return (
                <tr key={`${pr.platform}:${pr.placement}:${i}`} className="hover:bg-gray-50/70">
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold text-white ${pm.head}`}>{pm.label}</span>
                  </td>
                  <td className="border-l px-3 py-1.5 whitespace-nowrap text-gray-700 text-[12px]">{pr.placement}</td>
                  {vals.map((v, j) => {
                    const hl = roasCellClass('roas', v);
                    return (
                      <td key={j} className={`border-l px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-semibold ${hl || 'text-gray-900'}`}>{mult(v)}</td>
                    );
                  })}
                  <td className={`border-l px-3 py-1.5 text-right tabular-nums whitespace-nowrap text-[12px] ${deltaCls(d)}`}>{delta(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlacementDetail({ grid, mode }) {
  const { rows, periods, periodLabel, shareOf } = grid;
  const cols = PLACEMENT_METRIC_COLS;
  const perBlock = cols.length + 2;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {mode === 'month' && <span className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">B</span>}
        <span className="text-sm font-semibold text-gray-800">
          {mode === 'month' ? 'Full detail — by month & placement' : 'Placement performance by week'}
        </span>
        <span className="text-xs text-gray-400">· Meta / Amazon / Flipkart only (Google Ads has no placement report)</span>
      </div>
      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th rowSpan={2} className="sticky left-0 z-20 bg-gray-50 border-b border-r px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Platform</th>
              <th rowSpan={2} className="sticky left-[92px] z-20 bg-gray-50 border-b border-r px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Placement</th>
              {periods.map((p, i) => (
                <th key={p} colSpan={perBlock} className={`border-b border-l px-3 py-1.5 text-center text-[12px] font-bold uppercase tracking-wider text-white ${i % 2 === 0 ? 'bg-emerald-700' : 'bg-emerald-800'}`}>{periodLabel(p)}</th>
              ))}
            </tr>
            <tr className="bg-gray-50">
              {periods.map((p) => (
                <React.Fragment key={p}>
                  {cols.map((m, i) => (
                    <th key={`${p}:${m.k}`} className={`border-b px-2.5 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap ${i === 0 ? 'border-l' : ''}`}>{m.label}</th>
                  ))}
                  <th className="border-b px-2.5 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-gray-400 whitespace-nowrap">% spend</th>
                  <th className="border-b px-2.5 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-gray-400 whitespace-nowrap">ROAS {mode === 'month' ? 'MoM' : 'WoW'}</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((pr, ri) => {
              const pm = PLATFORM_META[pr.platform] || metaFor(pr.platform);
              return (
                <tr key={`${pr.platform}:${pr.placement}:${ri}`} className="hover:bg-gray-50/70">
                  <td className="sticky left-0 z-10 bg-white border-r px-3 py-1.5 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold text-white ${pm.head}`}>{pm.label}</span>
                  </td>
                  <td className="sticky left-[92px] z-10 bg-white border-r px-3 py-1.5 whitespace-nowrap text-gray-700 text-[12px]">{pr.placement}</td>
                  {periods.map((p, pi) => {
                    const c = pr.byPeriod[p];
                    const prevC = pi > 0 ? pr.byPeriod[periods[pi - 1]] : null;
                    const rNow = roas(c); const rPrev = prevC ? roas(prevC) : null;
                    const roasChg = rNow != null && rPrev != null && rPrev !== 0 ? (rNow - rPrev) / rPrev : null;
                    const share = shareOf(pr.platform, p, c);
                    return (
                      <React.Fragment key={p}>
                        {cols.map((m, i) => {
                          const hl = roasCellClass(m.k, m.get(c));
                          return (
                            <td key={m.k} className={`px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap ${i === 0 ? 'border-l' : ''} ${hl || ''} ${m.strong ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{m.fmt(c)}</td>
                          );
                        })}
                        <td className="px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap text-[12px] text-gray-500">{pct(share)}</td>
                        <td className={`px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap text-[12px] ${deltaCls(roasChg)}`}>{delta(roasChg)}</td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
