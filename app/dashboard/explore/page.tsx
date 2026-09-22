"use client";
/**
 * Explore — ported from the Meerkats frontend (admin/ExploreDashboard).
 * A faithful port of the vanilla-engine ads dashboard. The `admin` workspace-id
 * paste box is dropped (the starter is always the end-user's current workspace);
 * everything else — the engine, live loader, pin/unpin, per-card drill/CSV — is
 * the original, wired to the public API via the metrics/pinnedCharts shims.
 *
 * It mutates the DOM directly (engine builds HTML into a ref'd node), so it must
 * be a client component and never SSR'd — hence "use client".
 */
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import * as engine from "@/components/charts/exploreDashboardEngine";
import { loadPlatformLive, resetLive } from "@/components/charts/exploreDashboardLive";
import { togglePin, isPinned, loadPins } from "@/components/charts/chartSpec";
import { useMetrics } from "@/components/charts/useMetrics";
import { lastNDays } from "@/components/charts/dateWindows";
import "@/components/charts/exploreDashboard.css";

const PLATFORM_OPTS = [
  { v: "amazon", l: "Amazon Ads" },
  { v: "flipkart", l: "Flipkart Ads" },
  { v: "google", l: "Google Ads" },
  { v: "meta", l: "Meta Ads" },
];

function ensureFonts() {
  if (typeof document === "undefined") return;
  if (document.getElementById("exp-dash-fonts")) return;
  const link = document.createElement("link");
  link.id = "exp-dash-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap";
  document.head.appendChild(link);
}

export default function ExploreDashboard() {
  const stackRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const bump = useCallback(() => forceTick((n) => n + 1), []);
  const platformRef = useRef(platform);
  useEffect(() => { platformRef.current = platform; }, [platform]);
  const unpinnedRef = useRef<Record<string, boolean>>({});
  const [liveLoading, setLiveLoading] = useState(true);

  useEffect(() => { ensureFonts(); loadPins(); }, []);

  const win90 = useMemo(() => lastNDays(90), []);
  const adRowProbe = useMetrics({ metrics: ["total_ad_spend"], groupBy: ["ad_row__platform"], ...win90 }, {});
  const amazonProbe = useMetrics({ metrics: ["amazon_spend"], ...win90 }, {});
  const probing = adRowProbe.loading || amazonProbe.loading;

  const connected = useMemo(() => {
    const set = new Set(
      (adRowProbe.rows || [])
        .filter((r: any) => Number(r.total_ad_spend) > 0)
        .map((r: any) => String(r.ad_row__platform || "").toLowerCase()),
    );
    if ((amazonProbe.rows || []).some((r: any) => Number(r.amazon_spend) > 0)) set.add("amazon");
    return set;
  }, [adRowProbe.rows, amazonProbe.rows]);

  const platformOpts = useMemo(() => {
    const avail = probing ? PLATFORM_OPTS : PLATFORM_OPTS.filter((o) => connected.has(o.v));
    const opts = avail.length ? avail : PLATFORM_OPTS;
    return (opts.length > 1 ? [{ v: "all", l: "All platforms" }] : []).concat(opts);
  }, [probing, connected]);

  useEffect(() => {
    if (platform !== null || probing) return;
    const firstConnected = PLATFORM_OPTS.find((o) => connected.has(o.v));
    setPlatform(firstConnected ? firstConnected.v : "amazon");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probing, connected]);

  useEffect(() => {
    if (probing || platform === null || platform === "all") return;
    if (connected.size && !connected.has(platform)) {
      const firstConnected = PLATFORM_OPTS.find((o) => connected.has(o.v));
      if (firstConnected) setPlatform(firstConnected.v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probing, connected, platform]);

  const loadLive = useCallback(async (pk: string, rangeValue = "30d") => {
    setLiveLoading(true);
    try {
      await loadPlatformLive(pk, { rangeValue });
    } finally {
      setLiveLoading(false);
      bump();
    }
  }, [bump]);

  useEffect(() => {
    if (platform === null) return;
    resetLive();
    engine.resetState();
    unpinnedRef.current = {};
    loadLive(platform, "30d");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  const renderStack = useCallback(() => {
    const root = stackRef.current;
    if (!root) return;
    if (platform === null) {
      root.innerHTML = '<div class="mono" style="padding:24px 0">detecting connected platforms…</div>';
      return;
    }
    engine.beginRender();
    const pk = platform;
    const list = engine.cardsFor(pk);
    const unpinned = unpinnedRef.current;
    const shown = list.filter((id: string) => !unpinned[`${pk}:${id}`]);
    const hidden = list.filter((id: string) => unpinned[`${pk}:${id}`]);

    let html = shown.map((id: string) => cardHtml(pk, id)).join("");
    if (hidden.length) {
      html += `<div class="restore"><span>${hidden.length} card${hidden.length > 1 ? "s" : ""} unpinned — hidden from this board.</span><button data-restore-all="1">Restore all</button></div>`;
    }
    html += `<div class="mono" style="padding:8px 0 24px">${liveLoading ? "loading live data…" : "live data"} · figures in inr</div>`;
    root.innerHTML = html;
    engine.wireTrends(root);
    wireEvents(root, pk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, liveLoading]);

  useEffect(() => { renderStack(); });

  function cardHtml(pk: string, id: string) {
    const c = engine.CARDS[id];
    const blocked = engine.isBlocked(pk, id);
    const drillable = !blocked && ["rank", "table", "pbars", "grid"].includes(id);
    const d = drillable ? engine.drillOf(pk, id) : null;
    const titleHtml = c.title(pk); const qHtml = c.q(pk); const ctlHtml = c.ctl(pk);
    const live = !blocked && engine.cardLiveness(pk, id);
    const loading = liveLoading && !blocked;
    const noData = !loading && !blocked && !live;

    let body: string; let cls: string; let badgeText: string; let foot: string;
    if (loading) {
      body = LOADER_HTML; cls = "setup"; badgeText = "loading"; foot = "loading live data…";
    } else if (blocked) {
      body = engine.blockedBody(pk, id); cls = "setup"; badgeText = "needs setup"; foot = "no live data yet — see note above";
    } else if (noData) {
      body = NO_DATA_HTML; cls = "setup"; badgeText = "no data"; foot = "no data for this period";
    } else if (d) {
      const mk = (engine.getState(pk, id).mk) || (id === "grid" ? engine.CFG[pk].effAlt : engine.CFG[pk].eff);
      body = engine.drilledBodyFor(pk, id, mk); cls = "live"; badgeText = "live"; foot = "";
    } else {
      body = c.body(pk); cls = "live"; badgeText = "live"; foot = "";
    }
    const spec = engine.pinSpecFor(pk, id);
    const pinned = isPinned(spec.id);
    const badge = `<span class="srcbadge ${cls}">${badgeText}</span>`;
    const showCtls = !blocked && !loading && !noData;
    return `<section class="card" data-cid="${id}">
      <header class="card-h">
        <span class="grip" title="Drag to reorder">${ICON_GRIP}</span>
        <div class="tw"><h3 class="t">${titleHtml}${d ? " — drilled" : ""}</h3><div class="q">${qHtml}</div></div>
        <div class="ctls">${showCtls ? ctlHtml : ""}</div>
        <div class="tail">
          ${badge}
          ${showCtls ? `<button class="iconbtn" data-dl="${id}" title="Download CSV">${ICON_DL}</button>` : ""}
          <button class="iconbtn ${pinned ? "active" : ""}" data-pin="${id}" title="${pinned ? "Unpin" : "Pin"}">${ICON_PIN}</button>
          <button class="iconbtn active" data-unpin="${id}" title="Hide card from this board">${ICON_EYE_OFF}</button>
        </div>
      </header>
      ${showCtls ? engine.crumbsHtmlFor(pk, id) : ""}
      <div class="body">${body}</div>
      <div class="foot"><span>${foot}</span></div>
    </section>`;
  }

  function wireEvents(root: HTMLElement, pk: string) {
    root.querySelectorAll("[data-unpin]").forEach((b: any) => b.addEventListener("click", () => {
      unpinnedRef.current[`${pk}:${b.dataset.unpin}`] = true; bump();
    }));
    const ra = root.querySelector("[data-restore-all]");
    if (ra) ra.addEventListener("click", () => {
      engine.cardsFor(pk).forEach((id: string) => delete unpinnedRef.current[`${pk}:${id}`]); bump();
    });
    root.querySelectorAll("[data-dl]").forEach((b: any) => b.addEventListener("click", () => engine.downloadCsv(pk, b.dataset.dl)));
    root.querySelectorAll("[data-pin]").forEach((b: any) => b.addEventListener("click", () => {
      togglePin(engine.pinSpecFor(pk, b.dataset.pin)); bump();
    }));
    root.querySelectorAll("select[data-ctl]").forEach((s: any) => s.addEventListener("change", () => {
      const state = engine.getState(pk, s.dataset.card); state[s.dataset.ctl] = s.value; bump();
    }));
    root.querySelectorAll("button[data-ctl]").forEach((b: any) => b.addEventListener("click", () => {
      const state = engine.getState(pk, b.dataset.card);
      if (b.dataset.ctl === "mkseg") state.mk = b.dataset.val === "CPI" ? "cpi" : "cvr";
      else state[b.dataset.ctl] = b.dataset.val;
      bump();
    }));
    root.querySelectorAll(".tgl[data-ctl='compare']").forEach((t: any) => t.addEventListener("click", () => {
      const state = engine.getState(pk, t.dataset.card); state.cmp = !state.cmp; bump();
    }));
    root.querySelectorAll("[data-drbtn]").forEach((b: any) => b.addEventListener("click", (e: any) => {
      e.stopPropagation();
      const dr = b.closest(".dr"); const menu = dr.querySelector(".menu");
      root.querySelectorAll(".dr .menu").forEach((m: any) => { if (m !== menu) m.hidden = true; });
      root.querySelectorAll(".dr").forEach((el: any) => { if (el !== dr) el.classList.remove("open"); });
      menu.hidden = !menu.hidden; dr.classList.toggle("open", !menu.hidden);
    }));
    root.querySelectorAll(".dr .opt").forEach((o: any) => o.addEventListener("click", () => {
      const state = engine.getState(pk, o.dataset.card); state.range = o.dataset.val;
      loadLive(pk, o.dataset.val);
    }));
  }

  useEffect(() => {
    const root = stackRef.current;
    if (!root) return undefined;
    const onClick = (e: any) => {
      const pk = platformRef.current;
      if (!e.target.closest || !e.target.closest(".dr")) {
        root.querySelectorAll(".dr .menu").forEach((m: any) => { m.hidden = true; });
      }
      const card = e.target.closest ? e.target.closest(".card") : null;
      if (!card) return;
      const cid = card.dataset.cid;
      if (!cid) return;
      const crumb = e.target.closest(".crumb");
      if (crumb) { engine.handleCrumb(pk, cid, parseInt(crumb.dataset.crumb, 10)); bump(); return; }
      const t = e.target.closest(".bridge");
      if (!t || pk === "all") return;
      engine.handleDrill(pk, cid, t.dataset);
      bump();
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="exp-dash">
      <div className="topbar"><div className="topbar-in">
        <span className="wordmark">Explore</span>
        <span className="client">WORKSPACE · INR</span>
        <select className="platform-sel" value={platform || ""} disabled={probing}
          onChange={(e) => setPlatform(e.target.value)}>
          {probing && <option value="">Detecting…</option>}
          {platformOpts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </div></div>
      <div className="wrap">
        <div id="stack" ref={stackRef} />
      </div>
    </div>
  );
}

const LOADER_HTML = '<div class="loadingskel" role="status" aria-label="Loading data"></div>';
const NO_DATA_HTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:56px 24px;text-align:center;color:var(--ink-400)">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>
  <div style="font-size:var(--fs-body);color:var(--ink-500)">No data available</div>
</div>`;
const IC = (p: string, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON_GRIP = IC('<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>');
const ICON_DL = IC('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>');
const ICON_PIN = IC('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/>');
const ICON_EYE_OFF = IC('<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>');
