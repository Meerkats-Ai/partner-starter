/**
 * HealthDashboard — the Cockpit "Health" view: at-a-glance health of the
 * scheduled agents / automations that run the Meerkats Insight Catalog.
 *
 * ── DATA SOURCE (MOCK) ───────────────────────────────────────────────────────
 * Right now this renders from `healthCatalog.mock.js` — the 85-insight catalog
 * (Cross-Platform / Meta / Google / Blinkit & Zepto / Flipkart / Amazon), each
 * row carrying its full agent pipeline: Detect → Diagnose → Recommend →
 * Simulate → Act → Learn. Runtime health (status, sparkline, last/next run,
 * per-run outputs) is synthesized deterministically in the mock.
 *
 * When the backend + agent layer are made compatible, the ONLY thing that
 * changes here is the marked "MOCK SEAM" in load(): replace getHealthTasks()
 * with the live /scheduled-jobs fetch (which already exists in api/scheduledJobs
 * .js) and map its rows into the same task shape. Everything below stays.
 *
 * Layout mirrors the agent-task-monitor mockup: a health summary bar + legend,
 * platform + cadence filters, one row per task (run-history sparkline, last-run
 * date, name, platform, cadence, pause/resume), and an expandable panel showing
 * the agent pipeline + the last 3 runs.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@/lib/useNavigate'
import { ChevronDown, Pause, Play, Loader2, RefreshCw, AlertTriangle, Check, Plug } from 'lucide-react'
import {
    HEALTH_PLATFORMS,
    PLATFORM_LABEL,
    CADENCE_LABEL,
    CADENCE_ORDER,
    CADENCE_ROLE,
} from './healthCatalog.mock'
import systemAgents from '@/lib/systemAgents'
const Streamdown = ({ children }) => <div className="whitespace-pre-wrap">{children}</div>
import RunDetailDrawer from '@/components/pages/RunDetailDrawer'
import '@/components/pages/campaign-mockup.css'

// Tailwind colour sets per health status (bar / sparkline / dot / pill / text).
const HEALTH = {
    ok: { bar: 'bg-success', left: 'border-l-success', dot: 'bg-success', pill: 'bg-success/10 text-success', text: 'text-success' },
    warn: { bar: 'bg-warning', left: 'border-l-warning', dot: 'bg-warning', pill: 'bg-warning/10 text-warning', text: 'text-warning' },
    critical: { bar: 'bg-destructive', left: 'border-l-destructive', dot: 'bg-destructive', pill: 'bg-destructive/10 text-destructive', text: 'text-destructive' },
    paused: { bar: 'bg-muted-foreground/30', left: 'border-l-muted-foreground/30', dot: 'bg-muted-foreground/30', pill: 'bg-muted text-muted-foreground', text: 'text-muted-foreground' },
    running: { bar: 'bg-info', left: 'border-l-info', dot: 'bg-info', pill: 'bg-info/10 text-info', text: 'text-info' },
}
// run status → health token (for run rows + sparkline bars)
const runToken = (s) => (s === 'error' ? 'critical' : s === 'success' ? 'ok' : 'running')

// Cadence filter options — MUST match the cadence KEYS the backend derives
// (insight-scheduler-user.controller `cadenceOf`: once/hourly/hourly_working/
// weekdays/weekly/monthly/daily) AND the labels the edit-agent dropdown shows
// (SmallAgentForm CADENCES). The old list was only daily/weekly/monthly, so an
// agent scheduled hourly / weekdays / once could never be selected here.
const CADENCE_FILTER_OPTIONS = [
    { v: 'all', t: 'All cadences' },
    { v: 'every_5m', t: 'Every 5 minutes' },
    { v: 'hourly', t: 'Every hour' },
    { v: 'hourly_working', t: 'Every hour (working hours)' },
    { v: 'hourly_day', t: 'Every hour (8am–11pm)' },
    { v: 'daily', t: 'Every day at 10am' },
    { v: 'weekdays', t: 'Every weekday at 10am' },
    { v: 'weekly', t: 'Every Monday at 10am' },
    { v: 'monthly', t: 'Monthly (1st at 10am)' },
    { v: 'once', t: 'Once' },
]
// Short one-word label for the cadence shown on each task ROW (all 7 backend keys,
// so hourly/weekdays/once don't render blank). Falls back to a prettified key.
const CADENCE_SHORT = {
    every_5m: 'Every 5 min', hourly: 'Hourly', hourly_working: 'Hourly (work hrs)', hourly_day: 'Hourly (8am–11pm)', daily: 'Daily',
    weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly', once: 'Once', other: 'Custom',
}
const cadenceShort = (key) =>
    CADENCE_SHORT[key] || (key ? String(key).replace(/_/g, ' ') : '—')

// FRAME — the fixed five-step analysis process every agent walks IN ORDER.
// F Friction · R Root Cause · A Action · M Measurable Benefit · E Execute/Escalate.
const FRAME = [
    { key: 'f', letter: 'F', label: 'Friction', q: "what's wrong?" },
    { key: 'r', letter: 'R', label: 'Root Cause', q: 'why?' },
    { key: 'a', letter: 'A', label: 'Action', q: 'what to do?' },
    { key: 'm', letter: 'M', label: 'Measurable Benefit', q: "what's it worth?" },
    { key: 'e', letter: 'E', label: 'Execute / Escalate', q: 'do it, or ask?' },
]

const fmtWhen = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso); if (isNaN(d)) return '—'
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const fmtDay = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso); if (isNaN(d)) return '—'
    const n = new Date()
    if (d.toDateString() === n.toDateString()) return 'Today'
    if (d.toDateString() === new Date(n.getTime() - 864e5).toDateString()) return 'Yesterday'
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
const fmtDur = (s) => (s == null ? null : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`)

// Sparkline — one bar per recent run (oldest → newest, left → right).
function Sparkline({ history, paused }) {
    if (!history?.length) return <span className="inline-flex h-3.5 w-[38px]" aria-hidden="true" />
    return (
        <span className="inline-flex h-3.5 items-end gap-[2px]" aria-hidden="true">
            {history.map((h, i) => {
                const tok = paused ? 'paused' : runToken(h)
                const cls = tok === 'ok' ? 'h-3.5' : tok === 'critical' ? 'h-1.5' : tok === 'warn' ? 'h-2.5' : 'h-2'
                return <span key={i} className={`w-1 rounded-sm ${HEALTH[tok].bar} ${cls} ${paused ? 'opacity-50' : ''}`} />
            })}
        </span>
    )
}

// A run's status → a 0..1 "health score" for the weekly trend line.
const runScore = (s) => (s === 'error' ? 0.12 : s === 'no_action' ? 0.6 : s === 'success' ? 1 : 0.4)
// Stroke colour of the trend line = health of its final (newest) point.
const trendStroke = {
    ok: 'hsl(var(--success))', warn: 'hsl(var(--warning))', critical: 'hsl(var(--destructive))',
    paused: 'hsl(var(--muted-foreground))', running: 'hsl(var(--info))',
}

// TrendLine — the WEEKLY view's run-history graph (matches the mockup): a small
// SVG polyline of the last N runs' health scores, tinted by current health, with
// an emphasized endpoint dot. Falls back to the bar Sparkline when <2 points.
function TrendLine({ history, health, paused, w = 46, h = 16 }) {
    const pts = (history || []).map(runScore)
    if (pts.length < 2) return <Sparkline history={history} paused={paused} />
    const stroke = paused ? trendStroke.paused : (trendStroke[health] || trendStroke.ok)
    const pad = 2
    const innerW = w - pad * 2
    const innerH = h - pad * 2
    const stepX = innerW / (pts.length - 1)
    const xy = pts.map((v, i) => [pad + i * stepX, pad + (1 - v) * innerH])
    const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    const [ex, ey] = xy[xy.length - 1]
    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={paused ? 'opacity-50' : ''} aria-hidden="true">
            <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={ex} cy={ey} r="2" fill={stroke} />
        </svg>
    )
}

// Shared with the Agents page — remember the user's last platform pick.
const LAST_PLATFORM_KEY = 'agents:lastPlatform'

export default function HealthDashboard({ source = 'health' }) {
    // source: 'health' = only ENABLED (scheduled) agents; 'run-history' = every
    // agent that has run in this workspace (enabled OR just tested).
    const isRunHistory = source === 'run-history'
    const navigate = useNavigate()
    const [tasks, setTasks] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [isDemo, setIsDemo] = useState(false)
    const [platform, setPlatform] = useState('all')
    const [cadence, setCadence] = useState('all')
    // Run-history only: 'all' | 'real' (scheduled + queue re-runs, shown as "Prod")
    // | 'test' (beaker / drawer "Test run"). Defaults to 'all' so the run history
    // shows every run (prod + test) unless the user narrows it.
    const [runType, setRunType] = useState('all')
    const [expanded, setExpanded] = useState(null)
    const [connectedPlatforms, setConnectedPlatforms] = useState([])
    const [autoSelected, setAutoSelected] = useState(false)
    const [runDetail, setRunDetail] = useState(null) // run object when the full-trace drawer is open

    // LIVE source: only the agents the user ENABLED in this workspace (each with a
    // schedule). Enabling an agent on /dashboard/agents makes it appear here.
    // workspace_id is auto-injected by the api client.
    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const { data } = isRunHistory
                ? await systemAgents.runHistory(runType !== 'all' ? { runType } : {})
                : await systemAgents.health()
            const all = (data?.tasks || []).slice()
            all.sort((a, b) => (CADENCE_ORDER[a.cadence] - CADENCE_ORDER[b.cadence]) || a.insight.localeCompare(b.insight))
            setTasks(all)
            setIsDemo(!!data?.demo)
            if (Array.isArray(data?.connectedPlatforms)) setConnectedPlatforms(data.connectedPlatforms)
        } catch (e) {
            setError(e?.response?.data?.error || e?.message || 'Failed to load run history')
            setTasks([])
        } finally {
            setLoading(false)
        }
    }, [isRunHistory, runType])
    useEffect(() => { load() }, [load])

    // Auto-select the platform filter from the workspace's connected integrations,
    // ONCE, and only while still on "All platforms". One connected → pick it;
    // multiple → the last one the user interacted with (if still connected), else
    // the first. No connections → stay on "All platforms".
    useEffect(() => {
        if (autoSelected || platform !== 'all' || !connectedPlatforms.length) return
        const last = localStorage.getItem(LAST_PLATFORM_KEY)
        const pick = (last && connectedPlatforms.includes(last)) ? last : connectedPlatforms[0]
        setAutoSelected(true)
        if (pick) setPlatform(pick)
    }, [connectedPlatforms, platform, autoSelected])

    // A manual platform change is the "last interacted" signal — remember it and
    // stop any further auto-selection.
    const onPlatformChange = (v) => {
        setAutoSelected(true)
        setPlatform(v)
        if (v && v !== 'all') localStorage.setItem(LAST_PLATFORM_KEY, v)
        else localStorage.removeItem(LAST_PLATFORM_KEY)
    }

    // platform value → whether the workspace has it connected (all/cross always true).
    const isPlatformConnected = useCallback((p) => {
        if (p === 'all' || p === 'cross' || p === 'demo') return true
        return connectedPlatforms.includes(p)
    }, [connectedPlatforms])

    // Pause/resume optimistically, then persist (disable = pause here since the
    // user surface has enable/disable, not a granular pause). Reverts on failure.
    const togglePause = async (task) => {
        const willPause = task.status !== 'paused'
        setTasks((ts) => ts.map((t) => {
            if (t.id !== task.id) return t
            return { ...t, status: willPause ? 'paused' : 'active', health: willPause ? 'paused' : (t._prevHealth || 'ok'), _prevHealth: willPause ? t.health : t._prevHealth }
        }))
        // Demo rows have no real schedule — pause/resume is local-only (no network).
        if (isDemo || task._demo) return
        try {
            if (willPause) await systemAgents.pause(task.agent_id)
            else await systemAgents.resume(task.agent_id)
        } catch {
            load() // reconcile with server on failure
        }
    }

    // Health summary is scoped to the ACTIVE platform filter (cadence-agnostic),
    // so the bar reflects what the user is looking at. Paused excluded from ok.
    const summary = useMemo(() => {
        const list = (tasks || []).filter((t) => platform === 'all' || t.platform === platform)
        const total = list.length || 1
        const count = (h) => list.filter((t) => t.health === h).length
        const paused = count('paused'), critical = count('critical'), warn = count('warn'), running = count('running')
        const ok = list.length - paused - critical - warn - running
        const pct = (n) => `${((n / total) * 100).toFixed(1)}%`
        return { total: list.length, ok, warn, critical, running, paused, pct }
    }, [tasks, platform])

    const rows = useMemo(() => (tasks || []).filter(
        (t) => (platform === 'all' || t.platform === platform) && (cadence === 'all' || t.cadence === cadence)
    ), [tasks, platform, cadence])


    return (
        <div>
            {/* Intro */}
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                
                <button onClick={load} disabled={loading}
                    className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground/70 transition hover:text-foreground disabled:opacity-50">
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            {/* Health summary bar + legend */}
            <div className="mb-5">
                <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-muted">
                    <div className={HEALTH.ok.bar} style={{ width: summary.pct(summary.ok) }} />
                    <div className={HEALTH.warn.bar} style={{ width: summary.pct(summary.warn) }} />
                    <div className={HEALTH.critical.bar} style={{ width: summary.pct(summary.critical) }} />
                    <div className={HEALTH.running.bar} style={{ width: summary.pct(summary.running) }} />
                    <div className={HEALTH.paused.bar} style={{ width: summary.pct(summary.paused) }} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span><b className={HEALTH.ok.text}>{summary.ok}</b> healthy</span>
                    <span><b className={HEALTH.warn.text}>{summary.warn}</b> needs review</span>
                    <span><b className={HEALTH.critical.text}>{summary.critical}</b> critical</span>
                    {summary.running > 0 && <span><b className={HEALTH.running.text}>{summary.running}</b> running</span>}
                    <span><b className="text-muted-foreground">{summary.paused}</b> paused</span>
                    <span className="ml-auto text-muted-foreground/70">{summary.total} scheduled</span>
                </div>
            </div>

            {/* Platform + cadence filters (dropdowns) — matches the Agents tab. An
                unconnected platform is flagged in its option label (a native select
                can't render the status dot the old chips used). */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <select value={platform} onChange={(e) => onPlatformChange(e.target.value)}
                    className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground focus:border-ring focus:outline-none">
                    {HEALTH_PLATFORMS.map((p) => (
                        <option key={p.value} value={p.value}>
                            {p.label}{isPlatformConnected(p.value) ? '' : ' · not connected'}
                        </option>
                    ))}
                </select>

                <select value={cadence} onChange={(e) => setCadence(e.target.value)}
                    className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground focus:border-ring focus:outline-none">
                    {CADENCE_FILTER_OPTIONS.map((c) => (
                        <option key={c.v} value={c.v}>{c.t}</option>
                    ))}
                </select>
                {cadence !== 'all' && (
                    <span className="text-[12px] text-muted-foreground/70">{CADENCE_ROLE[cadence]}</span>
                )}

                {/* Real vs test runs — only in the run-history view. A "test" run is
                    one triggered by the beaker / drawer "Test run" (never scheduled);
                    "real" is scheduled cadence runs + queue re-runs. */}
                {isRunHistory && (
                    <div style={{ marginLeft: 'auto', display: 'inline-flex', overflow: 'hidden', borderRadius: 8, border: '1px solid hsl(var(--border))' }}>
                        {[
                            { v: 'all', label: 'All runs' },
                            { v: 'real', label: 'Prod' },
                            { v: 'test', label: 'Test' },
                        ].map((o, i) => {
                            const active = runType === o.v
                            return (
                                <button key={o.v} onClick={() => setRunType(o.v)}
                                    style={{
                                        padding: '6px 14px', fontSize: 12.5, fontWeight: active ? 600 : 500,
                                        border: 0, cursor: 'pointer', transition: 'background .15s',
                                        borderLeft: i > 0 ? '1px solid hsl(var(--border))' : 0,
                                        background: active ? 'hsl(var(--primary))' : 'hsl(var(--card))',
                                        color: active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                                    }}>
                                    {o.label}
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Task list */}
            {loading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground/70">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading scheduled runs…
                </div>
            ) : error ? (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </div>
            ) : (tasks || []).length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground/70">
                    {isRunHistory ? 'No runs yet. ' : 'No agents enabled yet. '}
                    {isRunHistory ? 'Test or enable an agent on the ' : 'Enable a scheduled agent on the '}
                    <a href="/dashboard/agents" className="font-medium text-primary hover:underline">Agents</a>{' '}
                    page and it'll show up here.
                </div>
            ) : rows.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground/70">
                    {isRunHistory ? 'No runs match this filter.' : 'No scheduled agents match this filter.'}
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                    {rows.map((t, i) => {
                        const h = HEALTH[t.health]
                        const isPaused = t.status === 'paused'
                        const isOpen = expanded === t.id
                        // An enabled agent whose platform got disconnected → greyed out,
                        // still expandable, with a Connect affordance.
                        const disconnected = t.connected === false
                        const goConnect = () => navigate(`/dashboard/mcp/servers${t.platform ? `?connect=${encodeURIComponent(t.platform)}` : ''}`)
                        return (
                            <div key={t.id}
                                className={`border-l-2 ${h.left} ${i < rows.length - 1 ? 'border-b border-border' : ''} ${isPaused ? 'opacity-70' : ''} ${disconnected ? 'bg-muted/60' : ''}`}>
                                <div className="flex items-center gap-3 px-4 py-3">
                                    <button onClick={() => setExpanded(isOpen ? null : t.id)}
                                        className={`flex min-w-0 flex-1 items-center gap-3 text-left ${disconnected ? 'opacity-60' : ''}`}>
                                        {/* Weekly/monthly cadences read better as a trend line (per the
                                            mockup); daily keeps the per-run bar sparkline. */}
                                        {t.cadence === 'daily'
                                            ? <Sparkline history={t.history} paused={isPaused} />
                                            : <TrendLine history={t.history} health={t.health} paused={isPaused} />}
                                        {isPaused ? (
                                            <span className="w-[74px] shrink-0 rounded bg-muted py-0.5 text-center text-[11px] text-muted-foreground">Paused</span>
                                        ) : (
                                            <span className="w-[74px] shrink-0 text-[12px] text-muted-foreground/70">{fmtDay(t.last_run_at)}</span>
                                        )}
                                        <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{t.insight}</span>
                                        {disconnected && (
                                            <span className="hidden shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning sm:inline">
                                                Disconnected
                                            </span>
                                        )}
                                        <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border sm:inline">
                                            {PLATFORM_LABEL[t.platform] || t.platformLabel}
                                        </span>
                                        <span className="shrink-0 text-[12px] capitalize text-muted-foreground/70">{cadenceShort(t.cadence)}</span>
                                    </button>
                                    {disconnected ? (
                                        <button onClick={goConnect} title="Connect platform"
                                            className="flex h-[26px] shrink-0 items-center gap-1 rounded-md border border-warning/20 bg-warning/10 px-2 text-[11px] font-medium text-warning transition hover:bg-warning/20">
                                            <Plug className="h-3.5 w-3.5" /> Connect
                                        </button>
                                    ) : (
                                        <button onClick={() => togglePause(t)}
                                            title={isPaused ? 'Resume' : 'Pause'}
                                            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground">
                                            {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                                        </button>
                                    )}
                                    <button onClick={() => setExpanded(isOpen ? null : t.id)}
                                        className="shrink-0 text-muted-foreground/70 hover:text-foreground">
                                        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                </div>

                                {isOpen && (
                                    <div className="px-4 pb-4">
                                        {/* Metric + schedule + run stats */}
                                        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
                                            <span>Signal: <b className="text-foreground">{t.metric}</b></span>
                                            <span>Cadence: <b className="text-foreground capitalize">{t.cadence}</b></span>
                                            <span>Runs: <b className="text-foreground">{t.run_count}</b></span>
                                            {t.next_run_at && !isPaused && <span>Next: <b className="text-foreground">{fmtWhen(t.next_run_at)}</b></span>}
                                        </div>

                                        {t.health === 'critical' && t.last_error && (
                                            <div className="mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3">
                                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                                                <p className="text-[13px] text-destructive">{t.last_error}</p>
                                            </div>
                                        )}

                                        {/* The FRAME process — only for the scheduled-health view (FRAME
                                            agents). Hidden in the run-history view. */}
                                        {!isRunHistory && (
                                            <>
                                                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                                                    FRAME process <span className="text-muted-foreground/60">· walked in order, every run</span>
                                                </p>
                                                <div className="mb-3 overflow-hidden rounded-lg border border-border">
                                                    {FRAME.map((st, si) => (
                                                        <div key={st.key}
                                                            className={`flex items-start gap-3 px-3 py-2 ${si < FRAME.length - 1 ? 'border-b border-border' : ''}`}>
                                                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-bold text-muted-foreground">{st.letter}</span>
                                                            <div className="min-w-0">
                                                                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                                    {st.label} <span className="font-normal normal-case text-muted-foreground/70">· {st.q}</span>
                                                                </div>
                                                                <div className="text-[13px] text-foreground">{t.frame?.[st.key] || '—'}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        )}

                                        {/* Last 3 runs */}
                                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                                            Last {Math.min(3, t.runs?.length || 0)} runs
                                        </p>
                                        {!t.runs?.length ? (
                                            <div className="rounded-lg border border-border p-3 text-[12px] text-muted-foreground/70">No runs recorded yet.</div>
                                        ) : (
                                            <div className="overflow-hidden rounded-lg border border-border">
                                                {t.runs.slice(0, 3).map((r, ri) => {
                                                    const rt = runToken(r.status)
                                                    return (
                                                        <div key={r.id || ri}
                                                            className={`flex items-start gap-2.5 px-3 py-2.5 ${ri < Math.min(3, t.runs.length) - 1 ? 'border-b border-border' : ''}`}>
                                                            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${HEALTH[rt].dot}`} />
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-[11.5px] text-muted-foreground/70">
                                                                    {fmtWhen(r.started_at)}{fmtDur(r.duration_s) ? ` · ${fmtDur(r.duration_s)}` : ''}
                                                                </p>
                                                                <div className={`mk-streamdown overflow-x-auto text-[13px] ${rt === 'critical' ? 'text-destructive' : 'text-foreground'}`}>
                                                                    <Streamdown>{r.output || ''}</Streamdown>
                                                                </div>
                                                                {(r.thread_id || r.is_compiled) && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setRunDetail({ ...r, insight: t.insight, agent_id: t.agent_id })}
                                                                        className="mt-1.5 text-[11.5px] font-medium text-primary hover:text-primary/80"
                                                                    >
                                                                        {r.is_compiled ? 'View full run log →' : 'View full run →'}
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${HEALTH[rt].pill}`}>
                                                                {r.status}
                                                            </span>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Legend footer — what the cadences mean (from the catalog). */}
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-muted-foreground/70">
                {['daily', 'weekly', 'monthly'].map((c) => (
                    <span key={c}><b className="text-muted-foreground">{CADENCE_LABEL[c]}</b> — {CADENCE_ROLE[c]}</span>
                ))}
                <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" /> paused rows keep their history but don't run</span>
            </div>

            {runDetail && (
                <RunDetailDrawer run={runDetail} onClose={() => setRunDetail(null)} />
            )}
        </div>
    )
}
