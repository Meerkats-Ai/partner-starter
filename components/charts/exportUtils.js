/**
 * exportUtils — download helpers for the in-chat chart/table cards.
 *   • downloadRowsCsv  — rows[] → CSV file (opens directly in Excel/Sheets).
 *   • downloadChartPng — a chart.js instance → PNG file (white background).
 *
 * CSV uses papaparse + file-saver (both already project deps). We ship CSV rather
 * than a native .xlsx to avoid adding an xlsx dependency — Excel opens CSV natively.
 */
import Papa from 'papaparse'
import { saveAs } from 'file-saver'

// Filesystem-safe slug from a title, for the download filename.
export function slugify(name, fallback = 'export') {
    const s = String(name || '').trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
    return s || fallback
}

/**
 * Download rows[] as CSV. `columns` (optional) is [{ key, label }] — controls
 * column order + headers; omit to derive from the row keys. Raw values are written
 * (numbers unformatted) so the file is analysis-ready in Excel.
 */
export function downloadRowsCsv(rows, columns, filename = 'table.csv') {
    const list = Array.isArray(rows) ? rows : []
    let fields
    let data
    if (Array.isArray(columns) && columns.length) {
        fields = columns.map((c) => c.label || c.key)
        data = list.map((r) => columns.map((c) => normalizeCell(r[c.key])))
    } else {
        const keys = Array.from(list.reduce((s, r) => { Object.keys(r || {}).forEach((k) => s.add(k)); return s }, new Set()))
        fields = keys
        data = list.map((r) => keys.map((k) => normalizeCell(r[k])))
    }
    const csv = Papa.unparse({ fields, data })
    // Prepend a BOM so Excel reads UTF-8 (₹ and names) correctly.
    saveAs(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), filename)
}

// null/undefined → '', objects → JSON, everything else as-is (numbers stay numeric).
function normalizeCell(v) {
    if (v == null) return ''
    if (typeof v === 'object') return JSON.stringify(v)
    return v
}

/**
 * Download a chart.js instance as a PNG. chart.js canvases are transparent, so we
 * composite onto white first (a transparent PNG looks broken on a dark viewer).
 */
export function downloadChartPng(chart, filename = 'chart.png') {
    if (!chart || typeof chart.toBase64Image !== 'function') return
    const src = chart.toBase64Image('image/png', 1)
    const canvas = chart.canvas
    const w = canvas?.width || 1200
    const h = canvas?.height || 600
    const img = new Image()
    img.onload = () => {
        const out = document.createElement('canvas')
        out.width = w
        out.height = h
        const ctx = out.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        out.toBlob((blob) => { if (blob) saveAs(blob, filename) }, 'image/png')
    }
    img.src = src
}
