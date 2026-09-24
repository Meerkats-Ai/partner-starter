/**
 * GalleryCard — the one card renderer used by BOTH the Explore board and the
 * Cockpit pinned strip. Routes a spec to the right renderer:
 *   • spec.needsSetup  → a friendly "needs setup" card (no query, still pinnable)
 *   • spec.render      → a Shopify/Marketing spec (kpiGrid/donut/adCampaignTable/
 *                        table/…) → delegate to ShopifyCard's `render:` dispatcher
 *   • spec.kind==='table' → SpecTable (Flipkart table specs)
 *   • otherwise        → SpecChart (Flipkart chart specs)
 *
 * Keeping this dispatch in one place means the Cockpit strip and the Explore
 * board always render an identical card for the same spec. The two spec families
 * are disjoint: Flipkart specs (chartGallery.js) carry `kind`/plain-chart shape
 * and NO `render`; Shopify/Marketing specs (shopifyGallery.js) always carry a
 * `render` string and NO `kind`. Explore historically split these across two
 * dispatchers (GalleryCard vs ShopifyCard); the Cockpit strip only ever called
 * GalleryCard, so a pinned `render:`-based spec (e.g. "Ad Campaign Table") used
 * to fall through to SpecChart and fire an empty metrics[] query (400
 * "metrics[] required" → "No data"). Delegating `render:` specs here fixes that.
 */
import React from 'react'
import { Pin, PinOff, Wrench } from 'lucide-react'
import SpecChart from './SpecChart'
import SpecTable from './SpecTable'
import ShopifyCard from './ShopifyCards'
import AgentSpecCard from './AgentSpecCard'
const ExploreNewPinnedCard = () => null // explore-new pins not supported in starter
import { togglePin, isPinned, PINS_CHANGED_EVENT } from './chartSpec'

// A card for a chart the data layer can't serve yet — no fake numbers, just a
// plain-language explanation of what would turn it on. Still pinnable, so a user
// can park it on the Cockpit as a "coming soon" placeholder if they want.
function SetupCard({ spec, onPinChange }) {
    const [pinned, setPinned] = React.useState(() => isPinned(spec.id))
    React.useEffect(() => {
        const sync = () => setPinned(isPinned(spec.id))
        sync()
        window.addEventListener(PINS_CHANGED_EVENT, sync)
        return () => window.removeEventListener(PINS_CHANGED_EVENT, sync)
    }, [spec.id])
    const onToggle = () => { const now = togglePin(spec); setPinned(now); onPinChange?.(now) }
    return (
        <div className="rounded-xl border border-dashed border-border bg-muted/60 p-5">
            <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-foreground" title={spec.title}>{spec.title}</h3>
                    {spec.subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground/70" title={spec.subtitle}>{spec.subtitle}</p>}
                </div>
                <button type="button" onClick={onToggle}
                    title={pinned ? 'Unpin from Cockpit' : 'Pin to Cockpit'}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                        pinned ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary'}`}>
                    {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    {pinned ? 'Pinned' : 'Pin'}
                </button>
            </div>
            <div className="flex items-start gap-2.5 rounded-lg bg-card/70 px-3 py-3 text-xs text-muted-foreground">
                <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>{spec.setupNote || 'This chart needs extra data before it can show numbers.'}</span>
            </div>
        </div>
    )
}

export default function GalleryCard({ spec, admin = false, workspaceId, platform = null, onPinChange, windowOverride = null }) {
    if (spec.needsSetup) return <SetupCard spec={spec} onPinChange={onPinChange} />
    // Agent-chat pins are self-describing (they carry their own chart/table render
    // spec + re-runnable query) — the fixed SpecChart/SpecTable registries can't
    // express their arbitrary metrics/columns. Route them to the same Rendered*
    // cards the chat used; they re-query live + own their date picker.
    if (spec.source === 'agent') {
        return <AgentSpecCard spec={spec} onPinChange={onPinChange} />
    }
    // ExploreNew ads-dashboard pins ({platform, cardId}) render through the same
    // vanilla engine the Explore (New) page uses, so a pinned card looks + reads
    // identically on the Cockpit strip (not the generic SpecChart fallback).
    if (spec.source === 'explore-new') {
        return <ExploreNewPinnedCard spec={spec} admin={admin} workspaceId={workspaceId} onPinChange={onPinChange} />
    }
    // Shopify/Marketing specs carry a `render:` key (kpiGrid/donut/adCampaignTable/
    // table/…) and own their own query — hand them to ShopifyCard's dispatcher so a
    // pinned one renders identically in the Cockpit as it does in Explore.
    if (spec.render) {
        return <ShopifyCard spec={spec} admin={admin} workspaceId={workspaceId} platform={platform} onPinChange={onPinChange} windowOverride={windowOverride} />
    }
    if (spec.kind === 'table') {
        return <SpecTable spec={spec} admin={admin} workspaceId={workspaceId} platform={platform} onPinChange={onPinChange} windowOverride={windowOverride} />
    }
    return <SpecChart spec={spec} admin={admin} workspaceId={workspaceId} platform={platform} onPinChange={onPinChange} windowOverride={windowOverride} />
}
