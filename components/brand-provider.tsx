"use client";
/**
 * BrandProvider — fetches the agency's branding once and (a) applies the primary
 * color to the theme CSS vars, (b) exposes { app_name, logo_url, tagline, … } to
 * the app via context so auth screens + the sidebar render the agency's brand.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { applyBrandColor, applyBrandFont, applyFavicon, type Branding } from "@/lib/theme";
import { useSkin } from "@/components/skin-provider";

const BrandContext = createContext<Branding | null>(null);
export const useBranding = () => useContext(BrandContext);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Branding | null>(null);
  // Gate the first paint until branding is resolved + applied, so the app never
  // flashes the default skin/color and THEN swaps to the agency's (FOUC). Flips
  // true on success AND failure (never hangs) — a failed fetch falls back to the
  // built-in default, which is fine to show.
  const [ready, setReady] = useState(false);
  const { setAgencyDefaultSkin, setAgencyThemeConfig, setAgencyCustomCss } = useSkin();

  useEffect(() => {
    let alive = true;
    fetch("/api/branding")
      .then((r) => r.json())
      .then((res) => {
        if (!alive) return;
        const b: Branding = res?.data || res || {};
        setBranding(b);
        // Agency-configured skin becomes the default (unless the user picked one).
        setAgencyDefaultSkin(b.skin);
        // Token overrides (base/accent/chart/radius/fonts) on top of the skin.
        setAgencyThemeConfig(b.theme_config);
        // Uploaded custom CSS theme — overrides the skin when present.
        setAgencyCustomCss(b.custom_css);
        // When the agency uploaded a custom CSS theme, that file OWNS the colors
        // (its own --primary). Applying primary_color on top would clobber the
        // upload's accent (inline style beats the injected <style>), making the
        // upload look like it did nothing — so suppress the brand color in that
        // case. Passing null also clears any stuck inline --primary.
        const hasCustomCss = !!(b.custom_css && b.custom_css.trim());
        applyBrandColor(hasCustomCss ? null : b.primary_color);
        // Same for the agency's body font — stored + applied, and re-asserted after
        // any later skin/theme swap so the brand font always wins (fixes fonts not
        // matching across pages when only theme_config carried the font before).
        applyBrandFont(b.font_family, b.font_family_url);
        // Agency favicon + tab title (client-side; generateMetadata also sets these
        // server-side for the first paint / SEO — this covers SPA nav + freshness).
        applyFavicon(b.favicon_url);
        if (b.app_name) document.title = b.app_name;
      })
      .catch(() => {})
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BrandContext.Provider value={branding}>
      {/* Hold paint until the agency theme is applied. The splash is theme-neutral
          (uses --background/--foreground, which the applied theme also sets) so
          there's no color flash either way. */}
      {ready ? children : (
        <div className="min-h-screen grid place-items-center bg-background">
          <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin" aria-label="Loading" />
        </div>
      )}
    </BrandContext.Provider>
  );
}
