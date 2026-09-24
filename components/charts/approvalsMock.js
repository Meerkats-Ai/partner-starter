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
    low: 'bg-success/10 text-success border-success/20',
    med: 'bg-warning/10 text-warning border-warning/20',
    high: 'bg-destructive/10 text-destructive border-destructive/20',
}
