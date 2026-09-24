"use client";
/**
 * CockpitPage — the Ad Performance Cockpit: one page, one reconciled data
 * model, three persona tabs (Founder / Growth lead / Media buyer).
 *
 * Replaces the separate Founder + Marketer pages. Tab is kept in the URL
 * (?tab=founder|growth|buyer) so views deep-link; visited tabs stay mounted
 * (hidden) so switching back doesn't re-fetch every query.
 *
 * Sources rail shows the three cockpit sources — Meta Ads, Google Ads,
 * Shopify — with status derived from actual data in the semantic layer
 * (spend rows per platform, order rows for Shopify) rather than a hardcoded ✓.
 *
 * Dual surface like the pages it replaces:
 *   • user (admin=false)  — current workspace (api client injects workspace_id)
 *   • admin (admin=true)  — cross-workspace; paste a workspace_id, blank = all
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Search, Inbox as InboxIcon, Check, ChevronDown, Minus, Plus, ExternalLink, X, MessageSquare } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import FounderDashboard from '@/components/charts/FounderDashboard'
import MarketerDashboard from '@/components/charts/MarketerDashboard'
import MediaBuyerDashboard from '@/components/charts/MediaBuyerDashboard'
import HealthDashboard from '@/components/charts/HealthDashboard'
import InboxModal, { inboxOpenCount } from '@/components/charts/InboxModal'
import PinnedStrip from '@/components/charts/PinnedStrip'
import useInboxCount from '@/hooks/useInboxCount'
import ChartChatDrawer, { CHART_CHAT_STATE_EVENT, CHART_CHAT_CMD_EVENT } from '@/components/charts/ChartChatDrawer'
import { CHART_CHAT_EVENT } from '@/components/charts/launchChartChat'
import cdpApi from '@/lib/cdpApi'
import { useMetrics } from '@/components/charts/useMetrics'
import { lastNDays } from '@/components/charts/dateWindows'
import { useWorkspace } from '@/lib/useWorkspace'
import businessMetricsApi from '@/lib/businessMetrics'
import { AskBar } from '@/components/ai-stubs/AskBar'
import { createThread } from '@/components/ai-stubs/useMessageSubmit'
import CockpitInfoPopover from '@/components/charts/CockpitInfoPopover'

const CHAT_ASSISTANT_ID = 'skill-runner'

const TABS = [
    { id: 'founder', label: 'Founder', q: '"Are we growing profitably, is cash healthy?"' },
    { id: 'growth', label: 'Growth lead', q: '"Where\'s profitable new-customer growth?"' },
    { id: 'buyer', label: 'Media buyer', q: '"Which creative & product do I scale today?"' },
    // Health is not a persona — it's the operational view: are the scheduled
    // agents/automations running cleanly? Rendered by HealthDashboard, which
    // reads live /scheduled-jobs (no metrics window / platform filter).
    { id: 'health', label: 'Health', q: '"Are my scheduled agents running cleanly?"' },
]
const VALID_TABS = TABS.map((t) => t.id)

// Platforms the backend `where` filter whitelists (ad_row__/campaign_row__platform).
// value must match the backend regex exactly (meta|google|flipkart|amazon).
const FILTERABLE_PLATFORMS = [
    { value: 'meta', label: 'Meta' },
    { value: 'google', label: 'Google' },
    { value: 'flipkart', label: 'Flipkart' },
    { value: 'amazon', label: 'Amazon' },
]
// Shown as locked "Connect →" rows (not yet filterable) — matches the mockup.
const LOCKED_PLATFORMS = ['Shopify', 'Zepto', 'Blinkit']
// Remembers the user's last platform pick across visits (auto-select tiebreaker).
const COCKPIT_LAST_PLATFORM_KEY = 'cockpit.lastPlatform'

const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0 }

// Temporary onboarding allowlist — the first-run onboarding flow only auto-triggers
// for these accounts (case-insensitive email) while it's being piloted. Everyone
// else skips straight to the cockpit. Empty the list (or delete the guard at the
// call site) to enable onboarding for all users.
const ONBOARDING_ALLOWED_EMAILS = ['shopify@taplingua.com']
function isOnboardingAllowed() {
    try {
        const u = JSON.parse(localStorage.getItem('mk_user') || 'null')
        const email = (u?.email || '').trim().toLowerCase()
        return !!email && ONBOARDING_ALLOWED_EMAILS.includes(email)
    } catch { return false }
}

export default function CockpitPage({ admin = false, initialTab = 'founder' }) {
    const [wsInput, setWsInput] = useState('')
    const [appliedWs, setAppliedWs] = useState(undefined)
    // Next's useSearchParams is read-only; adapt to the react-router [params, set]
    // shape the ported code expects. setSearchParams(next, {replace}) rewrites the
    // query via the router. `next` may be a URLSearchParams or a plain object.
    const searchParams = useSearchParams()
    const _router = useRouter()
    const _pathname = usePathname()
    const setSearchParams = useCallback((next, _opts) => {
        const sp = next instanceof URLSearchParams ? next : new URLSearchParams(next || {})
        const qs = sp.toString()
        _router.replace(qs ? `${_pathname}?${qs}` : _pathname)
    }, [_router, _pathname])
    const { currentWorkspace } = useWorkspace()

    // "Purity Prayag · D2C food brand" — workspace name + category (admin mode
    // is cross-workspace, so the viewer's own workspace would be misleading).
    const wsLabel = !admin && currentWorkspace
        ? [currentWorkspace.name, currentWorkspace.category].filter(Boolean).join(' · ')
        : null

    // ── Platform filter — single-select, threaded into every dashboard query as
    // the backend's whitelisted ad_row__/campaign_row__platform `where` clause.
    // Hoisted above the persona logic so marketplaces can drop the Media-buyer tab.
    // null = All platforms.
    const [platform, setPlatform] = useState(null)

    // Marketplaces (Flipkart, Amazon) have no "Media buyer" view — no Meta-style
    // creative/adset layer or CDP attribution in the marts. Drop that persona for
    // them and coerce off it if active.
    const isMarketplace = platform === 'flipkart' || platform === 'amazon'
    const rawTab = VALID_TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : initialTab
    const tab = (isMarketplace && rawTab === 'buyer') ? 'founder' : rawTab
    // Keep-alive: mount a tab on first visit, then only hide it — switching
    // back must not re-fire its queries.
    const [visited, setVisited] = useState(() => new Set([tab]))
    if (!visited.has(tab)) setVisited((s) => new Set(s).add(tab))

    // ── Topbar: Inbox modal ─────────────────────────────────────────────────
    const [inboxOpen, setInboxOpen] = useState(false)

    // (platform state hoisted above — meta/google/flipkart/amazon are filterable via
    // the backend whitelist; the rest show as locked "Connect" rows.)
    // Auto-select-once guard (mirrors AgentsPage): pick the connected platform on
    // load so the user lands on data, not an empty "All platforms" default.
    const [autoSelected, setAutoSelected] = useState(false)
    const [platMenuOpen, setPlatMenuOpen] = useState(false)
    const platMenuRef = useRef(null)
    useEffect(() => {
        if (!platMenuOpen) return undefined
        const onDoc = (e) => { if (platMenuRef.current && !platMenuRef.current.contains(e.target)) setPlatMenuOpen(false) }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
    }, [platMenuOpen])

    // ── Cockpit chat (full-page) ─────────────────────────────────────────────
    // Typing in the cockpit bar starts a REAL skill-runner session. The live
    // thread opens FULL-PAGE — the dashboard/graphs collapse and the chat fills
    // the content area beneath the Cockpit topbar (the SAME ChartChatDrawer that
    // "Ask about this chart" uses). We reuse the existing chat handoff —
    // createThread + a pending_submit_<id> stash the chat picks up and auto-runs
    // — then dispatch CHART_CHAT_EVENT so it takes over the content area.
    // (Admin cross-workspace mode has no single workspace to chat in → disabled.)
    const [chatStarting, setChatStarting] = useState(false)
    // Chat visibility, reported up by ChartChatDrawer. The chat renders NO header
    // of its own — the cockpit topbar (below) owns the SINGLE header + its
    // controls (minimize / new / open-in-tab / close).
    //   open      → chat body shown, dashboard collapsed
    //   minimized → chat body hidden, dashboard shown, but the THREAD stays alive
    //   title/threadId → for the topbar label + open-in-tab / resume
    const [chat, setChat] = useState({ open: false, minimized: false, threadId: null, title: null })
    const drawerOpen = chat.open // dashboard is collapsed only when the body is shown
    // Send a command to the chat component (single source of the controls).
    const chatCmd = (action) => window.dispatchEvent(new CustomEvent(CHART_CHAT_CMD_EVENT, { detail: { action } }))
    // Open the active thread on the full /dashboard/chat page in a new tab.
    const openChatInFullPage = () => {
        if (!chat.threadId) return
        const ws = localStorage.getItem('currentWorkspaceId')
        const qp = new URLSearchParams({ thread: chat.threadId })
        if (ws) qp.set('workspaceId', ws)
        window.open(`/dashboard/chat?${qp.toString()}`, '_blank', 'noopener')
    }
    const chatEnabled = !admin

    // Write the open thread to the URL as ?thread (+ tab/ws/we), WITHOUT touching
    // React state — we mutate window.history directly so this write NEVER feeds
    // back into a re-render/effect here (the restore-on-mount read below runs once
    // and must not react to our own writes, or it would re-open/reset the drawer
    // and drop the in-flight run). setSearchParams is intentionally avoided.
    const writeThreadUrl = useCallback((threadId, snap) => {
        const p = new URLSearchParams(window.location.search)
        if (threadId) {
            p.set('thread', threadId)
            if (snap?.persona) p.set('tab', snap.persona)
            if (snap?.window?.startDate && snap?.window?.endDate) {
                p.set('ws', snap.window.startDate)
                p.set('we', snap.window.endDate)
            } else { p.delete('ws'); p.delete('we') }
        } else {
            p.delete('thread'); p.delete('ws'); p.delete('we')
        }
        const qs = p.toString()
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }, [])

    // The active dashboard reports its current window up here (via onWindowChange)
    // so a new chat session can SNAPSHOT it into thread metadata at start.
    const activeWindowRef = useRef(null)
    const onActiveWindowChange = useCallback((w) => { activeWindowRef.current = w }, [])
    // Current persona — kept in a ref so the drawer-state listener can read it
    // without re-subscribing on every tab change.
    const tabRef = useRef(tab)
    tabRef.current = tab

    // Keep the router setter reachable from the (stable) state listener without
    // re-subscribing it on every render.
    const setSearchParamsRef = useRef(setSearchParams)
    setSearchParamsRef.current = setSearchParams
    // Guard for the ?thread restore effect below — declared here so the close
    // handler (in the state listener) can reset it when a chat is closed.
    const lastRoutedThreadRef = useRef(null)

    // Reflect the chat's state up (topbar controls + URL). We keep ?thread in the
    // URL while MINIMIZED too (the thread is still alive), so a refresh restores
    // it; it's cleared only when the chat is truly closed (no thread).
    useEffect(() => {
        const onState = (e) => {
            const d = e.detail || {}
            const activeThread = d.threadId || null
            setChat({ open: !!d.open, minimized: !!d.minimized, threadId: activeThread, title: d.title || null })
            if (activeThread) {
                writeThreadUrl(activeThread, { persona: tabRef.current, window: activeWindowRef.current })
            } else {
                // Chat truly closed. Clear ?thread through REACT-ROUTER (not just
                // history.replaceState) so `searchParams` actually updates — else a
                // stale ?thread would make re-clicking the SAME recent chat look
                // like "no change" and it wouldn't reopen. Also reset the restore
                // guard so that same thread can be routed again.
                lastRoutedThreadRef.current = null
                const p = new URLSearchParams(window.location.search)
                if (p.has('thread')) {
                    p.delete('thread'); p.delete('ws'); p.delete('we')
                    setSearchParamsRef.current(p, { replace: true })
                }
            }
        }
        window.addEventListener(CHART_CHAT_STATE_EVENT, onState)
        return () => window.removeEventListener(CHART_CHAT_STATE_EVENT, onState)
    }, [writeThreadUrl])

    // ── Restore / switch a cockpit chat from the ROUTER ?thread param ────────
    // Two ways a ?thread lands here:
    //   • First mount (refresh / deep-link) — reopen that thread.
    //   • A recent-chats sidebar click WHILE already on the cockpit — react-router
    //     updates ?thread (a real navigation), so we must reopen the newly-picked
    //     thread even though the component doesn't remount.
    // We read from react-router's `searchParams` (NOT window.location) on purpose:
    // OUR OWN url writes go through writeThreadUrl → history.replaceState, which
    // does NOT update `searchParams` — so those self-writes never re-fire this and
    // can't reset the live chat. Only a genuine navigation changes `searchParams`.
    // The ref guard also stops us from re-dispatching for the thread already open.
    const routedThread = searchParams.get('thread')
    useEffect(() => {
        if (routedThread && routedThread !== chat.threadId && routedThread !== lastRoutedThreadRef.current) {
            lastRoutedThreadRef.current = routedThread
            window.dispatchEvent(new CustomEvent(CHART_CHAT_EVENT, { detail: { threadId: routedThread, title: null } }))
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routedThread])

    // Called by the shared AskBar composer with the trimmed message text and the
    // model chosen in the ask-bar's inline picker (may be null = use default).
    const startCockpitChat = async (text, selectedModel) => {
        const q = (text || '').trim()
        if (chatStarting || !q) return
        const workspaceId = localStorage.getItem('currentWorkspaceId')
        if (!workspaceId) return
        setChatStarting(true)
        try {
            // Snapshot persona + the active window so the thread carries its origin.
            const win = activeWindowRef.current || null
            const metadata = {
                workspace_id: workspaceId, assistantId: CHAT_ASSISTANT_ID,
                source: 'cockpit_inline', persona: tab,
                window: win ? { startDate: win.startDate, endDate: win.endDate } : null,
            }
            // Forward the chosen model as the MAIN-agent model. The backend reads
            // subagent_config._main.model (mainModelConfig) and applies it to the
            // promoted analyst; without this the analyst always ran its template
            // default and the picker was cosmetic. Omit the key entirely when no
            // model was picked so the default still applies.
            const configurable = { workspace_id: workspaceId, thread_metadata: metadata }
            if (selectedModel) {
                configurable.subagent_config = { _main: { model: selectedModel } }
            }
            const threadId = await createThread(workspaceId, CHAT_ASSISTANT_ID, metadata)
            if (!threadId) return
            sessionStorage.setItem(`pending_submit_${threadId}`, JSON.stringify({
                messages: [{ id: crypto.randomUUID(), type: 'human', content: q }],
                options: {
                    multitaskStrategy: 'enqueue',
                    config: { configurable },
                    metadata,
                },
                timestamp: Date.now(),
            }))
            // Open the right-side drawer over the (unchanged) dashboard — same
            // slide-over the "Ask about this chart" flow uses. The drawer then
            // broadcasts its open state (with this threadId), and the state
            // listener above writes ?thread into the URL for refresh-persistence.
            window.dispatchEvent(new CustomEvent(CHART_CHAT_EVENT, {
                detail: { threadId, title: null },
            }))
        } finally {
            setChatStarting(false)
        }
    }

    const mOpts = { admin, workspaceId: appliedWs }

    // ── Platform connectivity (last 30 days) — drives the "Connected / no data"
    // state shown per platform inside the filter dropdown (the dropdown replaced
    // the old Sources rail). ─────────────────────────────────────────────────
    const window30 = useMemo(() => lastNDays(30), [])
    const adSrcQ = useMetrics({ metrics: ['total_ad_spend'], groupBy: ['ad_row__platform'], ...window30 }, mOpts)
    // Integration-connected platforms (credential-based). A platform is "connected"
    // if the workspace has an active integration for it (cookie synced / OAuth),
    // even before any metrics data has landed. Merged with the spend probe below.
    const [integrationConnected, setIntegrationConnected] = useState([])
    const navigate = (path, opts) => (opts?.replace ? _router.replace(path) : _router.push(path))
    useEffect(() => {
        let alive = true
        cdpApi.cdp.connectedPlatforms()
            .then(({ data }) => {
                if (!alive) return
                const connected = Array.isArray(data?.connected) ? data.connected : []
                setIntegrationConnected(connected)
                // FIRST-RUN ONBOARDING: a fresh workspace with NOTHING connected lands
                // on the 4-screen onboarding instead of an empty cockpit. Skipped for
                // admins (cross-workspace view) and once the user has completed/dismissed
                // it (cockpitOnboarded flag) so it never loops after they connect.
                //
                // GATED (temporary): only auto-trigger onboarding for the allowlisted
                // pilot account(s) below, so the flow is exercised by that user only
                // while it's being rolled out — everyone else lands straight on the
                // cockpit. Remove the allowlist check to enable onboarding for all.
                if (!admin && connected.length === 0 && isOnboardingAllowed()) {
                    let seen = false
                    try { seen = localStorage.getItem('cockpitOnboarded') === '1' } catch { /* ignore */ }
                    if (!seen) navigate('/dashboard/onboarding', { replace: true })
                }
            })
            .catch(() => {})
        return () => { alive = false }
        // Run ONCE on mount. `navigate` is re-created every render (a plain arrow
        // over _router) — including it here made the effect re-fire on every render
        // → connected-platforms fetched in an infinite loop. `admin` is stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [admin])
    const hasData = (p) => (adSrcQ.rows || []).some((r) => (r.ad_row__platform || '').toLowerCase().includes(p) && num(r.total_ad_spend) > 0)
    // Connected = the integration is linked OR there's spend data for it.
    const platformOn = (p) => integrationConnected.includes(p) || hasData(p)
    // The connected (has-data) filterable platforms — the auto-select + grey-out
    // source of truth, derived from the SAME spend probe the dropdown dots use.
    const connectedPlatforms = useMemo(
        () => FILTERABLE_PLATFORMS.map((p) => p.value).filter(platformOn),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [adSrcQ.rows],
    )

    // Auto-select the platform filter from the workspace's connected integrations,
    // ONCE, and only if the user hasn't chosen one. Mirrors AgentsPage: one
    // connected → pick it; multiple → last interacted (if still connected) else the
    // first; none → stay on "All platforms". So a single-platform (e.g. Flipkart)
    // workspace lands directly on its data instead of an empty "All platforms".
    useEffect(() => {
        if (autoSelected || platform || !connectedPlatforms.length) return
        const last = localStorage.getItem(COCKPIT_LAST_PLATFORM_KEY)
        const pick = (last && connectedPlatforms.includes(last)) ? last : connectedPlatforms[0]
        setAutoSelected(true)
        if (pick) setPlatform(pick)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connectedPlatforms, platform, autoSelected])

    // A manual pick is the "last interacted" signal — remember it + stop auto-select.
    const onPlatformPick = (v) => {
        setAutoSelected(true)
        setPlatform(v)
        setPlatMenuOpen(false)
        if (v) localStorage.setItem(COCKPIT_LAST_PLATFORM_KEY, v)
        else localStorage.removeItem(COCKPIT_LAST_PLATFORM_KEY)
    }

    // ── AI recommendations: one fetch returns all three personas ────────────
    // (generated nightly by the backend cron; Refresh regenerates on demand)
    const [recs, setRecs] = useState(null)
    const [recsLoading, setRecsLoading] = useState(true)
    const [recsRefreshing, setRecsRefreshing] = useState(false)
    const [recsError, setRecsError] = useState(null)
    // Recommendations are per-workspace — the admin "all workspaces" view has
    // no single workspace to recommend for, so the card is hidden there.
    const recsAvailable = !admin || !!appliedWs
    const loadRecs = useCallback(async () => {
        if (admin && !appliedWs) {
            setRecs(null)
            setRecsLoading(false)
            return
        }
        setRecsLoading(true)
        setRecsError(null)
        try {
            const res = admin
                ? await businessMetricsApi.adminGetRecommendations(appliedWs)
                : await businessMetricsApi.metrics.getRecommendations()
            setRecs(res.data?.personas || null)
        } catch (e) {
            setRecsError(e.response?.data?.error || 'Could not load recommendations')
        } finally {
            setRecsLoading(false)
        }
    }, [admin, appliedWs])
    useEffect(() => { loadRecs() }, [loadRecs])
    const refreshRecs = async () => {
        setRecsRefreshing(true)
        setRecsError(null)
        try {
            const res = admin
                ? await businessMetricsApi.adminRefreshRecommendations(appliedWs)
                : await businessMetricsApi.metrics.refreshRecommendations()
            if (res.data?.skipped === 'no_data') {
                setRecsError('Not enough data yet — connect an ad platform or Shopify first.')
            }
            setRecs(res.data?.personas || null)
        } catch (e) {
            setRecsError(e.response?.data?.error || 'Could not generate recommendations')
        } finally {
            setRecsRefreshing(false)
        }
    }

    const dashKey = admin ? `admin:${appliedWs || 'all'}` : 'user'
    const active = TABS.find((t) => t.id === tab) || TABS[0]

    // Recommendations for the active persona → feed the Inbox modal + its badge.
    const activeRecSlice = recs?.[tab] || null
    const activeRecs = activeRecSlice?.recommendations || []
    // Live staged approvals (workspace-scoped) → same feed as the sidebar Inbox
    // badge and the Inbox page. Skipped in admin cross-workspace mode.
    const { staged: stagedApprovals } = useInboxCount({ enabled: !admin })
    const inboxCount = inboxOpenCount(stagedApprovals, activeRecs)

    // Platform filter control — rendered by the ACTIVE dashboard on the same row
    // as its date picker (passed down as `controlsLeft`). The dropdown doubles as
    // the sources list (each platform shows its connected state), so there's no
    // separate Sources rail. null = All platforms.
    const platformControl = (
        <div className="relative inline-block" ref={platMenuRef}>
            <button onClick={() => setPlatMenuOpen((o) => !o)}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-muted-foreground/40">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                {platform ? (FILTERABLE_PLATFORMS.find((p) => p.value === platform)?.label || platform) : 'All platforms'}
                <ChevronDown className="h-4 w-4 text-muted-foreground" strokeWidth={2.5} />
            </button>
            {platMenuOpen && (
                <div className="absolute left-0 z-50 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-popover py-1.5 shadow-lg">
                    <button onClick={() => onPlatformPick(null)}
                        className={`flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-muted ${!platform ? 'bg-primary/10 font-semibold text-primary' : 'text-foreground'}`}>
                        All platforms
                        {!platform && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
                    </button>
                    <div className="my-1 h-px bg-border" />
                    {/* Connected platforms are selectable; unconnected (no data) ones are
                        greyed + disabled — like the greyed agent rows on the Agents screen. */}
                    {FILTERABLE_PLATFORMS.map((p) => {
                        const connected = platformOn(p.value)
                        return (
                            <button key={p.value} disabled={!connected}
                                onClick={() => connected && onPlatformPick(p.value)}
                                title={connected ? undefined : 'Not connected — sync this integration to enable it'}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                                    !connected ? 'cursor-not-allowed opacity-50'
                                    : platform === p.value ? 'bg-primary/10 font-semibold text-primary hover:bg-primary/10'
                                    : 'text-foreground hover:bg-muted'}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-success' : 'bg-muted-foreground/30'}`} aria-hidden="true" />
                                {p.label}
                                {platform === p.value
                                    ? <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                                    : <span className={`ml-auto text-[10px] ${connected ? 'text-muted-foreground/70' : 'text-muted-foreground/60'}`}>{connected ? 'Connected' : 'no data'}</span>}
                            </button>
                        )
                    })}
                    <div className="my-1 h-px bg-border" />
                    {/* These platforms aren't metrics-filterable yet, but if the
                        workspace has CONNECTED the integration (cookie synced /
                        OAuth) we show it as connected instead of a locked "Connect". */}
                    {LOCKED_PLATFORMS.map((n) => {
                        const slug = n.toLowerCase()
                        const connected = integrationConnected.includes(slug)
                        return (
                            <div key={n} className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${connected ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}
                                title={connected ? 'Connected — metrics not filterable yet' : 'Not connected'}>
                                <span aria-hidden="true">{connected ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" /> : '🔒'}</span>
                                {n}
                                <span className="ml-auto text-[10px]">{connected ? 'Connected' : 'Connect'}</span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )

    return (
        <div className="flex min-h-full flex-col bg-background">
            {/* SINGLE topbar — the chat has NO header of its own; when its body is
                open this same bar becomes the chat header (title + controls). When
                the chat is minimized we keep the normal cockpit topbar and add a
                "Resume chat" pill so the live thread can be reopened. */}
            <div className="sticky top-0 z-30 flex flex-none items-center gap-2.5 border-b border-border bg-card px-6 py-3">
                {chat.open ? (
                    <>
                        {/* Chat header mode — the title replaces "Cockpit"; controls
                            (minimize / new / open-in-tab / close) live on the right. */}
                        <span className="text-primary">✦</span>
                        <h1 className="min-w-0 truncate text-[19px] font-semibold tracking-tight text-foreground">
                            {chat.title || 'Chat'}
                        </h1>
                        <div className="ml-auto flex items-center gap-0.5">
                            <button onClick={() => chatCmd('minimize')} title="Minimize — keep this chat"
                                className="rounded-lg p-1.5 text-muted-foreground/70 transition hover:bg-muted hover:text-foreground">
                                <Minus className="h-4 w-4" />
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-1">
                            <h1 className="text-[19px] font-semibold tracking-tight text-foreground">Cockpit</h1>
                            {/* ⓘ — sync status (CONNECTED platforms only) + glossary of the short forms. */}
                            <CockpitInfoPopover connectedPlatforms={integrationConnected} />
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            {/* Resume the still-alive (minimized) chat. Outer is a
                                clickable div (not a button) so the inner close-X can
                                be a real nested button without invalid HTML. */}
                            {chat.minimized && (
                                <div role="button" tabIndex={0}
                                    onClick={() => chatCmd('resume')}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') chatCmd('resume') }}
                                    title="Resume chat"
                                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/20">
                                    <MessageSquare className="h-4 w-4" />
                                    <span className="max-w-[160px] truncate">{chat.title || 'Resume chat'}</span>
                                    <button onClick={(e) => { e.stopPropagation(); chatCmd('close') }}
                                        title="Close chat" className="-mr-1 ml-0.5 rounded p-0.5 hover:bg-primary/20">
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            )}
                            {/* Inbox — fixes & recommendations (badge = open count) */}
                            {recsAvailable && (
                                <button onClick={() => setInboxOpen(true)}
                                    title="Inbox — fixes & recommendations"
                                    className="relative inline-flex items-center rounded-lg border border-border p-2 text-muted-foreground transition hover:border-muted-foreground/40 hover:text-foreground">
                                    <InboxIcon className="h-4 w-4" />
                                    {inboxCount > 0 && (
                                        <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                                            {inboxCount}
                                        </span>
                                    )}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Full-page chat — when a cockpit chat / "Ask about this chart" is open,
                the dashboard content collapses and the live thread fills the area
                beneath the topbar (the topbar above stays). Rendered in-flow so it
                sits below the topbar and beside the app sidebar. */}
            <ChartChatDrawer />

            {/* Scrollable content area (off-white) — HIDDEN while the full-page chat
                is open so the chat owns the whole content region. */}
            <div className={`mx-auto w-full max-w-[1120px] flex-1 px-4 sm:px-6 lg:px-8 pt-5 pb-6 ${drawerOpen ? 'hidden' : ''}`}>
            {admin && (
                <div className="mb-4 flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[280px]">
                        <label className="text-xs text-muted-foreground">Filter by workspace ID (optional — blank = all)</label>
                        <Input
                            value={wsInput}
                            onChange={(e) => setWsInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && setAppliedWs(wsInput.trim() || undefined)}
                            placeholder="all workspaces — paste a UUID to filter"
                            className="font-mono text-xs mt-1"
                        />
                    </div>
                    <Button onClick={() => setAppliedWs(wsInput.trim() || undefined)}>
                        <Search className="h-4 w-4" />
                        <span className="ml-1">{wsInput.trim() ? 'Filter' : 'Reload'}</span>
                    </Button>
                </div>
            )}

            {/* Pinned charts — user-curated cards from the Explore page, live against
                this workspace + the active platform filter. Renders nothing until
                something is pinned. Hidden on the Health (operational) tab. */}
            {tab !== 'health' && (
                <PinnedStrip admin={admin} workspaceId={appliedWs} platform={platform} />
            )}

            {/* Tab panels — visited tabs stay mounted, hidden when inactive. The
                dashboard/graphs are never collapsed: starting a chat opens the
                right-side drawer OVER them. Only the ACTIVE persona reports its
                window up (onWindowChange) so a new thread can snapshot it. */}
            <div>
                {visited.has('founder') && (
                    <div className={tab === 'founder' ? '' : 'hidden'}>
                        <FounderDashboard
                            key={`f:${dashKey}`}
                            admin={admin} workspaceId={appliedWs} platform={platform}
                            controlsLeft={tab === 'founder' ? platformControl : null}
                            onWindowChange={tab === 'founder' ? onActiveWindowChange : undefined} />
                    </div>
                )}
                {visited.has('growth') && (
                    <div className={tab === 'growth' ? '' : 'hidden'}>
                        <MarketerDashboard
                            key={`g:${dashKey}`}
                            admin={admin} workspaceId={appliedWs} platform={platform}
                            controlsLeft={tab === 'growth' ? platformControl : null}
                            onWindowChange={tab === 'growth' ? onActiveWindowChange : undefined} />
                    </div>
                )}
                {visited.has('buyer') && (
                    <div className={tab === 'buyer' ? '' : 'hidden'}>
                        <MediaBuyerDashboard
                            key={`b:${dashKey}`}
                            admin={admin} workspaceId={appliedWs} platform={platform}
                            controlsLeft={tab === 'buyer' ? platformControl : null}
                            onWindowChange={tab === 'buyer' ? onActiveWindowChange : undefined} />
                    </div>
                )}
                {visited.has('health') && (
                    <div className={tab === 'health' ? '' : 'hidden'}>
                        {/* Scheduled-run health — LIVE: the agents the user enabled in this
                            workspace (GET /insight-scheduler/health), each with its FRAME
                            steps + run history. Workspace-scoped (api client injects
                            workspace_id); the ALBY demo workspace gets a synthesized fleet. */}
                        <HealthDashboard key={`h:${dashKey}`} />
                    </div>
                )}
            </div>

            {/* Start-a-session bar — available over the dashboard, but HIDDEN while
                the chat drawer is open (the drawer owns the active composer then).
                Uses the shared AskBar pill — the SAME composer as the full
                /dashboard/chat route and the drawer, so the input looks & behaves
                identically everywhere. Sending creates the thread + opens the drawer. */}
            {chatEnabled && !drawerOpen && (
                <div className="sticky bottom-4 z-20 mx-auto mt-8 max-w-3xl">
                    <AskBar onSend={startCockpitChat} isProcessing={chatStarting} />
                </div>
            )}

            </div>{/* /content area */}

            {/* Inbox modal — AI fixes & recommendations for the active persona */}
            <InboxModal
                open={inboxOpen}
                onClose={() => setInboxOpen(false)}
                staged={stagedApprovals}
                recommendations={activeRecs}
                recsWhen={activeRecSlice?.generated_at}
                persona={tab}
                workspaceLabel={wsLabel}
                onRefresh={refreshRecs}
                refreshing={recsRefreshing}
                error={recsError}
                // Launching a chat targets the CURRENT workspace — in admin
                // cross-workspace mode that would hit the wrong tenant.
                canLaunch={!admin}
            />
        </div>
    )
}
