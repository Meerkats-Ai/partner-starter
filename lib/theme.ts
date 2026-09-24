/**
 * Runtime theming from the agency's branding. The Meerkats /branding endpoint
 * returns primary_color (+ app_name, logo_url…). We convert the hex to HSL and
 * set --primary / --ring so the whole shadcn theme rebrands automatically — no
 * rebuild, no per-agency fork. Falls back to the CSS defaults if unset.
 */
import { normalizeCssColors } from "./themes/parse-css-theme";

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
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Clearing: REMOVE the inline override so a lower layer (skin / injected custom
  // CSS :root{}) shows through. Without this, a previously-set inline --primary
  // stays stuck and keeps winning over an uploaded theme's own --primary.
  if (!primaryColorHex) {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
    return;
  }
  const hsl = hexToHslString(primaryColorHex);
  if (!hsl) return;
  root.style.setProperty("--primary", hsl);
  root.style.setProperty("--ring", hsl);
}

// The agency's brand font stack, remembered so applySkin/applyThemeConfig can
// re-assert it as the LAST step of any theme swap (like brandPrimaryHex), so the
// agency font always wins over a skin/theme_config font.
let brandFontStack: string | null = null;

/**
 * Apply an agency's body-font stack to the document (client-side). Sets --font-sans
 * and body font-family so the WHOLE app (which reads font-sans → var(--font-sans))
 * re-fonts, and injects the webfont stylesheet if a url is given. Mirrors
 * applyBrandColor. A falsy stack leaves the skin/theme_config/default font in place.
 */
export function applyBrandFont(fontStack?: string | null, fontUrl?: string | null) {
  brandFontStack = fontStack ?? null;
  if (typeof document === "undefined" || !fontStack) return;
  // Inject the webfont href once (idempotent) so the family actually renders.
  // Reuse OUR OWN tagged link and only update its href — never removeChild (keeps
  // us clear of React's head manager and avoids DOM churn).
  if (fontUrl) {
    let link = document.querySelector<HTMLLinkElement>("link[data-brand-font]");
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset.brandFont = "1";
      document.head.appendChild(link);
    }
    if (link.href !== fontUrl) link.href = fontUrl;
  }
  const root = document.documentElement;
  root.style.setProperty("--font-sans", fontStack);
  document.body.style.fontFamily = fontStack;
}

/** Re-assert the agency brand font after a skin/theme_config swap (internal). */
export function reassertBrandFont() {
  if (typeof document === "undefined" || !brandFontStack) return;
  document.documentElement.style.setProperty("--font-sans", brandFontStack);
  document.body.style.fontFamily = brandFontStack;
}

/**
 * Swap the browser-tab favicon to the agency's, client-side. Rewrites (or creates)
 * the <link rel="icon"> in <head>. A falsy url leaves the starter's default in place.
 */
export function applyFavicon(faviconUrl?: string | null) {
  if (typeof document === "undefined" || !faviconUrl) return;
  const head = document.head;
  // Reuse OUR OWN tagged icon link (never touch links React/Next rendered from
  // generateMetadata — removing a React-owned node makes its parentNode null and
  // crashes the reconciler on its next unmount: "removeChild … parentNode is null").
  let link = head.querySelector<HTMLLinkElement>('link[data-brand-favicon]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.dataset.brandFavicon = "1";
    head.appendChild(link);
  }
  link.href = faviconUrl;
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
  // ...and the agency brand font, so it wins over the skin's font.
  reassertBrandFont();
}

/**
 * Apply an uploaded custom theme (parsed from a tweakcn/shadcn CSS export) as the
 * token set for `mode`. Same mechanism as applySkin but sourced from the parsed
 * tokens; used when the agency uploaded custom_css (which OVERRIDES the preset skin).
 * Falls back gracefully: only sets tokens the parse produced. Brand color still wins.
 */
export function applyParsedCustomTheme(
  parsed: { light: Record<string, string>; dark: Record<string, string>; radius?: string },
  mode: "light" | "dark",
) {
  if (typeof document === "undefined" || !parsed) return;
  const root = document.documentElement;
  const tokens = mode === "dark" ? parsed.dark : parsed.light;
  for (const [name, value] of Object.entries(tokens || {})) {
    root.style.setProperty(`--${name}`, value);
  }
  if (parsed.radius) root.style.setProperty("--radius", parsed.radius);
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  // Brand color override still wins over the custom theme's --primary.
  if (brandPrimaryHex) {
    const hsl = hexToHslString(brandPrimaryHex);
    if (hsl) {
      root.style.setProperty("--primary", hsl);
      root.style.setProperty("--ring", hsl);
    }
  }
  reassertBrandFont();
}

// The id of the injected agency-theme <style> tag (single, reused/replaced).
const CUSTOM_CSS_STYLE_ID = "agency-custom-theme";

/**
 * Apply an uploaded custom theme by INJECTING THE WHOLE FILE as a <style> tag,
 * rather than extracting a fixed 19-token set. The agency's raw CSS (custom_css)
 * is normalized so every `--token: <color>` value becomes the "H S% L%" triplet the
 * app's `hsl(var(--token))` Tailwind expects — but ALL of the file survives: extra
 * tokens (--chart-*, --sidebar-*, --radius), @font-face, comments, non-color props.
 *
 * This is the "load the full CSS file" path (vs applyParsedCustomTheme's lossy
 * token extraction). The file's own :root{} / .dark{} selectors do the theming, so
 * we do NOT set per-token inline styles here. We DO toggle .dark for the mode (so
 * the file's .dark block + any dark:-utilities resolve).
 *
 * The uploaded file OWNS the colors. An inline style on <html> (e.g. a stray
 * --primary from applyBrandColor / an earlier applySkin re-assert) would beat this
 * injected <style> and make the upload look like it did nothing — so we REMOVE any
 * inline --primary/--ring here, making the result independent of effect ordering.
 * (The caller decides whether a brand accent should still layer on top by calling
 * applyBrandColor AFTER this; by default custom CSS wins.)
 *
 * Idempotent: reuses one <style id="agency-custom-theme"> element, replacing its
 * contents. Passing empty/null removes it (revert to the base skin).
 */
export function applyCustomCssRaw(rawCss: string | null | undefined, mode: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const head = document.head;
  let styleEl = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null;

  if (!rawCss || !rawCss.trim()) {
    // No custom CSS — remove any previously injected theme (our own node only).
    styleEl?.remove();
    return;
  }

  // Normalize color VALUES to triplets; keep every selector/declaration.
  const normalized = normalizeCssColors(rawCss);

  // Append our <style> ONCE, then only update its text. Do NOT re-append on every
  // call to "keep it last" — that thrashes <head> and can race Next's React-owned
  // head manager (→ "removeChild … parentNode is null"). It's a plain <style> we
  // own; ordering after globals.css holds because it's appended after first paint,
  // and our overrides use higher specificity / !important where they must win.
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = CUSTOM_CSS_STYLE_ID;
    styleEl.setAttribute("data-agency-theme", "1");
    head.appendChild(styleEl);
  }
  if (styleEl.textContent !== normalized) styleEl.textContent = normalized;

  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;

  // Let the injected file's --primary/--ring win: drop any inline overrides that
  // an earlier applyBrandColor / applySkin re-assert may have left on <html>.
  root.style.removeProperty("--primary");
  root.style.removeProperty("--ring");
}

export interface Branding {
  app_name: string | null;
  tagline: string | null;
  logo_url: string | null;
  /** Browser-tab icon URL. NULL = starter default favicon. */
  favicon_url?: string | null;
  primary_color: string | null;
  support_email: string | null;
  /** Agency-chosen skin id (matches lib/themes/skins.ts). NULL = starter default. */
  skin?: string | null;
  /** Reserved for the multi-template phase. NULL = default shell. */
  template?: string | null;
  /** tweakcn-style token overrides (base/accent/chart/radius/fonts). */
  theme_config?: import("./themes/theme-config").ThemeConfig | null;
  /** Uploaded tweakcn/shadcn CSS export (raw text). When set it OVERRIDES the skin. */
  custom_css?: string | null;
  /** Agency body-font CSS stack applied to --font-sans at runtime. NULL = default. */
  font_family?: string | null;
  /** Optional webfont stylesheet href (e.g. Google Fonts) for font_family. */
  font_family_url?: string | null;
}
