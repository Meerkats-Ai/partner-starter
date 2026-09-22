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

/** Apply an agency's primary color to the document (client-side). */
export function applyBrandColor(primaryColorHex?: string | null) {
  if (typeof document === "undefined" || !primaryColorHex) return;
  const hsl = hexToHslString(primaryColorHex);
  if (!hsl) return;
  const root = document.documentElement;
  root.style.setProperty("--primary", hsl);
  root.style.setProperty("--ring", hsl);
}

export interface Branding {
  app_name: string | null;
  tagline: string | null;
  logo_url: string | null;
  primary_color: string | null;
  support_email: string | null;
}
