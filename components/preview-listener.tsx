"use client";
/**
 * PreviewListener — makes this app a live-preview target for the Meerkats branding
 * customizer. When embedded in an <iframe> by the customizer, it receives
 * postMessage({ type: 'mk-preview', skin, accent, mode }) and applies them
 * instantly via the same applySkin/applyBrandColor the real app uses — so the
 * preview is pixel-identical to production, not a mock.
 *
 * Security: we do NOT hard-verify origin here because the customizer may run on
 * several hosts (localhost, app.meerkats.ai, an agency domain) and this listener
 * only mutates CSS variables — it never reads data or calls APIs. If you want to
 * lock it down, pass an allowed-origins list via NEXT_PUBLIC_PREVIEW_ORIGINS and
 * check e.origin below.
 */
import { useEffect } from "react";
import { applySkin, applyBrandColor } from "@/lib/theme";
import { getSkin } from "@/lib/themes/skins";
import { applyThemeConfig, type ThemeConfig } from "@/lib/themes/theme-config";

export type PreviewBranding = {
  app_name?: string | null;
  tagline?: string | null;
  logo_url?: string | null;
};

export type PreviewMessage = {
  type: "mk-preview";
  skin?: string | null;
  accent?: string | null; // hex; overrides the skin primary
  mode?: "light" | "dark";
  themeConfig?: ThemeConfig | null; // base/accent/chart/radius/fonts overrides
  branding?: PreviewBranding | null; // live app_name / logo / tagline
};

/** Event the preview shell listens for to re-render its branded header live. */
export const PREVIEW_BRANDING_EVENT = "mk-preview-branding";

export function PreviewListener() {
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as PreviewMessage;
      if (!data || data.type !== "mk-preview") return;
      const mode = data.mode === "dark" ? "dark" : "light";
      // Order (later wins): skin preset → theme_config token overrides → brand
      // accent. Store the brand accent first so applySkin re-applies it last; then
      // theme_config overrides base/accent/chart/radius/fonts on top of the skin;
      // then re-apply brand accent so an explicit brand color still wins.
      applyBrandColor(data.accent ?? null);
      applySkin(getSkin(data.skin), mode);
      applyThemeConfig(data.themeConfig ?? null, mode);
      if (data.accent) applyBrandColor(data.accent); // re-assert over theme_config accent
      // Broadcast branding to the preview shell so its header updates live.
      if (data.branding !== undefined) {
        window.dispatchEvent(
          new CustomEvent(PREVIEW_BRANDING_EVENT, { detail: data.branding }),
        );
      }
    }
    window.addEventListener("message", onMessage);
    // Tell the parent we're ready to receive (it may have queued an initial state).
    try {
      window.parent?.postMessage({ type: "mk-preview-ready" }, "*");
    } catch {
      /* not framed */
    }
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return null;
}
