/**
 * ColumnFilterPopover — the SINGLE filter control for the shared data tables
 * (replaces the old quick free-text box). A button + dropdown that lets a user
 * stack per-column rules (column + operator + value), ALL AND-ed together.
 * Operators adapt to the column type: numeric columns (money/roas/pct/int/num)
 * offer = ≠ > ≥ < ≤; text columns offer contains / starts with / equals / etc.
 *
 * Edits are BUFFERED in a local draft and only committed to the table on Apply
 * (or Clear all) — so the grid doesn't re-filter on every keystroke and the user
 * sets up a multi-rule filter, then applies it once. `rules`/`setRules` are owned
 * by useTableToolbar and persist per user+card via useCardFilter.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FunnelIcon, PlusIcon, XMarkIcon } from '@heroicons/react/20/solid'
import { opsForColumn, defaultOpForColumn, isNumericColumn, isRuleActive } from './columnFilters'

// Columns worth filtering on — skip ones with no stable key.
const filterableCols = (columns) => (columns || []).filter((c) => c && c.key)

function RuleRow({ rule, columns, onChange, onRemove }) {
    const col = useMemo(() => columns.find((c) => c.key === rule.key) || columns[0], [columns, rule.key])
    const ops = opsForColumn(col)
    const numeric = isNumericColumn(col)

    // When the column changes type, reset the operator to that type's default so a
    // text op never lingers on a numeric column (or vice-versa).
    const onColumn = (key) => {
        const nextCol = columns.find((c) => c.key === key) || columns[0]
        const nextOps = opsForColumn(nextCol)
        const keepOp = nextOps.some((o) => o.value === rule.op) ? rule.op : defaultOpForColumn(nextCol)
        onChange({ ...rule, key, op: keepOp })
    }

    return (
        <div className="flex items-center gap-1.5">
            <select
                value={rule.key}
                onChange={(e) => onColumn(e.target.value)}
                title={col?.header || col?.label || col?.key}
                className="h-8 w-28 shrink-0 truncate rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:border-gray-300 focus:outline-none"
            >
                {columns.map((c) => (
                    <option key={c.key} value={c.key}>{c.header || c.label || c.key}</option>
                ))}
            </select>
            <select
                value={rule.op}
                onChange={(e) => onChange({ ...rule, op: e.target.value })}
                className="h-8 w-24 shrink-0 rounded-lg border border-gray-200 bg-white px-1.5 text-xs text-gray-700 focus:border-gray-300 focus:outline-none"
            >
                {ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
                value={rule.value}
                onChange={(e) => onChange({ ...rule, value: e.target.value })}
                inputMode={numeric ? 'decimal' : 'text'}
                placeholder={numeric ? '0' : 'value…'}
                className="h-8 min-w-0 flex-1 rounded-lg border border-gray-200 px-2 text-xs focus:border-gray-300 focus:outline-none"
            />
            <button
                type="button"
                onClick={onRemove}
                title="Remove filter"
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-600"
            >
                <XMarkIcon className="h-4 w-4" />
            </button>
        </div>
    )
}

export function ColumnFilterPopover({ columns, rules, setRules }) {
    const [open, setOpen] = useState(false)
    // Buffered edits — committed to the table only on Apply. Seeded from the
    // committed rules each time the popover opens (so re-opening shows the applied
    // state, and cancelling by clicking away discards un-applied edits).
    const [draft, setDraft] = useState(rules || [])
    const ref = useRef(null)
    const cols = useMemo(() => filterableCols(columns), [columns])
    const activeCount = useMemo(() => (rules || []).filter(isRuleActive).length, [rules])

    useEffect(() => {
        if (!open) return undefined
        setDraft(rules || [])   // reseed from committed state on open
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    if (!cols.length) return null

    // Draft mutations (local only until Apply).
    const addRule = () => {
        const first = cols[0]
        setDraft([...(draft || []), { key: first.key, op: defaultOpForColumn(first), value: '' }])
    }
    const updateRule = (i, next) => setDraft((draft || []).map((r, idx) => (idx === i ? next : r)))
    const removeRule = (i) => setDraft((draft || []).filter((_, idx) => idx !== i))

    // Commit: drop empty/incomplete rules, push to the table, close.
    const apply = () => {
        setRules((draft || []).filter((r) => r && r.key))
        setOpen(false)
    }
    // Clear applies immediately (empties both draft + committed) and closes.
    const clearAll = () => { setDraft([]); setRules([]); setOpen(false) }

    const active = activeCount > 0
    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                title="Column filters (all must match)"
                className={`flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition ${
                    active
                        ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'
                        : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
            >
                <FunnelIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Filters</span>
                {active && (
                    <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-orange-600 px-1 text-[9px] font-bold text-white">
                        {activeCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 z-40 mt-1 w-[26rem] rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                            Filters — all must match
                        </span>
                        {(draft || []).length > 0 && (
                            <button type="button" onClick={clearAll}
                                className="text-[11px] font-medium text-gray-400 hover:text-gray-600">
                                Clear all
                            </button>
                        )}
                    </div>

                    {(draft || []).length === 0 ? (
                        <p className="px-1 py-2 text-xs text-gray-400">No column filters yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {draft.map((r, i) => (
                                <RuleRow
                                    key={i}
                                    rule={r}
                                    columns={cols}
                                    onChange={(next) => updateRule(i, next)}
                                    onRemove={() => removeRule(i)}
                                />
                            ))}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={addRule}
                        className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 py-1.5 text-xs font-medium text-gray-500 transition hover:border-orange-300 hover:text-orange-700"
                    >
                        <PlusIcon className="h-4 w-4" /> Add filter
                    </button>

                    {/* Apply commits the draft to the table (and persists it). */}
                    <div className="mt-3 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
                        <button type="button" onClick={() => setOpen(false)}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50">
                            Cancel
                        </button>
                        <button type="button" onClick={apply}
                            className="rounded-lg bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-700">
                            Apply
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default ColumnFilterPopover
