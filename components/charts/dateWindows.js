/**
 * dateWindows — date-window helpers for the founder/marketer/RTO dashboards.
 *
 * All windows are { startDate, endDate } in YYYY-MM-DD (inclusive), matching
 * the metrics service's custom-range params. Weeks are Sun–Sat (week starts on
 * Sunday and ends on Saturday).
 */

const iso = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

const addDays = (d, n) => {
    const x = new Date(d)
    x.setDate(x.getDate() + n)
    return x
}

/** Sunday of the week containing `date` (local time). Week starts on Sunday. */
function sundayOf(date) {
    const d = new Date(date)
    const dow = d.getDay() // Sun=0 … Sat=6
    return addDays(d, -dow)
}

/**
 * The last COMPLETE Sun–Sat week (offset=0), or earlier ones (offset=1 → the
 * week before that, …).
 */
export function lastFullWeek(offset = 0, today = new Date()) {
    const thisSunday = sundayOf(today)
    const start = addDays(thisSunday, -7 * (offset + 1))
    return { startDate: iso(start), endDate: iso(addDays(start, 6)) }
}

/** The current (partial) Sun–today window. */
export function thisWeekToDate(today = new Date()) {
    return { startDate: iso(sundayOf(today)), endDate: iso(today) }
}

/** Last N full days ending yesterday (e.g. an 8-week trend window). */
export function lastNDays(n, today = new Date()) {
    const end = addDays(today, -1)
    return { startDate: iso(addDays(end, -(n - 1))), endDate: iso(end) }
}

/**
 * N-day window ending at the given YYYY-MM-DD (inclusive) — trend charts use
 * this to trail the SELECTED window (change the week → the trend follows).
 * Falls back to lastNDays when no end date is given.
 */
export function trailingWindow(n, endDate) {
    if (!endDate) return lastNDays(n)
    const e = new Date(endDate + 'T00:00:00')
    return { startDate: iso(addDays(e, -(n - 1))), endDate }
}

/**
 * The same-length window immediately BEFORE the given one (for WoW/PoP deltas):
 * previousWindow({2026-07-07 → 2026-07-13}) = {2026-06-30 → 2026-07-06}.
 */
export function previousWindow({ startDate, endDate }) {
    if (!startDate || !endDate) return null
    const s = new Date(startDate + 'T00:00:00')
    const e = new Date(endDate + 'T00:00:00')
    const days = Math.round((e - s) / 86400000) + 1
    return { startDate: iso(addDays(s, -days)), endDate: iso(addDays(s, -1)) }
}

/** Split a window into two equal halves (creative-fatigue style comparisons). */
export function splitWindow({ startDate, endDate }) {
    const s = new Date(startDate + 'T00:00:00')
    const e = new Date(endDate + 'T00:00:00')
    const days = Math.round((e - s) / 86400000) + 1
    const firstLen = Math.floor(days / 2)
    const mid = addDays(s, firstLen - 1)
    return [
        { startDate: iso(s), endDate: iso(mid) },
        { startDate: iso(addDays(mid, 1)), endDate: iso(e) },
    ]
}

/** Inclusive day-count of a window ({2026-07-22 → 2026-07-28} = 7). */
export function windowDays({ startDate, endDate } = {}) {
    if (!startDate || !endDate) return 0
    const s = new Date(startDate + 'T00:00:00')
    const e = new Date(endDate + 'T00:00:00')
    return Math.round((e - s) / 86400000) + 1
}

/**
 * Grain for a time-series over a window: short windows (≤ 21 days) bucket DAILY,
 * longer ones WEEKLY — so a per-card 7-day override renders 7 daily points, not a
 * single collapsed weekly bar. Returns the MetricFlow time dimension to group by.
 *   { dim: 'metric_time__day' | 'metric_time__week_sun', daily: boolean }
 */
export function grainFor(window_, dayThreshold = 21) {
    const daily = windowDays(window_) <= dayThreshold
    // Weekly grain is the SUNDAY-aligned custom granularity (metric_time__week_sun),
    // not MetricFlow's Monday-based standard week — weeks run Sunday→Saturday.
    return { dim: daily ? 'metric_time__day' : 'metric_time__week_sun', daily }
}

/**
 * The full calendar month containing `date` as a { startDate, endDate } window
 * (1st → last day). monthWindow(new Date(2026,7,15)) = {2026-08-01 → 2026-08-31}.
 */
export function monthWindow(date = new Date()) {
    const y = date.getFullYear(); const m = date.getMonth()
    return { startDate: iso(new Date(y, m, 1)), endDate: iso(new Date(y, m + 1, 0)) }
}

/**
 * A list of the most recent `count` COMPLETE Sun–Sat weeks, newest first, each
 * { startDate, endDate, label }. Powers the "Weeks" tab of the selector.
 */
export function recentWeeks(count = 8, today = new Date()) {
    const out = []
    for (let i = 0; i < count; i++) {
        const w = lastFullWeek(i, today)
        out.push({ ...w, label: windowLabel(w) })
    }
    return out
}

/**
 * A list of the most recent `count` calendar months, newest first, each
 * { startDate, endDate, label }. Powers the "Months" tab of the selector.
 */
export function recentMonths(count = 6, today = new Date()) {
    const out = []
    for (let i = 0; i < count; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
        const w = monthWindow(d)
        out.push({ ...w, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) })
    }
    return out
}

/** Human label, e.g. "7–13 Jul 2026". */
export function windowLabel({ startDate, endDate } = {}) {
    if (!startDate || !endDate) return ''
    const s = new Date(startDate + 'T00:00:00')
    const e = new Date(endDate + 'T00:00:00')
    const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
    const fmt = (d, m = true, y = true) => d.toLocaleDateString(undefined, {
        day: 'numeric', ...(m ? { month: 'short' } : {}), ...(y ? { year: 'numeric' } : {}),
    })
    return sameMonth ? `${s.getDate()}–${fmt(e)}` : `${fmt(s, true, false)} – ${fmt(e)}`
}
