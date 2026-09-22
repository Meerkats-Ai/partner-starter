"use client";
/**
 * useInboxCount — the single live source of truth for "how many items are
 * waiting in the Inbox".
 *
 * The Inbox count is shown in three disconnected places (the sidebar badge, the
 * cockpit's Inbox-bell badge, the Automation page's "Go to Inbox" link). Before
 * this hook each faked its own number (a hardcoded "3 STAGED", a mock array),
 * so approving an item on the Inbox page never updated the others. This hook
 * fetches the real pending staged actions once and lets every consumer share it.
 *
 *   const { stagedCount, staged, loading, refresh } = useInboxCount()
 *
 * Consumers that CHANGE the queue (approve / reject on the Inbox page) call
 * `notifyStagedChanged()` after the mutation; every mounted useInboxCount then
 * refetches, so the sidebar/cockpit badges stay in sync without prop-drilling.
 */
import { useCallback, useEffect, useState } from 'react'
import adRules from '@/lib/adRules'

// Fired by whoever mutates the staged queue (approve/reject). Same window-event
// pattern the sidebar already uses for THREAD_CREATED_EVENT.
export const STAGED_CHANGED_EVENT = 'meerkats:staged-changed'

/** Broadcast that the staged queue changed so every useInboxCount refetches. */
export function notifyStagedChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(STAGED_CHANGED_EVENT))
  }
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true] - skip fetching when false (e.g. logged out)
 */
export default function useInboxCount({ enabled = true } = {}) {
  const [staged, setStaged] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!enabled) { setStaged([]); setLoading(false); return }
    setLoading(true)
    try {
      const { data } = await adRules.staged('pending')
      setStaged(Array.isArray(data?.items) ? data.items : [])
    } catch {
      // Non-fatal: a badge should never break the page. Show nothing on error.
      setStaged([])
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => { refresh() }, [refresh])

  // Refetch when the queue is mutated anywhere, or the workspace switches.
  useEffect(() => {
    const onChange = () => refresh()
    window.addEventListener(STAGED_CHANGED_EVENT, onChange)
    window.addEventListener('workspaceChanged', onChange)
    return () => {
      window.removeEventListener(STAGED_CHANGED_EVENT, onChange)
      window.removeEventListener('workspaceChanged', onChange)
    }
  }, [refresh])

  return { staged, stagedCount: staged.length, loading, refresh }
}
