/**
 * TableToolbar — the ONE toolbar every data table wears: a filter box (with a
 * contains ⇄ starts-with mode toggle), an optional date-range chip, Refresh,
 * "Ask about this" (AI), Download CSV, and Fullscreen.
 *
 * The chat table (RenderedTableCard) and the Cockpit/Explore tables (DataTableCard,
 * SpecTable) all mount this so they look and behave identically — while each keeps
 * its own cell rendering (heat cells, thumbnails, formatted values).
 *
 * State lives in useTableToolbar(): the FILTER is persisted per user+card via
 * useCardFilter (survives refresh, follows the user across browsers); SORT and the
 * fullscreen flag are ephemeral/client-only (product decision — only the filter is
 * saved). A card without a cardId gets a local-only filter (the chat table).
 *
 * Filtering/sorting are applied by the hook's `applyFilterSort(rows, columns)` so
 * the owning table feeds in whatever row objects it already has.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    MagnifyingGlassIcon, ArrowPathIcon, ChatBubbleLeftRightIcon,
    ArrowDownTrayIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, XMarkIcon,
    ChevronUpIcon, ChevronDownIcon, ChevronUpDownIcon,
} from '@heroicons/react/20/solid'
import { Tooltip2 } from '@/components/pages/Tooltip'
import { useCardFilter } from './useCardFilter'
import { launchChartChat } from './launchChartChat'
import { applyRules, sanitizeRules, isRuleActive } from './columnFilters'
import { ColumnFilterPopover } from './ColumnFilterPopover'

// A column is "numeric" (right-aligned, numeric sort) by fmt OR an explicit align.
export const isNumericCol = (c) =>
    c?.fmt === 'money' || c?.fmt === 'roas' || c?.fmt === 'pct' || c?.fmt === 'int' || c?.fmt === 'num' || c?.align === 'right'

// A column's plain text value for filtering — prefer an explicit accessor.
function cellText(row, col) {
    if (typeof col?.text === 'function') return String(col.text(row) ?? '')
    return String(row?.[col?.key] ?? '')
}

/**
 * useTableToolbar — shared filter+sort+fullscreen state for a table card.
 * @param {object} opts
 * @param {string|null} opts.cardId   stable id → persist the filter (else local).
 * @param {Array}       opts.columns  column defs (need key + optional fmt/align/text).
 * @returns toolbar state + applyFilterSort(rows) + sort helpers.
 */
export function useTableToolbar({ cardId = null, columns = [] }) {
    const { filter, setFilter } = useCardFilter(cardId)
    const [sort, setSort] = useState(null) // { key, dir }
    const [fullscreen, setFullscreen] = useState(false)

    const q = filter.q
    const filterMode = filter.mode || 'contains'

    // startsWith targets the first non-numeric column (the name), which is what a
    // prefix like "DT_" is for.
    const nameCol = useMemo(() => columns.find((c) => !isNumericCol(c)) || columns[0], [columns])

    // Per-column AND rules — the single filter model now (the quick free-text box
    // was removed). Backward compatible + MIGRATING: an old saved blob may still
    // carry a legacy `q`/`mode` from the removed box; fold it into a rule on the
    // name column so it stays VISIBLE and clearable in the new popover (else it
    // would keep filtering with no UI to see or remove it).
    const rules = useMemo(() => {
        const stored = sanitizeRules(filter.rules)
        const legacyQ = String(filter.q || '').trim()
        if (legacyQ && nameCol?.key) {
            return [{ key: nameCol.key, op: filterMode === 'startsWith' ? 'startsWith' : 'contains', value: legacyQ }, ...stored]
        }
        return stored
    }, [filter.rules, filter.q, filterMode, nameCol])

    const setQ = useCallback((next) => setFilter({ ...filter, q: next }), [filter, setFilter])
    const toggleMode = useCallback(
        () => setFilter({ ...filter, mode: filterMode === 'startsWith' ? 'contains' : 'startsWith' }),
        [filter, filterMode, setFilter],
    )
    // Replace the whole rule set (the popover owns add/edit/remove). Persists via
    // useCardFilter. Also CLEARS the legacy `q` — the popover's draft already
    // folded any legacy q into a visible rule (see `rules` above), so keeping q
    // would double-apply it. This makes the old-box → rules migration one-way.
    const setRules = useCallback(
        (next) => setFilter({ ...filter, q: '', rules: sanitizeRules(next) }),
        [filter, setFilter],
    )
    // How many rules are actually narrowing rows (for the toolbar badge).
    const activeRuleCount = useMemo(() => rules.filter(isRuleActive).length, [rules])
    const toggleSort = useCallback((key) => setSort((prev) =>
        prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }), [])

    // Esc closes fullscreen; lock body scroll while open.
    useEffect(() => {
        if (!fullscreen) return undefined
        const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false) }
        document.addEventListener('keydown', onKey)
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
    }, [fullscreen])

    // Apply the current filter + sort to a row array. Filtering is an AND of: the
    // quick free-text box (q) AND every active per-column rule.
    const applyFilterSort = useCallback((rows) => {
        const list = Array.isArray(rows) ? rows : []
        const term = q.trim().toLowerCase()
        let out = list.slice()
        if (term) {
            if (filterMode === 'startsWith') {
                out = out.filter((r) => cellText(r, nameCol).toLowerCase().startsWith(term))
            } else {
                out = out.filter((r) => columns.some((c) => cellText(r, c).toLowerCase().includes(term)))
            }
        }
        // AND the per-column rules on top of the quick filter.
        out = applyRules(out, rules, columns)
        if (sort) {
            const col = columns.find((c) => c.key === sort.key)
            const numeric = col && isNumericCol(col)
            out.sort((a, b) => {
                const av = a[sort.key], bv = b[sort.key]
                const cmp = numeric ? (Number(av) || 0) - (Number(bv) || 0) : String(av ?? '').localeCompare(String(bv ?? ''))
                return sort.dir === 'asc' ? cmp : -cmp
            })
        }
        return out
    }, [q, filterMode, nameCol, columns, sort, rules])

    return { filter, q, filterMode, setQ, toggleMode, nameCol, sort, toggleSort, applyFilterSort, fullscreen, setFullscreen, rules, setRules, activeRuleCount, columns }
}

/**
 * TableToolbar — the header control cluster. Pass it the useTableToolbar() state
 * plus the card's specifics (title, CSV rows/columns, date chip, refresh, ask).
 */
export function TableToolbar({
    title, subtitle,
    tb,                    // the useTableToolbar() object
    dateChip = null,       // an already-built <WindowSelector/> node (or null)
    onRefresh = null, refreshing = false,
    showAsk = false, askContext = null,   // { rows, cardId, workspaceLabel }
    onDownloadCsv = null,
    leadingAction = null,  // an extra control rendered first in the cluster (e.g. Pin)
}) {
    const [asking, setAsking] = useState(false)
    const { fullscreen, setFullscreen, rules, setRules, columns } = tb

    const onAsk = useCallback(async () => {
        if (asking || !askContext) return
        setAsking(true)
        try {
            await launchChartChat(
                { title: title || 'this table', subtitle: subtitle || null, rows: askContext.rows || [], meta: { type: 'table', chartId: askContext.cardId || null } },
                { workspaceLabel: askContext.workspaceLabel || null, mode: 'drawer' },
            )
        } finally { setAsking(false) }
    }, [asking, askContext, title, subtitle])

    return (
        <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
                {title && <h4 className="truncate text-sm font-semibold text-foreground" title={title}>{title}</h4>}
                {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {leadingAction}
                {/* Per-column AND filters (column + operator + value) — the single
                    filter control (replaces the old quick free-text box). Hidden when
                    the table has no columns to filter on. */}
                {setRules && <ColumnFilterPopover columns={columns} rules={rules} setRules={setRules} />}
                {dateChip}
                {onRefresh && (
                    <Tooltip2 description="Refresh this table">
                        <button type="button" onClick={onRefresh} disabled={refreshing}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-50">
                            <ArrowPathIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        </button>
                    </Tooltip2>
                )}
                {showAsk && (
                    <Tooltip2 description="Ask about this table (AI)">
                        <button type="button" onClick={onAsk} disabled={asking}
                            className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">
                            <ChatBubbleLeftRightIcon className="h-4 w-4" />
                            <span className="hidden sm:inline">{asking ? 'Opening…' : 'Ask about this'}</span>
                        </button>
                    </Tooltip2>
                )}
                {onDownloadCsv && (
                    <Tooltip2 description="Download CSV (opens in Excel)">
                        <button type="button" onClick={onDownloadCsv}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted">
                            <ArrowDownTrayIcon className="h-4 w-4" />
                        </button>
                    </Tooltip2>
                )}
                <Tooltip2 description={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
                    <button type="button" onClick={() => setFullscreen((f) => !f)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted">
                        {fullscreen ? <ArrowsPointingInIcon className="h-4 w-4" /> : <ArrowsPointingOutIcon className="h-4 w-4" />}
                    </button>
                </Tooltip2>
                {fullscreen && (
                    <Tooltip2 description="Close">
                        <button type="button" onClick={() => setFullscreen(false)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted">
                            <XMarkIcon className="h-4 w-4" />
                        </button>
                    </Tooltip2>
                )}
            </div>
        </div>
    )
}

/**
 * useCampaignFilter — a compact name filter for a CHART card (not a table): the
 * persisted filter box (via useCardFilter) PLUS a `nameFilter` object to merge
 * into the card's metrics query so the filter runs SERVER-SIDE (fetches ALL
 * matching campaigns, not just the top-N the card would otherwise show).
 *
 * @param {string} cardId  stable id → persists the filter per user+workspace.
 * @param {string} dim     the name dimension to filter on (must be on the backend
 *                         NAME_FILTER_DIMENSIONS allowlist), e.g.
 *                         'campaign_row__campaign_name'.
 * @returns {{ control: ReactNode, nameFilter: object|undefined, active: boolean }}
 *          Spread `control` into ChartCard's `right`; merge `nameFilter` into the
 *          useMetrics body (`{ ...query, ...(nameFilter ? { nameFilter } : {}) }`).
 */
export function useCampaignFilter(cardId, dim) {
    const { filter, setFilter } = useCardFilter(cardId)
    const q = filter.q || ''
    const mode = filter.mode || 'contains'
    const term = q.trim()

    const nameFilter = term ? { dim, mode, value: term } : undefined

    const control = (
        <div className="relative flex items-center">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
                value={q}
                onChange={(e) => setFilter({ ...filter, q: e.target.value })}
                placeholder={mode === 'startsWith' ? 'Starts with… (DT_)' : 'Filter campaigns…'}
                className="h-8 w-40 rounded-l-lg border border-r-0 border-border pl-7 pr-2 text-xs focus:border-border focus:outline-none"
            />
            <Tooltip2 description={mode === 'startsWith' ? 'Matching: name starts with — click for contains' : 'Matching: contains — click for starts-with'}>
                <button
                    type="button"
                    onClick={() => setFilter({ ...filter, mode: mode === 'startsWith' ? 'contains' : 'startsWith' })}
                    className={`flex h-8 w-8 items-center justify-center rounded-r-lg border border-border text-xs font-semibold ${mode === 'startsWith' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                    aria-label="Toggle filter match mode"
                >
                    {mode === 'startsWith' ? '^' : '≈'}
                </button>
            </Tooltip2>
        </div>
    )
    return { control, nameFilter, active: !!term }
}

/** A sortable <th> header row — shared so heat-cell tables sort like the chat one. */
export function SortableHeaders({ columns, sort, toggleSort }) {
    return columns.map((c) => {
        const active = sort?.key === c.key
        const alignRight = isNumericCol(c)
        return (
            <th key={c.key} onClick={() => toggleSort(c.key)}
                className={`cursor-pointer select-none whitespace-nowrap px-4 py-2 text-[11px] font-medium uppercase tracking-wider hover:text-foreground ${alignRight ? 'text-right' : 'text-left'} ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                <span className={`inline-flex items-center gap-1 ${alignRight ? 'flex-row-reverse' : ''}`}>
                    {c.header || c.label}
                    {active
                        ? (sort.dir === 'asc' ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />)
                        : <ChevronUpDownIcon className="h-3 w-3 text-muted-foreground/60" />}
                </span>
            </th>
        )
    })
}
