/**
 * AgentSpecCard — renders an agent-chat-pinned spec (source: 'agent') on the
 * Cockpit strip, by delegating to the SAME RenderedChartCard / RenderedTableCard
 * the agent chat uses. Those cards already re-run the embedded semantic-layer
 * query against the current workspace and own their own date picker, so a pinned
 * agent visual behaves exactly like every other live Cockpit card.
 *
 * We pass an Unpin control into the card header (the Rendered* cards expose a
 * `headerAction` slot for exactly this — in chat that slot holds the Pin button).
 * Unpinning asks for confirmation first (a chart the user built in chat isn't
 * throwaway), then flips is_pinned false and toasts where to find it again.
 */
import React, { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { PinOff, MessageSquare } from 'lucide-react'
import { RenderedChartCard } from './RenderedChartCard'
import { RenderedTableCard } from './RenderedTableCard'
import { setSavedPinned } from './savedCharts.store'
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
    AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'

export default function AgentSpecCard({ spec, onPinChange }) {
    const [confirmOpen, setConfirmOpen] = useState(false)
    const threadId = spec.thread_id || null   // deep-link to the generating chat
    const label = spec.title || spec.name || (spec.kind === 'table' ? 'this table' : 'this chart')

    // Confirmed unpin = flip is_pinned false (the chart STAYS in the library →
    // Explore "Chat charts", so it can be re-pinned). It is NOT deleted. Toast tells
    // the user where it went + offers a one-click undo.
    const doUnpin = () => {
        setSavedPinned(spec.id, false)
        onPinChange?.(false)
        setConfirmOpen(false)
        toast.success('Removed from Cockpit', {
            description: 'You can find it in Explore → Chat charts and re-pin it anytime.',
            action: { label: 'Undo', onClick: () => { setSavedPinned(spec.id, true); onPinChange?.(true) } },
        })
    }

    const unpinBtn = (
        <div className="flex items-center gap-1.5">
            {threadId && (
                <Link
                    to={`/dashboard/agent-chat?thread=${encodeURIComponent(threadId)}`}
                    title="Open the chat that generated this"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Chat
                </Link>
            )}
            <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                title="Unpin from Cockpit (stays in Explore → Chat charts)"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/20"
            >
                <PinOff className="h-3.5 w-3.5" />
                Pinned
            </button>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove “{label}” from your Cockpit?</AlertDialogTitle>
                        <AlertDialogDescription>
                            It won’t be deleted — it stays in <span className="font-medium text-foreground">Explore → Chat charts</span>,
                            where you can re-pin it to the Cockpit anytime.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={doUnpin}
                            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary"
                        >
                            Remove from Cockpit
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )

    // Pass the pin id as cardId so a table's filter persists per user+workspace
    // (meerkats.card_filters) — a pinned Cockpit card should remember its filter.
    // refreshOnMount: a pinned Cockpit card re-queries its window on load so it never
    // shows stale generation-time seed rows (the chart could have been pinned days ago).
    return spec.kind === 'table'
        ? <RenderedTableCard table={spec.table} headerAction={unpinBtn} cardId={spec.id} refreshOnMount />
        : <RenderedChartCard chart={spec.chart} headerAction={unpinBtn} refreshOnMount />
}
