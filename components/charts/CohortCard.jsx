/**
 * CohortCard — acquisition-month cohort retention/LTV heatmap.
 *
 * One row per cohort (month of first order), one column per month-since-first-order
 * (M0, M1, …). A Metric selector switches the value shown in each cell:
 *   • Retention rate — active buyers ÷ cohort size (%)           [diverging vs target]
 *   • LTV            — cumulative revenue per customer (₹)         [sequential]
 *   • Total sales    — revenue from the cohort that month (₹)      [sequential]
 *   • # Customers    — active buyers that month                    [sequential]
 *
 * Input `rows` come straight from /cdp/cohorts (getCohortRetention), which already
 * computes cohort_size, retention_pct and cumulative ltv — so this component only
 * PIVOTS long→wide and colors; it does no metric math beyond formatting.
 *
 * Small cohorts (< SIZE_THRESHOLD month-0 buyers) are de-emphasised (dimmed + *)
 * because a % off a tiny base is noise — same treatment as the reference design.
 */
import React, { useMemo, useState } from 'react'
import { ChartCard } from './ChartCard'
import { fmtMoney, fmtNum } from './chartSetup'

// Below this cohort size, retention % is noisy — de-emphasise visually.
const SIZE_THRESHOLD = 30

// The four selectable metrics. `field` = the row key from the API; `kind` drives
// the color scale + cell formatting.
const METRICS = [
  { key: 'retention_pct', label: 'Retention rate', kind: 'pct', fmt: (v) => `${v}%` },
  { key: 'ltv', label: 'LTV', kind: 'money', fmt: (v) => fmtMoney(v) },
  { key: 'revenue', label: 'Total sales', kind: 'money', fmt: (v) => fmtMoney(v) },
  { key: 'active_buyers', label: '# Customers', kind: 'count', fmt: (v) => fmtNum(v) },
]

// "Healthy" retention curve per month-since-first-order — the benchmark the
// retention view colors against (green = above target, red = below). Monthly
// D2C repeat curve; tune to your own history.
const MONTHLY_TARGETS = [100, 22, 15, 12, 10, 9, 8, 7, 7, 6, 6, 5, 5]

function fmtCohortLabel(d, weekly) {
  // d is 'YYYY-MM-DD' (the cohort period start). Monthly → 'Mon YYYY'; weekly →
  // 'Mon D' (the week-of date, e.g. 'Jun 8').
  const dt = new Date(d)
  if (isNaN(dt)) return String(d)
  return weekly
    ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// Diverging scale for retention: anchored to the month's TARGET, not the table max.
// Above target → green, below → red; magnitude controls intensity.
function retentionColor(v, target) {
  if (v == null) return 'transparent'
  const delta = v - target
  const capped = Math.min(1, Math.abs(delta) / 15) // full saturation at ±15pts
  const lightness = 92 - capped * 42
  const hue = delta >= 0 ? 152 : 4
  return `hsl(${hue}, 55%, ${lightness}%)`
}
function retentionText(v, target) {
  if (v == null) return '#0f172a'
  const capped = Math.min(1, Math.abs(v - target) / 15)
  return capped > 0.55 ? '#f8fafc' : '#0f172a'
}

// Sequential scale for money/count metrics: relative to the max in the table.
function sequentialColor(v, max) {
  if (v == null || max <= 0) return 'transparent'
  const t = Math.min(1, v / max)
  const lightness = 94 - t * 46 // near-white → deep teal
  return `hsl(178, 42%, ${lightness}%)`
}
function sequentialText(v, max) {
  if (v == null || max <= 0) return '#0f172a'
  return v / max > 0.6 ? '#f8fafc' : '#0f172a'
}

// Tiny inline sparkline of a cohort's completed cells (trend at a glance).
function sparklinePoints(values, width = 60, height = 20) {
  const pts = values.filter((v) => v != null)
  if (pts.length < 2) return null
  const max = Math.max(...pts) || 1
  const stepX = width / (pts.length - 1)
  return pts
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`)
    .join(' ')
}

export default function CohortCard({ rows, loading, error, ask, grain = 'month', onGrainChange }) {
  const [metricKey, setMetricKey] = useState('retention_pct')
  const metric = METRICS.find((m) => m.key === metricKey) || METRICS[0]
  const isWeekly = grain === 'week'

  // Pivot long rows → { cohorts: [{cohort_month, cohort_size, cells: {offset: value}}], maxOffset }
  const pivot = useMemo(() => {
    const byCohort = new Map()
    let maxOffset = 0
    for (const r of rows || []) {
      const cm = r.cohort_month
      if (!byCohort.has(cm)) {
        byCohort.set(cm, { cohort_month: cm, cohort_size: Number(r.cohort_size || 0), cells: {} })
      }
      const off = Number(r.month_offset)
      if (off > maxOffset) maxOffset = off
      byCohort.get(cm).cells[off] = r[metric.key] == null ? null : Number(r[metric.key])
    }
    // Oldest cohort first (top) → latest month at the BOTTOM of the table.
    const cohorts = [...byCohort.values()].sort((a, b) =>
      String(a.cohort_month).localeCompare(String(b.cohort_month)),
    )
    return { cohorts, maxOffset }
  }, [rows, metric.key])

  const offsets = Array.from({ length: pivot.maxOffset + 1 }, (_, i) => i)

  // Sequential metrics need the table max for the color scale.
  const tableMax = useMemo(() => {
    if (metric.kind === 'pct') return 100
    let mx = 0
    for (const c of pivot.cohorts) {
      for (const off of offsets) {
        const v = c.cells[off]
        if (v != null && v > mx) mx = v
      }
    }
    return mx
  }, [pivot, offsets, metric.kind])

  const empty = !loading && !error && pivot.cohorts.length === 0

  const selector = (
    <div className="flex items-center gap-2">
      {/* Weekly / Monthly grain toggle — re-fetches via onGrainChange. */}
      {onGrainChange && (
        <div className="flex overflow-hidden rounded-full bg-gray-100">
          {[['month', 'Monthly'], ['week', 'Weekly']].map(([g, label]) => (
            <button
              key={g}
              onClick={() => onGrainChange(g)}
              className={`px-2.5 py-1 text-xs font-medium transition ${
                grain === g ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {/* Metric selector */}
      <select
        value={metricKey}
        onChange={(e) => setMetricKey(e.target.value)}
        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
      >
        {METRICS.map((m) => (
          <option key={m.key} value={m.key}>{m.label}</option>
        ))}
      </select>
    </div>
  )

  // Retention: diverging vs the monthly target curve (monthly grain only). Weekly has
  // no per-week benchmark, so it uses a sequential scale on the % itself (like the
  // money/count metrics). Money/count are always sequential vs the table max.
  const retentionScaled = metric.kind === 'pct' && !isWeekly
  const colorFor = (v, off) =>
    retentionScaled
      ? retentionColor(v, MONTHLY_TARGETS[off] ?? MONTHLY_TARGETS[MONTHLY_TARGETS.length - 1])
      : sequentialColor(v, metric.kind === 'pct' ? 100 : tableMax)
  const textFor = (v, off) =>
    retentionScaled
      ? retentionText(v, MONTHLY_TARGETS[off] ?? MONTHLY_TARGETS[MONTHLY_TARGETS.length - 1])
      : sequentialText(v, metric.kind === 'pct' ? 100 : tableMax)

  return (
    <ChartCard
      title="Cohort analysis"
      subtitle={isWeekly
        ? 'acquisition-week cohorts · value by weeks since first order'
        : 'acquisition-month cohorts · value by months since first order'}
      loading={loading}
      error={error}
      empty={empty}
      right={selector}
      ask={ask}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="px-2.5 py-1.5 text-left font-medium text-gray-500">Cohort</th>
              <th className="px-2.5 py-1.5 text-right font-medium text-gray-500">Size</th>
              {offsets.map((off) => (
                <th key={off} className="px-2.5 py-1.5 text-center font-medium text-gray-500">
                  {isWeekly ? 'W' : 'M'}{off}
                  {/* Target curve is monthly-only; weekly has no per-week benchmark. */}
                  {metric.kind === 'pct' && !isWeekly && (
                    <div className="text-[10px] font-normal text-gray-300">
                      tgt {MONTHLY_TARGETS[off] ?? MONTHLY_TARGETS[MONTHLY_TARGETS.length - 1]}%
                    </div>
                  )}
                </th>
              ))}
              <th className="px-2.5 py-1.5 text-center font-medium text-gray-500">Trend</th>
            </tr>
          </thead>
          <tbody>
            {pivot.cohorts.map((c) => {
              const small = c.cohort_size < SIZE_THRESHOLD
              const series = offsets.map((off) => c.cells[off] ?? null)
              const pts = sparklinePoints(series)
              return (
                <tr key={c.cohort_month} style={{ opacity: small ? 0.5 : 1 }}>
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-gray-700">
                    {fmtCohortLabel(c.cohort_month, isWeekly)}
                    {small && (
                      <span
                        title={`Below ${SIZE_THRESHOLD} customers — % is noisy`}
                        className="ml-1 cursor-default text-gray-400"
                      >
                        *
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-500">
                    {fmtNum(c.cohort_size)}
                  </td>
                  {offsets.map((off) => {
                    const v = c.cells[off]
                    return (
                      <td
                        key={off}
                        className="px-2.5 py-1.5 text-center tabular-nums"
                        style={{
                          background: colorFor(v, off),
                          color: textFor(v, off),
                          borderRadius: 4,
                        }}
                      >
                        {v == null ? '' : metric.fmt(v)}
                      </td>
                    )
                  })}
                  <td className="px-2.5 py-1.5 text-center">
                    {pts ? (
                      <svg width="60" height="20" style={{ overflow: 'visible' }}>
                        <polyline points={pts} fill="none" stroke="#0f766e" strokeWidth="1.5" />
                      </svg>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 px-0.5 text-[11px] text-gray-400">
        {retentionScaled
          ? 'Color is relative to the target retention curve per month — green outperforms, red underperforms.'
          : 'Color intensity is relative to the highest value in the table.'}
        <span className="ml-1.5">* cohort under {SIZE_THRESHOLD} customers — de-emphasised.</span>
      </p>
    </ChartCard>
  )
}
