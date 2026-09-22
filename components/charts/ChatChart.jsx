import React from 'react'
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2'
import {
    COLORS, SERIES, SEMANTIC, roasColor,
    fmtMoneyInr, fmtNumCompact, fmtDay, fmtWeek, fmtMonth,
} from './chartSetup'
import './chartSetup'

/**
 * ChatChart — render a chart INSIDE a chat message from a { spec, rows } pair.
 *
 * Shared by:
 *   • ChartSnapshotMessage — the FROZEN cockpit chart embedded in a "chat about
 *     this graph" thread (spec + rows loaded from a chart_snapshots row), and
 *   • the render_chart tool result — a chart the AGENT generated on request
 *     (spec + rows returned inline by the tool, drawn straight from the result).
 *
 * The spec is a small, render-only shape (NOT the semantic-layer query):
 *   { type: 'line'|'bar'|'hbar'|'combo'|'table'|'kpi',
 *     metrics: string[],        // series/value keys present in each row
 *     groupBy: string[],        // [0] is the x/label dimension
 *     valueFmt: 'money'|'num'|'roas'|'pct'|'plain',
 *     barKeys?, lineKey?, lineFmt?  // combo only
 *   }
 * Unknown/table/kpi types fall back to a compact table so nothing is ever blank.
 */

const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0 }
export const CHAT_CHART_FMT = {
    money: (v) => fmtMoneyInr(v),
    num: (v) => fmtNumCompact(v),
    roas: (v) => (v == null || !isFinite(Number(v)) ? '—' : `${Number(v).toFixed(2)}×`),
    pct: (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`),
    plain: (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })),
}
const isTimeDim = (d) => typeof d === 'string' && d.startsWith('metric_time__')
const timeLabelFor = (dim) => (dim === 'metric_time__day' ? fmtDay : (dim === 'metric_time__week' || dim === 'metric_time__week_sun') ? fmtWeek : fmtMonth)

/** Draw the rows per the spec's chart type. Falls back to a small table for
 *  table/kpi/unknown so nothing is ever blank. Pass `chartRef` (a React ref) to get
 *  the underlying chart.js instance — used for PNG export. */
export function ChatChart({ spec, rows, chartRef }) {
    const type = spec?.type
    const dim = spec?.groupBy?.[0]
    const fmt = CHAT_CHART_FMT[spec?.valueFmt] || CHAT_CHART_FMT.plain
    const labelFmt = isTimeDim(dim) ? timeLabelFor(dim) : (v) => (v == null ? '—' : String(v))
    const labels = (rows || []).map((r) => labelFmt(r[dim]))

    if (type === 'line') {
        const datasets = (spec.metrics || []).map((m, i) => ({
            label: m, data: (rows || []).map((r) => num(r[m])),
            borderColor: SERIES[i % SERIES.length], backgroundColor: SERIES[i % SERIES.length],
            pointRadius: 2, tension: 0.35, fill: false,
        }))
        return <Line ref={chartRef} data={{ labels, datasets }} options={lineOpts(datasets.length > 1, fmt)} />
    }
    if (type === 'bar' || type === 'hbar') {
        const metric = spec.metrics?.[0]
        const data = (rows || []).map((r) => num(r[metric]))
        const colors = spec.valueFmt === 'roas' ? data.map((v) => roasColor(v)) : data.map((_, i) => SERIES[i % SERIES.length])
        return <Bar ref={chartRef} data={{ labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, maxBarThickness: type === 'hbar' ? 20 : 40 }] }}
            options={barOpts(type === 'hbar', fmt)} />
    }
    if (type === 'combo') {
        const barKeys = spec.barKeys?.length ? spec.barKeys : (spec.metrics || []).slice(0, 1)
        const lineKey = spec.lineKey || (spec.metrics || [])[1]
        const datasets = [
            ...barKeys.map((k, i) => ({ type: 'bar', label: k, data: (rows || []).map((r) => num(r[k])), backgroundColor: SERIES[i % SERIES.length], borderRadius: 4, yAxisID: 'y', maxBarThickness: 32 })),
            ...(lineKey ? [{ type: 'line', label: lineKey, data: (rows || []).map((r) => num(r[lineKey])), borderColor: SEMANTIC.bad, backgroundColor: 'transparent', tension: 0.35, pointRadius: 3, yAxisID: 'y1' }] : []),
        ]
        return <Bar ref={chartRef} data={{ labels, datasets }} options={comboOpts(fmt, CHAT_CHART_FMT[spec.lineFmt] || CHAT_CHART_FMT.roas)} />
    }
    if (type === 'pie' || type === 'doughnut') {
        // Share/composition of ONE metric across the group dimension. Each row is a
        // slice, colored from the categorical palette.
        const metric = spec.metrics?.[0]
        const data = (rows || []).map((r) => num(r[metric]))
        const colors = data.map((_, i) => SERIES[i % SERIES.length])
        const chartData = { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#fff', borderWidth: 1 }] }
        const Comp = type === 'doughnut' ? Doughnut : Pie
        return <Comp ref={chartRef} data={chartData} options={pieOpts(fmt)} />
    }
    // table / kpi / unknown → compact table
    return <ChatChartTable rows={rows} />
}

export function ChatChartTable({ rows }) {
    const list = Array.isArray(rows) ? rows.slice(0, 12) : []
    if (!list.length) return <div className="py-6 text-center text-xs text-gray-400">No data</div>
    const cols = Array.from(list.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s }, new Set()))
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-400">
                        {cols.map((c) => <th key={c} className="py-1.5 pr-3 font-medium">{c.replace(/_/g, ' ')}</th>)}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {list.map((r, i) => (
                        <tr key={i} className="text-gray-700">
                            {cols.map((c) => <td key={c} className="py-1.5 pr-3 tabular-nums">{r[c] == null ? '' : String(r[c])}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

const lineOpts = (legend, fmt) => ({
    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: legend, position: 'top', align: 'start', labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
    scales: { x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 10 } } }, y: { grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 10 }, callback: fmt } } },
})
const barOpts = (horizontal, fmt) => ({
    indexAxis: horizontal ? 'y' : 'x', responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmt(horizontal ? c.parsed.x : c.parsed.y) } } },
    scales: {
        [horizontal ? 'y' : 'x']: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 10 } } },
        [horizontal ? 'x' : 'y']: { grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 10 }, callback: fmt } },
    },
})
const pieOpts = (fmt) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
        legend: { display: true, position: 'right', labels: { boxWidth: 10, font: { size: 10 }, color: COLORS.slate } },
        tooltip: {
            callbacks: {
                label: (c) => {
                    const total = (c.dataset?.data || []).reduce((s, v) => s + (Number(v) || 0), 0)
                    const val = Number(c.parsed) || 0
                    const pct = total ? ` (${((val / total) * 100).toFixed(1)}%)` : ''
                    return `${c.label}: ${fmt(val)}${pct}`
                },
            },
        },
    },
})
const comboOpts = (barFmt, lineFmt) => ({
    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, font: { size: 10 } } } },
    scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.slate, font: { size: 10 } } },
        y: { position: 'left', grid: { color: COLORS.grid }, beginAtZero: true, ticks: { color: COLORS.slate, font: { size: 10 }, callback: barFmt } },
        y1: { position: 'right', grid: { display: false }, beginAtZero: true, ticks: { color: SEMANTIC.bad, font: { size: 10 }, callback: lineFmt } },
    },
})

export default ChatChart
