"use client";
/**
 * ActivityFeed — renders the ad-automation audit trail (meerkats.activity_log,
 * category 'automation'). Used as a global panel on the queue page and, scoped
 * to one rule, inside the per-rule run log.
 *
 * Each row: an actor badge (who), a summary (what), and a relative timestamp.
 * Pass `items` to render, or `ruleId`/`global` to have it fetch itself.
 */
import { useEffect, useState } from 'react'
import { User, Clock3, Bot, RefreshCw, Loader2 } from 'lucide-react'
import adRules from '@/lib/adRules'

const ACTOR_ICON = {
  user: User,
  scheduled: Clock3,
  system: Bot,
  agent: Bot,
  webhook: Bot,
}
const ACTOR_LABEL = {
  user: 'User',
  scheduled: 'Scheduled',
  system: 'System',
  agent: 'Agent',
  webhook: 'Webhook',
}
// Action → short colored tag.
const ACTION_TAG = {
  'rule.created': ['Created', 'bg-info/10 text-info border-info/20'],
  'rule.updated': ['Updated', 'bg-info/10 text-info border-info/20'],
  'rule.deleted': ['Deleted', 'bg-muted text-muted-foreground border-border'],
  'rule.toggled': ['Toggled', 'bg-muted text-muted-foreground border-border'],
  'rule.test_run': ['Test & run', 'bg-chart-4/10 text-chart-4 border-chart-4/20'],
  'rule.fired': ['Fired', 'bg-warning/10 text-warning border-warning/20'],
  'rule.executed': ['Auto-applied', 'bg-primary/10 text-primary border-primary/20'],
  'staged.approved': ['User approved', 'bg-success/10 text-success border-success/20'],
  // Approved by the user but the resume/execute FAILED — must NOT read as a clean green.
  'staged.approve_failed': ['Approve failed', 'bg-destructive/10 text-destructive border-destructive/20'],
  'staged.rejected': ['User rejected', 'bg-destructive/10 text-destructive border-destructive/20'],
}

function timeAgo(iso) {
  const d = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const dd = Math.floor(h / 24); return `${dd}d ago`
}

function ActivityRow({ a }) {
  const Icon = ACTOR_ICON[a.actor_type] || Bot
  const [tag, tagCls] = ACTION_TAG[a.action] || [a.action, 'bg-muted text-muted-foreground border-border']
  // The colored badge (User approved / User rejected / Approve failed) fully carries the
  // outcome — a separate check/cross icon was redundant (and read as contradictory on a
  // green "approved" badge next to a red cross), so it's intentionally omitted.
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tagCls}`}>{tag}</span>
          <span className="text-[13px] text-foreground">{a.summary || a.action}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {ACTOR_LABEL[a.actor_type] || a.actor_type}
          {a.actor_name ? ` · ${a.actor_name}` : ''} · {timeAgo(a.created_at)}
        </div>
      </div>
    </div>
  )
}

/** Presentational: render a given list (used inside the run log). */
export function ActivityList({ items }) {
  if (!items || items.length === 0) {
    return <div className="py-2 text-[12px] text-muted-foreground">No activity yet.</div>
  }
  return (
    <div className="divide-y divide-border">
      {items.map((a) => <ActivityRow key={a.id} a={a} />)}
    </div>
  )
}

// ── Platform-history row (native Google/Meta change) ───────────────────────────
const PLATFORM_CLS = {
  google: 'bg-info/10 text-info border-info/20',
  meta: 'bg-chart-2/10 text-chart-2 border-chart-2/20',
}
export function PlatformRow({ e }) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PLATFORM_CLS[e.platform] || 'bg-muted text-muted-foreground border-border'}`}>
        {e.platform}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-foreground">
          <span className="font-medium">{e.action || 'change'}</span>
          {e.object ? <span className="text-muted-foreground"> · {e.object}</span> : null}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {e.user ? `${e.user} · ` : ''}{e.source ? `${e.source} · ` : ''}{e.when ? timeAgo(e.when) : ''}
          {e.changed_fields ? ` · ${e.changed_fields}` : ''}
        </div>
      </div>
    </div>
  )
}

/** Self-fetching global panel with two tabs: Meerkats audit log + native platform history. */
export default function ActivityFeed({ refreshKey, meerkatsOnly = false }) {
  const [tab, setTab] = useState('meerkats') // 'meerkats' | 'platform'
  const [items, setItems] = useState([])
  const [platform, setPlatform] = useState(null) // { items, sources } | null (lazy)
  const [loading, setLoading] = useState(true)

  const loadMeerkats = () => {
    setLoading(true)
    adRules.activity()
      .then(({ data }) => setItems(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }
  useEffect(loadMeerkats, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadPlatform = () => {
    setLoading(true)
    adRules.platformHistory(14)
      .then(({ data }) => setPlatform({ items: data?.items || [], sources: data?.sources || {} }))
      .catch((e) => setPlatform({ items: [], sources: {}, error: e?.response?.data?.error || 'failed' }))
      .finally(() => setLoading(false))
  }

  const switchTab = (t) => {
    setTab(t)
    if (t === 'platform' && !platform) loadPlatform()
    else setLoading(false)
  }

  const refresh = () => (tab === 'platform' ? loadPlatform() : loadMeerkats())
  const count = tab === 'platform' ? (platform?.items?.length ?? 0) : items.length

  const TabBtn = ({ id, label }) => (
    <button onClick={() => switchTab(id)}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
      {label}
    </button>
  )

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        {!meerkatsOnly && (
          <>
            <h2 className="text-sm font-semibold text-foreground">Activity</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{count}</span>
            <div className="ml-2 flex items-center gap-1 rounded-lg bg-muted p-0.5">
              <TabBtn id="meerkats" label="Meerkats" />
              <TabBtn id="platform" label="Platform history" />
            </div>
          </>
        )}
        <button onClick={refresh} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card px-4 py-1 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading {tab === 'platform' ? 'platform history' : 'activity'}…
          </div>
        ) : tab === 'meerkats' ? (
          <ActivityList items={items} />
        ) : (
          <>
            {/* Per-platform source status */}
            {platform?.sources && (
              <div className="flex flex-wrap gap-3 py-2 text-[11px] text-muted-foreground">
                {['google', 'meta'].map((p) => {
                  const s = platform.sources[p]
                  if (!s) return null
                  return (
                    <span key={p}>
                      {p}: {s.ok ? `${s.count} events` : <span className="text-destructive">{s.error || 'unavailable'}</span>}
                    </span>
                  )
                })}
              </div>
            )}
            {(platform?.items?.length ?? 0) === 0 ? (
              <div className="py-3 text-[12px] text-muted-foreground">
                No native platform changes in the last 14 days (or no ad account connected).
              </div>
            ) : (
              <div className="divide-y divide-border">
                {platform.items.map((e, i) => <PlatformRow key={`${e.platform}-${e.when}-${i}`} e={e} />)}
              </div>
            )}
          </>
        )}
      </div>
      {tab === 'platform' && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Pulled live from Google Ads (change history) &amp; Meta (activity log) — includes changes made directly in Ads Manager, not just by Meerkats.
        </p>
      )}
    </div>
  )
}
