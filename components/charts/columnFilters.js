/**
 * columnFilters — per-column filter rules for the shared data tables (TableToolbar).
 *
 * A "rule" is { key, op, value } on ONE column; the toolbar AND-s every rule (plus
 * the quick free-text box) so a user can narrow to, say, campaign contains "DT_"
 * AND ROAS < 0.5 AND spend >= 1000. Operators are chosen per column TYPE: numeric
 * columns (money/roas/pct/int/num) get comparison ops, text columns get substring
 * ops. Evaluation is client-side on whatever rows are currently loaded — same as
 * the existing quick filter.
 *
 * The saved filter shape grows from { q, mode } → { q, mode, rules: [] } and stays
 * backward compatible: an old blob with no `rules` behaves exactly as before.
 */

// A column is numeric (comparison ops, right-aligned) by its fmt or explicit align.
// Mirrors isNumericCol in TableToolbar (kept here so this module has no cycle).
export const isNumericColumn = (c) =>
    c?.fmt === 'money' || c?.fmt === 'roas' || c?.fmt === 'pct' ||
    c?.fmt === 'int' || c?.fmt === 'num' || c?.align === 'right'

// Operator catalogs. `label` is what the popover shows; `value` is stored.
export const TEXT_OPS = [
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'startsWith', label: 'starts with' },
    { value: 'equals', label: 'equals' },
    { value: 'not_equals', label: 'not equals' },
]
export const NUMERIC_OPS = [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'gte', label: '≥' },
    { value: 'lt', label: '<' },
    { value: 'lte', label: '≤' },
]
const NUMERIC_OP_SET = new Set(NUMERIC_OPS.map((o) => o.value))
const TEXT_OP_SET = new Set(TEXT_OPS.map((o) => o.value))

/** The operator list a column offers, by its type. */
export const opsForColumn = (col) => (isNumericColumn(col) ? NUMERIC_OPS : TEXT_OPS)

/** The default (first) operator for a column's type. */
export const defaultOpForColumn = (col) => (isNumericColumn(col) ? 'gt' : 'contains')

// A column's plain text value for a row (prefer an explicit accessor). Mirrors
// cellText in TableToolbar.
function cellTextOf(row, col) {
    if (typeof col?.text === 'function') return String(col.text(row) ?? '')
    return String(row?.[col?.key] ?? '')
}

/**
 * Evaluate ONE rule against a row. Unknown column / empty value → passes (an
 * incomplete rule the user is still building shouldn't hide every row). Numeric
 * ops coerce both sides to Number and skip the row when either isn't finite.
 */
export function ruleMatches(rule, row, col) {
    if (!rule || !col) return true
    const raw = rule.value
    if (raw == null || String(raw).trim() === '') return true // incomplete → no-op

    if (NUMERIC_OP_SET.has(rule.op)) {
        const a = Number(row?.[col.key])
        const b = Number(raw)
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false
        switch (rule.op) {
            case 'eq': return a === b
            case 'neq': return a !== b
            case 'gt': return a > b
            case 'gte': return a >= b
            case 'lt': return a < b
            case 'lte': return a <= b
            default: return true
        }
    }

    // Text ops on the displayed cell text (case-insensitive).
    const cell = cellTextOf(row, col).toLowerCase()
    const term = String(raw).toLowerCase()
    switch (rule.op) {
        case 'contains': return cell.includes(term)
        case 'not_contains': return !cell.includes(term)
        case 'startsWith': return cell.startsWith(term)
        case 'equals': return cell === term
        case 'not_equals': return cell !== term
        default: return true
    }
}

/** A rule is "active" (actually narrows rows) when it has a column + a value. */
export const isRuleActive = (r) => !!(r && r.key && r.value != null && String(r.value).trim() !== '')

/**
 * Filter rows by ALL active rules (AND). `columns` supplies each rule's column
 * def (for numeric detection + text accessor). Rows that pass every active rule
 * survive; an empty/all-incomplete rule set returns the rows unchanged.
 */
export function applyRules(rows, rules, columns) {
    const active = (rules || []).filter(isRuleActive)
    if (!active.length) return rows
    const byKey = new Map((columns || []).map((c) => [c.key, c]))
    return rows.filter((row) => active.every((rule) => ruleMatches(rule, row, byKey.get(rule.key))))
}

/**
 * Coerce an arbitrary saved `rules` value into a clean, safe array. Drops rules
 * whose op isn't recognised, caps the count + value length. Mirrors what the
 * backend sanitizer keeps, so the client trusts the same shape it stores.
 */
export function sanitizeRules(input) {
    if (!Array.isArray(input)) return []
    const out = []
    for (const r of input.slice(0, 20)) {
        if (!r || typeof r.key !== 'string' || !r.key) continue
        const op = String(r.op || '')
        if (!NUMERIC_OP_SET.has(op) && !TEXT_OP_SET.has(op)) continue
        out.push({ key: r.key, op, value: String(r.value ?? '').slice(0, 200) })
    }
    return out
}
