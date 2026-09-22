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
    critical: { chip: 'bg-red-50 text-red-700 border-red-200', label: 'Critical' },
    watch: { chip: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Warning' },
    opportunity: { chip: 'bg-green-50 text-green-700 border-green-200', label: 'Opportunity' },
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
        <div className="rounded-xl border border-gray-200 bg-white">
            <button onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chipCls}`}>{chip}</span>
                <b className="shrink-0 text-[13.5px] text-gray-900">{title}</b>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-400">{preview}</span>
                {right}
                <span className={`shrink-0 text-gray-300 transition ${open ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {open && <div className="border-t border-gray-100 px-4 py-3">{children}</div>}
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
            <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center gap-2.5 border-b border-gray-100 px-5 py-4">
                    <InboxIcon className="h-4 w-4 text-gray-700" />
                    <h3 className="text-base font-semibold text-gray-900">Inbox</h3>
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-orange-700">AI · Daily</span>
                    {recsWhen && <span className="text-[11.5px] text-gray-400">Generated {fmtWhen(recsWhen) || recsWhen}</span>}
                    <div className="ml-auto flex items-center gap-1">
                        {onRefresh && (
                            <button onClick={onRefresh} disabled={refreshing} title="Regenerate recommendations"
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50">
                                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                            </button>
                        )}
                        <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
                {error && <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-[12px] text-red-600">{error}</div>}

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {/* Needs your approval */}
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                        Needs your approval · {staged.length}
                    </div>
                    <div className="flex flex-col gap-2">
                        {staged.length === 0 && (
                            <div className="rounded-xl border border-gray-200 px-4 py-3 text-[12.5px] text-gray-400">
                                Nothing staged — approvals land here.
                            </div>
                        )}
                        {staged.map((q) => (
                            <Row key={q.id} chip={q.risk} chipCls={RISK[q.risk] || RISK.med}
                                title={q.title} preview={q.impact}
                                right={<span className="shrink-0 text-[11px] text-gray-400">{q.exp}</span>}>
                                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-gray-500">
                                    <span>tool <b className="font-mono text-[11px] text-gray-700">{q.tool}</b></span>
                                    <span>params <b className="text-gray-700">{q.params}</b></span>
                                </div>
                                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-gray-500">
                                    <span>before <b className="text-gray-700">{q.before}</b></span>
                                    <span>projected <b className="text-gray-700">{q.impact}</b></span>
                                    <span>Δ <b className="text-gray-700">{q.delta}</b></span>
                                    <span><b className="text-gray-700">{q.reversible ? 'Reversible' : '⚠ Not reversible'}</b></span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={goApprovals}
                                        className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-1 text-xs font-medium text-white hover:bg-orange-700">
                                        Review &amp; approve <ArrowRight className="h-3 w-3" />
                                    </button>
                                    <span className="text-[11px] text-gray-400">{q.origin}</span>
                                </div>
                            </Row>
                        ))}
                    </div>

                    {/* Recommendations */}
                    <div className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                        Recommendations · {recs.length}
                    </div>
                    <div className="flex flex-col gap-2">
                        {recs.length === 0 && (
                            <div className="rounded-xl border border-gray-200 px-4 py-3 text-[12.5px] text-gray-400">
                                All clear — nothing waiting on you.
                            </div>
                        )}
                        {recs.map((r, i) => {
                            const sev = SEV[r.severity] || SEV.watch
                            const body = r.detail || r.evidence || r.body || r.why || ''
                            return (
                                <Row key={i} chip={sev.label} chipCls={sev.chip}
                                    title={r.title} preview={body}>
                                    <p className="mb-3 text-[12.5px] leading-relaxed text-gray-700">{body}</p>
                                    <div className="flex items-center gap-2">
                                        {canLaunch && (
                                            <button onClick={() => launch(r, i)} disabled={launching !== null}
                                                className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50">
                                                {launching === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                                                Fix with agent
                                            </button>
                                        )}
                                        <button onClick={() => setDismissed((s) => new Set(s).add(i))}
                                            className="rounded-md px-3 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">
                                            Dismiss
                                        </button>
                                    </div>
                                </Row>
                            )
                        })}
                    </div>

                    <p className="mt-4 text-[10.5px] text-gray-400">
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
