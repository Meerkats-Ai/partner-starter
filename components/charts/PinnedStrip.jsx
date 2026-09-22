"use client";
/**
 * PinnedStrip — the "Pinned charts" + "Removed charts" management strip at the
 * top of the Cockpit.
 *
 * - Pinned charts: the user's Explore-pinned ChartSpecs, rendered live and
 *   re-orderable/removable. Loaded from the server (chartSpec.js).
 * - Removed charts: default cockpit charts the user hid (the × on a card). A
 *   small "Restore" menu brings them back.
 *
 * Renders nothing only when there are neither pins nor hidden defaults, so the
 * Cockpit is unchanged until the user pins or removes something. Stays in sync
 * with Explore + the dashboards via PINS_CHANGED_EVENT.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Pin, RotateCcw, ChevronDown } from 'lucide-react'
import GalleryCard from './GalleryCard'
import { getPinnedSpecs, getHiddenIds, unhideDefault, loadPins, PINS_CHANGED_EVENT } from './chartSpec'
import { getPinnedSaved, loadSavedCharts, SAVED_CHARTS_CHANGED_EVENT } from './savedCharts.store'

// Human labels for the default cockpit chart ids (for the Restore menu).
const DEFAULT_CHART_LABELS = {
    revenue_vs_spend_trend: 'Revenue vs ad spend',
    roas_by_channel: 'ROAS by channel',
    spend_allocation: 'Spend allocation',
    inventory_at_risk: 'Inventory at risk',
    roas_trend: 'Platform ROAS vs MER',
    cpm_frequency_trend: 'CPM & frequency',
    campaign_breakdown: 'Campaign breakdown',
    creative_fatigue: 'Creative fatigue by adset',
    attribution_gap: 'Attribution gap',
    weekly_action_list: "This week's action list",
    ad_funnel: 'Where the money leaks (funnel)',
    campaign_stage_table: 'Every campaign, stage by stage',
}
const labelFor = (id) => DEFAULT_CHART_LABELS[id] || id

// Merge the two pin sources into ONE strip: curated Explore pins (chartSpec.js →
// pinned_charts) + pinned chat-generated charts (savedCharts.store → saved_charts).
// Both spec families render through GalleryCard (agent specs carry source:'agent').
const mergedPinned = () => [...getPinnedSpecs(), ...getPinnedSaved()]

export default function PinnedStrip({ admin = false, workspaceId, platform = null }) {
    const [specs, setSpecs] = useState(() => mergedPinned())
    const [hidden, setHidden] = useState(() => getHiddenIds())
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef(null)

    useEffect(() => {
        const sync = () => { setSpecs(mergedPinned()); setHidden(getHiddenIds()) }
        window.addEventListener(PINS_CHANGED_EVENT, sync)
        window.addEventListener(SAVED_CHARTS_CHANGED_EVENT, sync)
        Promise.all([loadPins(), loadSavedCharts()]).then(sync)
        return () => {
            window.removeEventListener(PINS_CHANGED_EVENT, sync)
            window.removeEventListener(SAVED_CHARTS_CHANGED_EVENT, sync)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId])

    useEffect(() => {
        if (!menuOpen) return undefined
        const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
    }, [menuOpen])

    // Nothing pinned AND nothing removed → don't take up space.
    if (!specs.length && !hidden.length) return null

    return (
        <section className="mb-8">
            <div className="mb-3 flex items-center gap-2">
                <Pin className="h-4 w-4 text-orange-500" />
                <h2 className="text-sm font-semibold text-gray-700">
                    {specs.length ? 'Pinned charts' : 'Your dashboard'}
                </h2>
                {specs.length > 0 && (
                    <span className="text-xs text-gray-400">{specs.length} pinned · manage in Explore</span>
                )}
                {/* Restore removed default charts */}
                {hidden.length > 0 && (
                    <div className="relative ml-auto" ref={menuRef}>
                        <button onClick={() => setMenuOpen((o) => !o)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 transition hover:border-gray-300 hover:text-gray-700">
                            <RotateCcw className="h-3.5 w-3.5" />
                            {hidden.length} removed
                            <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        {menuOpen && (
                            <div className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                                <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Restore a chart</div>
                                {hidden.map((id) => (
                                    <button key={id} onClick={() => { unhideDefault(id); if (hidden.length === 1) setMenuOpen(false) }}
                                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50">
                                        {labelFor(id)}
                                        <RotateCcw className="h-3.5 w-3.5 text-gray-400" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
            {specs.length > 0 && (
                <div className="grid grid-cols-1 gap-4">
                    {specs.map((spec) => (
                        <GalleryCard
                            key={spec.id}
                            spec={spec}
                            admin={admin}
                            workspaceId={workspaceId}
                            platform={spec.platformScoped ? platform : null}
                            onPinChange={() => setSpecs(mergedPinned())}
                        />
                    ))}
                </div>
            )}
        </section>
    )
}
