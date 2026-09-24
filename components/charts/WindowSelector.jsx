/**
 * WindowSelector — the shared date-range control for every Cockpit persona
 * (Founder / Growth lead / Media buyer). One component so all three dashboards
 * get the SAME, easy-to-find custom date picker instead of each rolling its own
 * (previously only Founder had a custom range, and it was a bare pair of inputs).
 *
 * Presets stay per-dashboard (they legitimately differ — Founder uses 4-week
 * windows, the ads views use 14-day), but "Custom" is appended here for ALL of
 * them, and selecting it reveals a prominent FROM/TO range with an Apply button.
 *
 * Pair it with the useWindow() hook below, which owns the win / custom-date state
 * and resolves the final { startDate, endDate } window the metrics queries consume.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDaysIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { lastFullWeek, thisWeekToDate, lastNDays, windowLabel } from './dateWindows'

const iso = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

// The "Custom" preset is universal — appended after each dashboard's own presets.
export const CUSTOM_WINDOW = { value: 'custom', label: 'Custom range' }

/**
 * useWindow — owns the selected preset + custom dates and resolves the concrete
 * { startDate, endDate }. `resolvePreset(win)` maps a dashboard's OWN preset
 * values (e.g. 'last_14_days', 'last_4_weeks') to a window; anything it doesn't
 * handle falls back to lastFullWeek(). 'custom' is handled here.
 *
 * Returns everything the selector + the dashboard need:
 *   win, setWin, custom {from,to}, applyCustom, window_, weekly, isCustom
 */
export function useWindow(resolvePreset, initial = 'last_week', initialWindow = null, onWindowChange = null) {
    // Restoring a saved session: start in Custom pinned to the exact saved dates.
    // Exact dates (not a preset key) so restore works across personas whose
    // preset lists differ. Otherwise start on the given preset.
    const restoring = !!(initialWindow && initialWindow.startDate && initialWindow.endDate)
    const [win, setWin] = useState(restoring ? 'custom' : initial)
    // Draft values the user is typing (from/to). Only applied on Apply, so the
    // dashboard doesn't re-query on every keystroke / half-entered range.
    const [draftFrom, setDraftFrom] = useState(restoring ? initialWindow.startDate : '')
    const [draftTo, setDraftTo] = useState(restoring ? initialWindow.endDate : '')
    const [applied, setApplied] = useState(restoring ? { ...initialWindow } : null) // { startDate, endDate } once applied

    const window_ = useMemo(() => {
        if (win === 'custom') return applied || lastFullWeek()
        return resolvePreset(win) || lastFullWeek()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [win, applied])

    const weekly = win === 'last_week' || win === 'this_week'

    // Report the resolved window up (so the cockpit can snapshot it into a chat
    // session's metadata). Fires whenever the effective window changes.
    useEffect(() => {
        if (typeof onWindowChange === 'function') onWindowChange(window_)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [window_.startDate, window_.endDate])

    // Switching to Custom: seed the draft from the current window so the user
    // starts from what they were already looking at (not empty inputs).
    const selectCustom = () => {
        if (win !== 'custom') {
            const cur = resolvePreset(win) || lastFullWeek()
            setDraftFrom((prev) => prev || cur.startDate)
            setDraftTo((prev) => prev || cur.endDate)
            if (!applied) setApplied(cur)
        }
        setWin('custom')
    }

    // Apply a custom range. Normally reads the typed draft (from/to), but callers
    // can pass an explicit { startDate, endDate } (a picked week/month) so it
    // applies THIS tick instead of waiting for the async draft state to settle.
    const applyCustom = (explicit) => {
        const from = explicit?.startDate ?? draftFrom
        const to = explicit?.endDate ?? draftTo
        if (from && to && from <= to) {
            setApplied({ startDate: from, endDate: to })
        }
    }

    return {
        win, setWin, selectCustom,
        draftFrom, setDraftFrom, draftTo, setDraftTo, applyCustom,
        applied, window_, weekly, isCustom: win === 'custom',
        // Expose the preset resolver so the selector can show a preset's dates on
        // the calendar (resolvePreset lives here, not in the selector).
        resolvePreset,
    }
}

/**
 * WindowSelector — the pill row + custom range editor. Drive it from useWindow().
 *
 * Props:
 *   presets    — the dashboard's own [{ value, label }] (Custom is appended).
 *   ctrl       — the object returned by useWindow().
 *   suffix     — the small caption after the window label (e.g. "Meta + Google · …").
 *   quickDays  — optional [7, 14, 30] shortcut chips inside the custom editor.
 */
// ── Calendar helpers (Sunday-first, local time, YYYY-MM-DD) ─────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']  // Sunday-first (matches the design)
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

// A month grid (Sunday-first): leading blanks then day cells, each with its iso
// date. Blanks are represented as null.
function monthGrid(viewDate) {
    const y = viewDate.getFullYear(); const m = viewDate.getMonth()
    const lead = new Date(y, m, 1).getDay() // Sun=0 … Sat=6
    const days = new Date(y, m + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < lead; i++) cells.push(null)
    for (let d = 1; d <= days; d++) cells.push(iso(new Date(y, m, d)))
    return cells
}

// Trigger-label like "Custom : 07-Aug-26 - 13-Aug-26".
function triggerLabel(window_) {
    const fmt = (isoStr) => {
        const d = new Date(isoStr + 'T00:00:00')
        const dd = String(d.getDate()).padStart(2, '0')
        return `${dd}-${MONTHS[d.getMonth()].slice(0, 3)}-${String(d.getFullYear()).slice(-2)}`
    }
    if (!window_?.startDate || !window_?.endDate) return 'Select dates'
    return `${fmt(window_.startDate)} - ${fmt(window_.endDate)}`
}

// ── Shared picker pieces (used by BOTH the dashboard WindowSelector and the
// per-chart CardWindowControl, so the two pickers are literally the same UI) ──

/**
 * useFixedAnchor — positions a `position: fixed` popover under a trigger and
 * clamps it into the viewport (flips above if no room below). Fixed positioning
 * escapes the sidebar / overflow-x-auto containers that were clipping the panel.
 * Returns the { top, left } style (null until measured — gate rendering on it).
 */
function useFixedAnchor(open, triggerRef, panelRef) {
    const [pos, setPos] = useState(null)
    useEffect(() => {
        if (!open) { setPos(null); return undefined }
        const place = () => {
            const t = triggerRef.current?.getBoundingClientRect()
            if (!t) return
            const GAP = 6, MARGIN = 8
            const vw = window.innerWidth, vh = window.innerHeight
            // Measure the REAL panel (falls back to a sane default on the very first
            // frame before it has laid out). Using the real size is what guarantees
            // the clamp keeps every edge inside the viewport regardless of variant.
            const pr = panelRef.current?.getBoundingClientRect()
            const panelW = Math.min(pr?.width || 620, vw - 2 * MARGIN)
            const panelH = Math.min(pr?.height || 400, vh - 2 * MARGIN)

            // Horizontal: right-align to the trigger, then clamp so both the right
            // and left edges keep MARGIN from the viewport.
            let left = t.right - panelW
            left = Math.min(left, vw - panelW - MARGIN)  // keep MARGIN on the right
            left = Math.max(MARGIN, left)                // keep MARGIN on the left

            // Vertical: below the trigger by default; flip above if it would cross
            // the bottom margin; then clamp both top and bottom to MARGIN so it can
            // never be cut off at the top or bottom edge either.
            let top = t.bottom + GAP
            if (top + panelH > vh - MARGIN) {
                const above = t.top - GAP - panelH
                top = above >= MARGIN ? above : (vh - MARGIN - panelH)
            }
            top = Math.max(MARGIN, top)

            setPos({ top, left, maxHeight: vh - 2 * MARGIN, maxWidth: vw - 2 * MARGIN })
        }
        place()
        // Re-place once the panel has actually measured (its size differs by variant).
        const raf = requestAnimationFrame(place)
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return () => {
            cancelAnimationFrame(raf)
            window.removeEventListener('resize', place)
            window.removeEventListener('scroll', place, true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])
    return pos
}

// Close-on-outside-click / Escape. `boxRef` must wrap the trigger; the fixed panel
// is a DOM descendant of it, so contains() covers both.
function useDismiss(open, boxRef, onClose) {
    useEffect(() => {
        if (!open) return undefined
        const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onClose() }
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
    }, [open])
}

/**
 * RangeCalendarPanel — the ONE date-range panel shared by both pickers. An
 * optional preset rail on the left + two side-by-side month calendars with a
 * highlighted range + a footer (custom left slot, range label, primary button).
 *
 * Props:
 *   from, to            — current draft range (iso strings)
 *   onPickDay(iso)      — click a day
 *   view, onPrev, onNext — the left month + month-step handlers
 *   presets             — optional [{ id, label, win, active }] for the left rail
 *   activeCustom        — whether the "Custom" rail row is highlighted
 *   footerLeft          — node shown at the far left of the footer (e.g. quick chips / Reset)
 *   primaryLabel        — the confirm button text ("Done" / "Apply")
 *   onPrimary           — confirm handler
 *   primaryDisabled     — disable the confirm button
 */
function RangeCalendarPanel({
    from, to, onPickDay, view, onPrev, onNext,
    presets = null, activeCustom = false, headerLeft = null,
    footerLeft = null, primaryLabel, onPrimary, primaryDisabled = false,
}) {
    const inRange = (d) => from && to && d > from && d < to
    const isEdge = (d) => d === from || d === to

    const MonthCal = ({ base }) => {
        const cells = monthGrid(base)
        return (
            <div className="w-[212px] p-2">
                <div className="mb-2 flex items-center justify-center gap-1.5 text-[13px] font-medium text-foreground">
                    <span className="rounded-md bg-muted px-2.5 py-1">{MONTHS[base.getMonth()]}</span>
                    <span className="rounded-md bg-muted px-2.5 py-1">{base.getFullYear()}</span>
                </div>
                <div className="grid grid-cols-7 text-center text-[10px] font-medium text-muted-foreground/70">
                    {DOW.map((d, i) => <span key={i} className="py-1">{d}</span>)}
                </div>
                <div className="grid grid-cols-7 text-center">
                    {cells.map((d, i) => d == null ? <span key={i} className="h-8" /> : (
                        <button key={d} onClick={() => onPickDay(d)}
                            className={`relative mx-auto grid h-8 w-8 place-items-center text-[12px] tabular-nums transition ${
                                isEdge(d) ? 'rounded-md bg-primary font-semibold text-primary-foreground'
                                : inRange(d) ? 'bg-primary/10 text-foreground'
                                : 'rounded-md text-foreground hover:bg-muted'}`}>
                            {Number(d.slice(-2))}
                        </button>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <>
            {headerLeft}
            <div className="flex">
                {/* Preset rail (optional) */}
                {presets && (
                    <div className="flex w-36 shrink-0 flex-col border-r border-border py-2">
                        {presets.map((p) => (
                            <button key={p.id} onClick={p.onClick}
                                className={`px-4 py-2 text-left text-sm transition ${
                                    p.active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-muted'}`}>
                                {p.label}
                            </button>
                        ))}
                        <button
                            className={`px-4 py-2 text-left text-sm transition ${
                                activeCustom ? 'font-medium text-primary' : 'text-primary hover:bg-muted'}`}>
                            Custom
                        </button>
                    </div>
                )}

                {/* Dual-month calendar + footer */}
                <div className="shrink-0">
                    <div className="flex items-start">
                        <button onClick={onPrev}
                            className="mt-4 ml-2 grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted">‹</button>
                        <MonthCal base={view} />
                        <MonthCal base={addMonths(view, 1)} />
                        <button onClick={onNext}
                            className="mt-4 mr-2 grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted">›</button>
                    </div>
                    <div className="flex items-center gap-2 border-t border-border px-4 py-3">
                        {footerLeft}
                        <span className="text-[11px] text-muted-foreground/70">
                            {from && to ? windowLabel({ startDate: from, endDate: to }) : ''}
                        </span>
                        <span className="flex-1" />
                        <button onClick={onPrimary} disabled={primaryDisabled}
                            className="rounded-md bg-primary px-6 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
                            {primaryLabel}
                        </button>
                    </div>
                </div>
            </div>
        </>
    )
}

/**
 * WindowSelector — a trigger button that opens a range picker: a preset rail
 * (Today / Yesterday / This Week / Last Week / This Month / Last Month / Custom)
 * beside TWO side-by-side month calendars with a highlighted range, and a Done
 * button. Drive it from useWindow(); its `applyCustom` / `setWin` API is unchanged.
 */
export default function WindowSelector({ presets, ctrl, suffix = '' }) {
    const { setWin, draftFrom, setDraftFrom, draftTo, setDraftTo, applyCustom, window_, isCustom } = ctrl
    const [open, setOpen] = useState(false)
    // Left calendar month; the right calendar is always the following month.
    const [view, setView] = useState(() => new Date((window_.startDate || iso(new Date())) + 'T00:00:00'))
    const boxRef = useRef(null)
    const triggerRef = useRef(null)
    const panelRef = useRef(null)
    const pos = useFixedAnchor(open, triggerRef, panelRef)
    useDismiss(open, boxRef, () => setOpen(false))

    // Universal presets (Sunday-first weeks match the calendar). Each resolves to a
    // { startDate, endDate }. today is captured once per open so it's stable.
    const PRESETS = useMemo(() => {
        const today = startOfDay()
        const yest = new Date(today); yest.setDate(yest.getDate() - 1)
        return [
            { id: 'today', label: 'Today', win: { startDate: iso(today), endDate: iso(today) } },
            { id: 'yesterday', label: 'Yesterday', win: { startDate: iso(yest), endDate: iso(yest) } },
            { id: 'this_week', label: 'This Week', win: thisWeekToDate(today) },
            { id: 'last_week', label: 'Last Week', win: lastFullWeek(0, today) },
            { id: 'this_month', label: 'This Month', win: { startDate: iso(new Date(today.getFullYear(), today.getMonth(), 1)), endDate: iso(today) } },
            { id: 'last_month', label: 'Last Month', win: lastMonthWindow(today) },
        ]
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Opening: seed the pending range from the current window + focus its month.
    const openPop = () => {
        setDraftFrom(window_.startDate)
        setDraftTo(window_.endDate)
        setView(new Date((window_.startDate || iso(new Date())) + 'T00:00:00'))
        setOpen(true)
    }

    // Apply a preset immediately (updates the draft + the applied window, closes).
    const applyPreset = (w) => {
        setWin('custom')
        setDraftFrom(w.startDate); setDraftTo(w.endDate)
        applyCustom(w)
        setView(new Date(w.startDate + 'T00:00:00'))
        setOpen(false)
    }

    // Click days across the two calendars: first click starts a range, second
    // sets the end (auto-ordered so clicking an earlier day extends backwards).
    const pickDay = (isoDay) => {
        if (!draftFrom || (draftFrom && draftTo && draftFrom !== draftTo)) {
            setDraftFrom(isoDay); setDraftTo(isoDay)
        } else if (isoDay < draftFrom) {
            setDraftTo(draftFrom); setDraftFrom(isoDay)
        } else {
            setDraftTo(isoDay)
        }
        if (!isCustom) setWin('custom')
    }
    const done = () => { applyCustom(); setOpen(false) }

    // Which preset (if any) matches the current applied window → highlight its row.
    const activePresetId = PRESETS.find((p) => p.win.startDate === window_.startDate && p.win.endDate === window_.endDate)?.id
    const isCustomActive = !activePresetId

    return (
        <div className="relative inline-block text-xs" ref={boxRef}>
            <button ref={triggerRef} onClick={() => (open ? setOpen(false) : openPop())}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-muted-foreground/40">
                <CalendarDaysIcon className="h-4 w-4 text-muted-foreground" />
                {isCustomActive ? 'Custom : ' : ''}{triggerLabel(window_)}
                <span className="text-[11px] text-muted-foreground/70">▾</span>
            </button>

            {open && (
                // Rendered while open so it can be measured; kept invisible (not
                // unmounted) until `pos` is computed so it never flashes at 0,0.
                <div ref={panelRef} style={pos ? { ...pos, overflow: 'auto' } : { top: 0, left: 0, visibility: 'hidden', pointerEvents: 'none' }}
                    className="fixed z-50 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                    <RangeCalendarPanel
                        from={draftFrom} to={draftTo} onPickDay={pickDay}
                        view={view} onPrev={() => setView((v) => addMonths(v, -1))} onNext={() => setView((v) => addMonths(v, 1))}
                        presets={PRESETS.map((p) => ({ id: p.id, label: p.label, active: activePresetId === p.id, onClick: () => applyPreset(p.win) }))}
                        activeCustom={isCustomActive}
                        footerLeft={suffix ? <span className="text-[11px] text-muted-foreground/70">{suffix}</span> : null}
                        primaryLabel="Done" onPrimary={done}
                    />
                </div>
            )}
        </div>
    )
}

// The full previous calendar month as a { startDate, endDate } window.
function lastMonthWindow(today = new Date()) {
    const y = today.getFullYear(); const m = today.getMonth()
    return { startDate: iso(new Date(y, m - 1, 1)), endDate: iso(new Date(y, m, 0)) }
}

// Small helper so dashboards can resolve their own extra presets tersely.
export const presetResolvers = {
    this_week: () => thisWeekToDate(),
    last_week: () => lastFullWeek(),
    last_14_days: () => lastNDays(14),
    last_4_weeks: () => lastNDays(28),
}

// =============================================================================
// Per-card window override — each chart card can pick its OWN date range without
// re-fetching the rest of the dashboard. This is what stops the metrics service
// 502: instead of one dashboard-level date change re-keying ~8 queries at once,
// the user narrows a single card and only that card's query re-fires. (The
// businessMetrics client also gates total in-flight metric queries as a backstop.)
//
// A card starts by FOLLOWING the dashboard default. The moment the user picks a
// range on the card it becomes "overridden" and stops following — until they hit
// "Reset to dashboard", which re-syncs it to the default and resumes following.
// =============================================================================

/**
 * useCardWindow — owns one chart card's optional window override.
 *
 * @param defaultWindow  the dashboard-level { startDate, endDate } the card
 *                       follows until the user overrides it.
 * Returns { window_, overridden, ...editor state } — pass the whole object to
 * <CardWindowControl ctrl={...} /> and feed `window_` to the card's query.
 */
export function useCardWindow(defaultWindow) {
    // null → follow the dashboard default. An object → this card is overridden.
    const [override, setOverride] = useState(null)
    const [draftFrom, setDraftFrom] = useState('')
    const [draftTo, setDraftTo] = useState('')

    const window_ = override || defaultWindow

    const openEditor = () => {
        // Seed the draft from whatever the card is currently showing.
        setDraftFrom(window_.startDate)
        setDraftTo(window_.endDate)
    }
    const apply = () => {
        if (draftFrom && draftTo && draftFrom <= draftTo) {
            setOverride({ startDate: draftFrom, endDate: draftTo })
            return true
        }
        return false
    }
    // Apply an explicit range THIS tick (a rail preset) without waiting for the
    // async draft state to settle — mirrors useWindow.applyCustom(explicit).
    const applyExplicit = (w) => {
        if (w?.startDate && w?.endDate && w.startDate <= w.endDate) {
            setOverride({ startDate: w.startDate, endDate: w.endDate })
            return true
        }
        return false
    }
    const reset = () => setOverride(null)
    const setQuick = (n) => {
        const w = lastNDays(n)
        setDraftFrom(w.startDate)
        setDraftTo(w.endDate)
    }

    return {
        window_, overridden: override != null,
        draftFrom, setDraftFrom, draftTo, setDraftTo,
        openEditor, apply, applyExplicit, reset, setQuick,
    }
}

/**
 * CardRefreshButton — re-runs a single card's query. The metrics service 502s
 * under bursts, so a failed card can be retried on its own (no full-dashboard
 * reload, no date change needed). Pass the useMetrics() `refetch` + `loading`.
 * Spins while the query is in flight and is disabled so it can't be double-fired.
 */
export function CardRefreshButton({ onRefresh, loading, title = 'Refresh this chart' }) {
    if (!onRefresh) return null
    return (
        <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            title={title}
            aria-label={title}
            className="inline-flex shrink-0 items-center rounded-lg border border-border p-1 text-muted-foreground transition hover:border-muted-foreground/40 hover:text-foreground disabled:opacity-50"
        >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
    )
}

/**
 * CardControls — the standard ChartCard header cluster: an optional per-card
 * refresh button + the date-range chip, grouped so each card passes ONE node to
 * ChartCard's `right`. Give it the card's useMetrics() query (for refetch +
 * loading) and its useCardWindow() ctrl.
 */
export function CardControls({ query, winCtrl, quickDays }) {
    return (
        <>
            {query && <CardRefreshButton onRefresh={query.refetch} loading={query.loading} />}
            {winCtrl && <CardWindowControl ctrl={winCtrl} quickDays={quickDays} />}
        </>
    )
}

/**
 * CardWindowControl — the small calendar chip that sits in a ChartCard header
 * (pass it as ChartCard's `right` prop). Collapsed it shows the card's current
 * range; clicking opens a compact FROM/TO editor with quick-day chips + Apply.
 */
export function CardWindowControl({ ctrl, quickDays = [7, 14, 30] }) {
    const { window_, overridden, draftFrom, setDraftFrom, draftTo, setDraftTo, openEditor, apply, reset, setQuick, applyExplicit } = ctrl
    const [open, setOpen] = useState(false)
    // Left calendar month; the right calendar is the following month (dual-month,
    // same layout as the dashboard WindowSelector so both pickers are identical).
    const [view, setView] = useState(() => new Date((window_.startDate || iso(new Date())) + 'T00:00:00'))
    const boxRef = useRef(null)
    const triggerRef = useRef(null)
    const panelRef = useRef(null)
    const pos = useFixedAnchor(open, triggerRef, panelRef)
    useDismiss(open, boxRef, () => setOpen(false))

    // Same universal presets as the dashboard picker (see WindowSelector).
    const PRESETS = useMemo(() => {
        const today = startOfDay()
        const yest = new Date(today); yest.setDate(yest.getDate() - 1)
        return [
            { id: 'today', label: 'Today', win: { startDate: iso(today), endDate: iso(today) } },
            { id: 'yesterday', label: 'Yesterday', win: { startDate: iso(yest), endDate: iso(yest) } },
            { id: 'this_week', label: 'This Week', win: thisWeekToDate(today) },
            { id: 'last_week', label: 'Last Week', win: lastFullWeek(0, today) },
            { id: 'this_month', label: 'This Month', win: { startDate: iso(new Date(today.getFullYear(), today.getMonth(), 1)), endDate: iso(today) } },
            { id: 'last_month', label: 'Last Month', win: lastMonthWindow(today) },
        ]
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const toggle = () => {
        if (!open) {
            openEditor()
            setView(new Date((window_.startDate || iso(new Date())) + 'T00:00:00'))
        }
        setOpen((o) => !o)
    }
    const invalid = draftFrom && draftTo && draftFrom > draftTo

    // Click days to build a range (first click starts, second click ends; earlier
    // click extends backwards) — identical interaction to the dashboard calendar.
    const pickDay = (isoDay) => {
        if (!draftFrom || (draftFrom && draftTo && draftFrom !== draftTo)) {
            setDraftFrom(isoDay); setDraftTo(isoDay)
        } else if (isoDay < draftFrom) {
            setDraftTo(draftFrom); setDraftFrom(isoDay)
        } else {
            setDraftTo(isoDay)
        }
    }

    // A rail preset applies immediately (like the dashboard's Done-less presets).
    const applyPreset = (w) => {
        setDraftFrom(w.startDate); setDraftTo(w.endDate)
        applyExplicit(w)
        setView(new Date(w.startDate + 'T00:00:00'))
        setOpen(false)
    }
    // Which preset (if any) matches the currently-applied card window.
    const activePresetId = PRESETS.find((p) => p.win.startDate === window_.startDate && p.win.endDate === window_.endDate)?.id

    return (
        <div ref={boxRef} className="relative">
            <button
                ref={triggerRef}
                type="button"
                onClick={toggle}
                title={overridden ? 'Custom range for this chart — click to change' : 'This chart follows the dashboard range — click to set its own'}
                className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                    overridden
                        ? 'border-primary/40 bg-primary/10 text-primary hover:border-primary/60'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                }`}
            >
                <CalendarDaysIcon className="h-3.5 w-3.5" />
                {overridden ? windowLabel(window_) : 'Date'}
            </button>

            {open && (
                <div ref={panelRef} style={pos ? { ...pos, overflow: 'auto' } : { top: 0, left: 0, visibility: 'hidden', pointerEvents: 'none' }}
                    className="fixed z-50 overflow-hidden rounded-xl border border-border bg-card text-xs shadow-xl">
                    <RangeCalendarPanel
                        from={draftFrom} to={draftTo} onPickDay={pickDay}
                        view={view} onPrev={() => setView((v) => addMonths(v, -1))} onNext={() => setView((v) => addMonths(v, 1))}
                        presets={PRESETS.map((p) => ({ id: p.id, label: p.label, active: activePresetId === p.id, onClick: () => applyPreset(p.win) }))}
                        activeCustom={!activePresetId}
                        headerLeft={
                            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                                <span className="font-semibold uppercase tracking-wider text-muted-foreground/70">Range for this chart</span>
                                {overridden && (
                                    <button onClick={() => { reset(); setOpen(false) }}
                                        className="text-[11px] font-medium text-muted-foreground/70 hover:text-foreground">
                                        Reset to dashboard
                                    </button>
                                )}
                            </div>
                        }
                        footerLeft={
                            <>
                                {quickDays?.length > 0 && (
                                    <div className="flex items-center gap-1 text-muted-foreground/70">
                                        <span className="text-[11px]">Last</span>
                                        {quickDays.map((n) => (
                                            <button key={n} onClick={() => setQuick(n)}
                                                className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted/70">
                                                {n}d
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {invalid && <span className="text-[11px] text-destructive">From ≤ To</span>}
                            </>
                        }
                        primaryLabel="Apply" primaryDisabled={invalid}
                        onPrimary={() => { if (apply()) setOpen(false) }}
                    />
                </div>
            )}
        </div>
    )
}

export { iso }
