/**
 * InboxModal — the cockpit's top-right "Inbox" overlay.
 *
 * Replaces the inline RecommendationsCard: the AI "what to do next" feed now
 * lives behind a bell/inbox button in the page topbar (badge = open count) and
 * opens as a modal, matching the product mockup. Two sections:
 *
 *   • Needs your approval — agent-proposed WRITE actions staged for sign-off
 *     (pause creative, shift budget, …). Each expands to show tool + params +
 *     before-state + projected impact, with a "Review & approve →" hop to the
 *     My Queue approvals page.
 *   • Recommendations — the nightly ads_insights_analyst suggestions (the same
 *     data the RecommendationsCard showed), each with "Fix with agent →"
 *     (launches a chat), "Explain", and "Dismiss".
 *
 * DATA: both are REAL — recommendations and the staged approvals are passed in
 * from CockpitPage (which fetches the live queue via useInboxCount). The count
 * here matches the sidebar Inbox badge and the Inbox page exactly.
 */
import React, { useMemo, useState } from 'react'
import { useNavigate } from '@/lib/useNavigate'
import { X, Inbox as InboxIcon, ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import { launchRecommendationChat } from './launchRecommendationChat'
import { RISK_CLS } from './approvalsMock'

const RISK = RISK_CLS
const SEV = {
    critical: { chip: 'bg-destructive/10 text-destructive border-destructive/20', label: 'Critical' },
    watch: { chip: 'bg-warning/10 text-warning border-warning/20', label: 'Warning' },
    opportunity: { chip: 'bg-success/10 text-success border-success/20', label: 'Opportunity' },
}

const fmtWhen = (iso) => {
    if (!iso) return null
    const d = new Date(iso)
    if (isNaN(d)) return null
    return d.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

/** One expandable row (shared shell for approvals + recommendations). */
function Row({ chip, chipCls, title, preview, right, children }) {
    const [open, setOpen] = useState(false)
    return (
        <div className="rounded-xl border border-border bg-card">
            <button onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chipCls}`}>{chip}</span>
                <b className="shrink-0 text-[13.5px] text-foreground">{title}</b>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</span>
                {right}
                <span className={`shrink-0 text-muted-foreground/60 transition ${open ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {open && <div className="border-t border-border px-4 py-3">{children}</div>}
        </div>
    )
}

export default function InboxModal({ open, onClose, staged = [], recommendations = [], recsWhen, persona, workspaceLabel, canLaunch = true, onRefresh, refreshing, error }) {
    const navigate = useNavigate()
    const [dismissed, setDismissed] = useState(() => new Set())
    const [launching, setLaunching] = useState(null)

    const recs = useMemo(
        () => recommendations.filter((_, i) => !dismissed.has(i)),
        [recommendations, dismissed],
    )

    const goApprovals = () => { onClose?.(); navigate('/dashboard/queue') }

    const launch = async (rec, key) => {
        if (launching !== null) return
        setLaunching(key)
        try {
            await launchRecommendationChat(rec, { persona, workspaceLabel, navigate })
            onClose?.()
        } finally {
            setLaunching(null)
        }
    }

    if (!open) return null
    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[6vh]"
            onClick={onClose}>
            <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
                onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
                    <InboxIcon className="h-4 w-4 text-foreground" />
                    <h3 className="text-base font-semibold text-foreground">Inbox</h3>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-primary">AI · Daily</span>
                    {recsWhen && <span className="text-[11.5px] text-muted-foreground">Generated {fmtWhen(recsWhen) || recsWhen}</span>}
                    <div className="ml-auto flex items-center gap-1">
                        {onRefresh && (
                            <button onClick={onRefresh} disabled={refreshing} title="Regenerate recommendations"
                                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
                                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                            </button>
                        )}
                        <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
                {error && <div className="border-b border-destructive/20 bg-destructive/10 px-5 py-2 text-[12px] text-destructive">{error}</div>}

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {/* Needs your approval */}
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Needs your approval · {staged.length}
                    </div>
                    <div className="flex flex-col gap-2">
                        {staged.length === 0 && (
                            <div className="rounded-xl border border-border px-4 py-3 text-[12.5px] text-muted-foreground">
                                Nothing staged — approvals land here.
                            </div>
                        )}
                        {staged.map((q) => (
                            <Row key={q.id} chip={q.risk} chipCls={RISK[q.risk] || RISK.med}
                                title={q.title} preview={q.impact}
                                right={<span className="shrink-0 text-[11px] text-muted-foreground">{q.exp}</span>}>
                                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
                                    <span>tool <b className="font-mono text-[11px] text-foreground">{q.tool}</b></span>
                                    <span>params <b className="text-foreground">{q.params}</b></span>
                                </div>
                                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
                                    <span>before <b className="text-foreground">{q.before}</b></span>
                                    <span>projected <b className="text-foreground">{q.impact}</b></span>
                                    <span>Δ <b className="text-foreground">{q.delta}</b></span>
                                    <span><b className="text-foreground">{q.reversible ? 'Reversible' : '⚠ Not reversible'}</b></span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={goApprovals}
                                        className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                                        Review &amp; approve <ArrowRight className="h-3 w-3" />
                                    </button>
                                    <span className="text-[11px] text-muted-foreground">{q.origin}</span>
                                </div>
                            </Row>
                        ))}
                    </div>

                    {/* Recommendations */}
                    <div className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Recommendations · {recs.length}
                    </div>
                    <div className="flex flex-col gap-2">
                        {recs.length === 0 && (
                            <div className="rounded-xl border border-border px-4 py-3 text-[12.5px] text-muted-foreground">
                                All clear — nothing waiting on you.
                            </div>
                        )}
                        {recs.map((r, i) => {
                            const sev = SEV[r.severity] || SEV.watch
                            const body = r.detail || r.evidence || r.body || r.why || ''
                            return (
                                <Row key={i} chip={sev.label} chipCls={sev.chip}
                                    title={r.title} preview={body}>
                                    <p className="mb-3 text-[12.5px] leading-relaxed text-foreground">{body}</p>
                                    <div className="flex items-center gap-2">
                                        {canLaunch && (
                                            <button onClick={() => launch(r, i)} disabled={launching !== null}
                                                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                                                {launching === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                                                Fix with agent
                                            </button>
                                        )}
                                        <button onClick={() => setDismissed((s) => new Set(s).add(i))}
                                            className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted">
                                            Dismiss
                                        </button>
                                    </div>
                                </Row>
                            )
                        })}
                    </div>

                    <p className="mt-4 text-[10.5px] text-muted-foreground">
                        Same feed as the Cockpit — regenerated daily, or on demand.
                    </p>
                </div>
            </div>
        </div>
    )
}

/** Count of open inbox items (staged approvals + recs) for the bell badge. */
export function inboxOpenCount(staged = [], recommendations = []) {
    return (staged?.length || 0) + (recommendations?.length || 0)
}
