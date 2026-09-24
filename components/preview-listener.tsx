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
import { applySkin, applyBrandColor, applyCustomCssRaw } from "@/lib/theme";
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
  customCss?: string | null;        // uploaded tweakcn/shadcn export — overrides skin
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
      const hasCustom = !!(data.customCss && data.customCss.trim());
      // When an uploaded custom theme is present it OWNS all colors — including
      // --primary. The agency's separate brand accent (primary_color) must NOT
      // override the file's own --primary, or the upload looks like it did nothing.
      // So suppress the brand accent while custom CSS is active; otherwise apply it.
      applyBrandColor(hasCustom ? null : (data.accent ?? null));
      // Skin runs first as the baseline for any token the file omits, then the
      // uploaded CSS is INJECTED WHOLE (its own :root/.dark rules theme the app).
      applySkin(getSkin(data.skin), mode);
      applyThemeConfig(data.themeConfig ?? null, mode);
      applyCustomCssRaw(hasCustom ? data.customCss! : null, mode);
      if (!hasCustom && data.accent) applyBrandColor(data.accent); // re-assert over theme accent
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
