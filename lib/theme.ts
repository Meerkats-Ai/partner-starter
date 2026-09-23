/**
 * Runtime theming from the agency's branding. The Meerkats /branding endpoint
 * returns primary_color (+ app_name, logo_url…). We convert the hex to HSL and
 * set --primary / --ring so the whole shadcn theme rebrands automatically — no
 * rebuild, no per-agency fork. Falls back to the CSS defaults if unset.
 */

/** #rrggbb (or #rgb) → "H S% L%" for a CSS custom property. */
export function hexToHslString(hex: string): string | null {
  const m = hex.trim().replace(/^#/, "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// The agency's brand primary, remembered so applySkin can re-apply it as the LAST
// step of any skin/mode swap (applySkin resets --primary to the skin's value first).
let brandPrimaryHex: string | null = null;

/** Apply an agency's primary color to the document (client-side). */
export function applyBrandColor(primaryColorHex?: string | null) {
  brandPrimaryHex = primaryColorHex ?? null;
  if (typeof document === "undefined" || !primaryColorHex) return;
  const hsl = hexToHslString(primaryColorHex);
  if (!hsl) return;
  const root = document.documentElement;
  root.style.setProperty("--primary", hsl);
  root.style.setProperty("--ring", hsl);
}

import type { Skin } from "./themes/skins";

/**
 * Apply a full SKIN (all shadcn tokens) for the given mode. This re-colors the
 * whole app — every component reads these tokens via Tailwind. Sets the light OR
 * dark token set as inline vars on <html>, toggles the .dark class (so any
 * remaining dark:-prefixed utilities still resolve), and applies the skin font.
 *
 * A per-agency brand color (applyBrandColor) can be layered AFTER this to override
 * just --primary/--ring on top of the chosen skin.
 */
export function applySkin(skin: Skin, mode: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const tokens = mode === "dark" ? skin.dark : skin.light;

  for (const [name, value] of Object.entries(tokens)) {
    // `radius` maps to --radius; everything else is a color token named directly.
    root.style.setProperty(`--${name}`, value);
  }

  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;

  if (skin.font) {
    root.style.setProperty("--font-sans", skin.font);
    document.body.style.fontFamily = skin.font;
  } else {
    root.style.removeProperty("--font-sans");
    document.body.style.removeProperty("fontFamily");
  }

  // Inject the skin's web font once (idempotent by data attribute).
  if (skin.fontHref) {
    const existing = document.querySelector<HTMLLinkElement>(
      `link[data-skin-font="${skin.id}"]`
    );
    if (!existing) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = skin.fontHref;
      link.dataset.skinFont = skin.id;
      document.head.appendChild(link);
    }
  }

  // Re-apply the agency brand color LAST so it wins over the skin's --primary.
  if (brandPrimaryHex) {
    const hsl = hexToHslString(brandPrimaryHex);
    if (hsl) {
      root.style.setProperty("--primary", hsl);
      root.style.setProperty("--ring", hsl);
    }
  }
}

export interface Branding {
  app_name: string | null;
  tagline: string | null;
  logo_url: string | null;
  primary_color: string | null;
  support_email: string | null;
  /** Agency-chosen skin id (matches lib/themes/skins.ts). NULL = starter default. */
  skin?: string | null;
  /** Reserved for the multi-template phase. NULL = default shell. */
  template?: string | null;
  /** tweakcn-style token overrides (base/accent/chart/radius/fonts). */
  theme_config?: import("./themes/theme-config").ThemeConfig | null;
}
