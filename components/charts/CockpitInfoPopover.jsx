import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { InformationCircleIcon, XMarkIcon, CheckCircleIcon, ExclamationTriangleIcon, ClockIcon } from '@heroicons/react/20/solid'
import cdpApi from '@/lib/cdpApi'

/**
 * CockpitInfoPopover — the ⓘ next to the Cockpit KPIs. Opens a popover with:
 *   1. Data sources — each connected platform + when it last synced (from
 *      /cdp/connector-stats, the same last_synced_at the Integrations cards use).
 *   2. Glossary — the STATIC set of short forms the cockpit uses (ROAS, COGS, AOV…)
 *      with full form + a one-line meaning. Static here because the cockpit's
 *      abbreviations are known upfront; the chat view derives its glossary LIVE from
 *      the metrics catalog instead (see MetricsGlossary).
 */

// The abbreviations the cockpit surfaces (KPIs, deltas, tooltips). Known upfront.
export const COCKPIT_GLOSSARY = [
  { abbr: 'ROAS', full: 'Return on Ad Spend', desc: 'Revenue ÷ ad spend. 2× means ₹2 back for every ₹1 spent.' },
  { abbr: 'Platform ROAS', full: 'Platform-reported ROAS', desc: 'ROAS as the ad platform reports it (not reconciled to real orders).' },
  { abbr: 'Real ROAS', full: 'Delivered ROAS', desc: 'ROAS computed from real paid orders in the CDP — the honest number.' },
  { abbr: 'AOV', full: 'Average Order Value', desc: 'Revenue ÷ orders — the typical basket size.' },
  { abbr: 'CAC', full: 'Customer Acquisition Cost', desc: 'Ad spend ÷ new customers acquired.' },
  { abbr: 'COGS', full: 'Cost of Goods Sold', desc: 'What the products themselves cost — used for true profit.' },
  { abbr: 'CPM', full: 'Cost per Mille', desc: 'Cost per 1,000 impressions.' },
  { abbr: 'CPC', full: 'Cost per Click', desc: 'Ad spend ÷ clicks.' },
  { abbr: 'CTR', full: 'Click-Through Rate', desc: 'Clicks ÷ impressions.' },
  { abbr: 'ACOS', full: 'Advertising Cost of Sales', desc: 'Ad spend ÷ attributed sales (the inverse of ROAS; lower is better).' },
  { abbr: 'ARPU', full: 'Average Revenue per User', desc: 'Revenue ÷ customers over a period.' },
  { abbr: 'LTV', full: 'Lifetime Value', desc: 'Total revenue a customer brings over their lifetime.' },
]

// Connector-stat slug → { label, platform key used by connectedPlatforms() }.
const SOURCE_META = {
  shopify: { label: 'Shopify', platform: 'shopify' },
  'meta-ads': { label: 'Meta Ads', platform: 'meta' },
  'google-ads': { label: 'Google Ads', platform: 'google' },
  flipkart: { label: 'Flipkart Ads', platform: 'flipkart' },
  'amazon-ads': { label: 'Amazon Ads', platform: 'amazon' },
}

function timeAgo(iso) {
  if (!iso) return null
  const t = Date.parse(iso); if (Number.isNaN(t)) return null
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`
  return new Date(t).toLocaleDateString()
}

export default function CockpitInfoPopover({ className = '', connectedPlatforms = null }) {
  const [open, setOpen] = useState(false)
  const [stats, setStats] = useState(null)  // { slug: { metric_label, metric_count, last_synced_at, sync_status } }
  const [loaded, setLoaded] = useState(false)
  const [pos, setPos] = useState(null)   // fixed { top, left } anchored to the button
  const btnRef = useRef(null)
  const panelRef = useRef(null)

  // Load sync stats once, on first open (best-effort).
  useEffect(() => {
    if (!open || loaded) return
    let alive = true
    cdpApi.cdp.getConnectorStats()
      .then(({ data }) => { if (alive) { setStats(data?.stats || {}); setLoaded(true) } })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [open, loaded])

  // Anchor the portalled panel to the button (fixed, left-aligned), tracking scroll/resize.
  useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setPos({ top: Math.round(r.bottom + 8), left: Math.round(r.left) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])

  // Close on outside click / Esc. Panel is portalled, so check both refs.
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  // Only surface CONNECTED platforms. When the caller passes connectedPlatforms
  // (from connectedPlatforms()), intersect against it — a platform shows only if the
  // workspace actually has it connected. If not passed, fall back to whatever the
  // stats returned (has-data platforms).
  const sources = useMemo(() => {
    const s = stats || {}
    const connected = Array.isArray(connectedPlatforms) ? new Set(connectedPlatforms) : null
    return Object.keys(s)
      .map((slug) => ({ slug, meta: SOURCE_META[slug], stat: s[slug] }))
      .filter(({ meta }) => meta && (!connected || connected.has(meta.platform)))
      .map(({ slug, meta, stat }) => ({ slug, label: meta.label, platform: meta.platform, ...stat }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [stats, connectedPlatforms])

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Data sources & glossary"
        aria-label="Data sources & glossary"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <InformationCircleIcon className="h-5 w-5" />
      </button>

      {/* Portalled to <body> at high z so it never renders under sticky headers /
          KPI cards (their stacking contexts made an absolute panel see-through). */}
      {open && pos && createPortal(
        <div ref={panelRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[9999] w-[360px] max-w-[92vw] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
          <div className="flex items-center justify-between border-b border-border bg-popover px-4 py-2.5">
            <span className="text-sm font-semibold text-foreground">About these numbers</span>
            <button onClick={() => setOpen(false)} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><XMarkIcon className="h-4 w-4" /></button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto bg-popover">
            {/* Data sources */}
            <div className="px-4 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Data sources · last synced</div>
              {!loaded ? (
                <div className="py-2 text-xs text-muted-foreground">Loading sync status…</div>
              ) : sources.length === 0 ? (
                <div className="py-2 text-xs text-muted-foreground">No connected sources yet.</div>
              ) : (
                <ul className="space-y-1.5">
                  {sources.map((src) => {
                    const ago = timeAgo(src.last_synced_at)
                    const err = src.sync_status === 'error'
                    return (
                      <li key={src.slug}>
                        {/* Whole row links to this platform's Data Spine (new tab). */}
                        <a
                          href={`/dashboard/crm/${src.platform}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`View ${src.label} data (Data Spine)`}
                          className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs transition hover:bg-muted"
                        >
                          <span className="flex items-center gap-1.5 text-foreground">
                            {err ? <ExclamationTriangleIcon className="h-3.5 w-3.5 text-destructive" />
                              : <CheckCircleIcon className="h-3.5 w-3.5 text-success" />}
                            <span className="font-medium">{src.label}</span>
                            {typeof src.metric_count === 'number' && (
                              <span className="text-muted-foreground">· {src.metric_count.toLocaleString()} {(src.metric_label || '').toLowerCase()}</span>
                            )}
                          </span>
                          <span className={`flex items-center gap-1 whitespace-nowrap underline decoration-dotted underline-offset-2 ${err ? 'text-destructive' : 'text-muted-foreground'}`}>
                            <ClockIcon className="h-3 w-3" />
                            {err ? 'sync failed' : (ago ? `synced ${ago}` : 'not synced yet')}
                          </span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Glossary */}
            <div className="border-t border-border px-4 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Glossary</div>
              <dl className="space-y-2">
                {COCKPIT_GLOSSARY.map((g) => (
                  <div key={g.abbr}>
                    <dt className="text-xs">
                      <span className="font-semibold text-foreground">{g.abbr}</span>
                      <span className="text-muted-foreground"> — {g.full}</span>
                    </dt>
                    <dd className="text-[11px] leading-snug text-muted-foreground">{g.desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
