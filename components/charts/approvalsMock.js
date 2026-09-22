/**
 * Risk chip styling for staged approvals — shared by the cockpit Inbox modal,
 * the Inbox page, and anywhere else a staged action is rendered.
 *
 * The staged actions themselves are now fetched live (adRules.staged →
 * useInboxCount); the old STAGED_APPROVALS mock array was removed once the real
 * queue was wired in. Only these presentational maps remain.
 */
export const RISK_LABEL = { low: 'Low risk', med: 'Med risk', high: 'High risk' }
export const RISK_CLS = {
    low: 'bg-green-50 text-green-700 border-green-200',
    med: 'bg-amber-50 text-amber-700 border-amber-200',
    high: 'bg-red-50 text-red-700 border-red-200',
}
