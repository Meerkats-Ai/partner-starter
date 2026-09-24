/**
 * theme_config — the tweakcn-style TOKEN override layer.
 *
 * A SKIN (skins.ts) is a full curated preset. A theme_config is a smaller set of
 * INDEPENDENT knobs the agency tweaks ON TOP of / instead of a skin: base neutral
 * scale, accent hue, chart hue, radius, and heading/body fonts. applyThemeConfig()
 * turns a config into the same shadcn CSS variables the app already consumes, so
 * every page re-themes with no component change — exactly like applySkin.
 *
 * Persistence: stored as apps.theme_config (jsonb) and returned by /branding. The
 * customizer edits it; the partner app applies it live (preview) and on load.
 *
 * Precedence at apply time (later wins):
 *   1. skin preset (applySkin)        — the base look
 *   2. theme_config (applyThemeConfig) — base/accent/chart/radius/fonts overrides
 *   3. brand accent (applyBrandColor)  — legacy primary_color, still wins if set
 */

import { reassertBrandFont } from "@/lib/theme";

export type ThemeConfig = {
  base?: string;    // neutral scale id  (BASE_COLORS)
  accent?: string;  // accent hue id     (ACCENT_COLORS)
  chart?: string;   // chart hue id      (ACCENT_COLORS, reused)
  radius?: number;  // rem
  headingFont?: string; // FONTS id
  bodyFont?: string;    // FONTS id
};

// ── Base neutral scales (tweakcn "Base Color") ──────────────────────────────
// Each provides the surface + text ramp as shadcn tokens (light + dark). Values
// are "H S% L%" triplets. Only the neutral family changes here; accent is separate.
type Ramp = {
  background: string; foreground: string;
  card: string; cardForeground: string;
  muted: string; mutedForeground: string;
  border: string; secondary: string; secondaryForeground: string;
};
type BaseColor = { id: string; label: string; light: Ramp; dark: Ramp };

const ramp = (hue: number, sat: number): { light: Ramp; dark: Ramp } => ({
  light: {
    background: "0 0% 100%",
    foreground: `${hue} ${sat}% 10%`,
    card: "0 0% 100%",
    cardForeground: `${hue} ${sat}% 10%`,
    muted: `${hue} ${sat}% 96%`,
    mutedForeground: `${hue} ${Math.max(sat - 4, 4)}% 45%`,
    border: `${hue} ${sat}% 90%`,
    secondary: `${hue} ${sat}% 96%`,
    secondaryForeground: `${hue} ${sat}% 12%`,
  },
  dark: {
    background: `${hue} ${sat}% 6%`,
    foreground: `${hue} ${Math.min(sat + 6, 40)}% 96%`,
    card: `${hue} ${sat}% 9%`,
    cardForeground: `${hue} ${Math.min(sat + 6, 40)}% 96%`,
    muted: `${hue} ${sat}% 15%`,
    mutedForeground: `${hue} ${sat}% 64%`,
    border: `${hue} ${sat}% 18%`,
    secondary: `${hue} ${sat}% 15%`,
    secondaryForeground: `${hue} ${Math.min(sat + 6, 40)}% 96%`,
  },
});

export const BASE_COLORS: BaseColor[] = [
  { id: "neutral", label: "Neutral", ...ramp(0, 0) },
  { id: "stone", label: "Stone", ...ramp(30, 6) },
  { id: "zinc", label: "Zinc", ...ramp(240, 5) },
  { id: "gray", label: "Gray", ...ramp(220, 9) },
  { id: "slate", label: "Slate", ...ramp(215, 16) },
  { id: "mauve", label: "Mauve", ...ramp(300, 6) },
  { id: "olive", label: "Olive", ...ramp(80, 8) },
  { id: "taupe", label: "Taupe", ...ramp(40, 8) },
];

// ── Accent / chart hues (tweakcn "Theme" + "Chart Color") ───────────────────
// A single vivid hue used for --primary (accent) or the chart bars (chart).
export type AccentColor = { id: string; label: string; hex: string; light: string; dark: string; ink: string };
const accent = (id: string, label: string, hex: string, l: string, d: string, ink = "0 0% 100%"): AccentColor =>
  ({ id, label, hex, light: l, dark: d, ink });

export const ACCENT_COLORS: AccentColor[] = [
  accent("indigo", "Indigo", "#4f46e5", "244 75% 59%", "244 75% 66%"),
  accent("blue", "Blue", "#3b82f6", "217 91% 60%", "217 91% 66%"),
  accent("cyan", "Cyan", "#06b6d4", "189 94% 43%", "189 94% 50%", "190 90% 8%"),
  accent("emerald", "Emerald", "#10b981", "160 84% 39%", "160 84% 45%", "160 90% 8%"),
  accent("green", "Green", "#22c55e", "142 71% 45%", "142 71% 50%", "142 90% 8%"),
  accent("lime", "Lime", "#84cc16", "82 71% 45%", "82 71% 55%", "84 60% 8%"),
  accent("amber", "Amber", "#f59e0b", "38 92% 50%", "38 92% 55%", "26 83% 12%"),
  accent("orange", "Orange", "#f97316", "25 95% 53%", "25 95% 58%", "20 90% 10%"),
  accent("red", "Red", "#ef4444", "0 84% 60%", "0 84% 66%"),
  accent("rose", "Rose", "#f43f5e", "347 77% 60%", "347 77% 66%"),
  accent("pink", "Pink", "#ec4899", "330 81% 60%", "330 81% 66%"),
  accent("fuchsia", "Fuchsia", "#d946ef", "292 84% 61%", "292 84% 66%"),
  accent("violet", "Violet", "#8b5cf6", "258 90% 66%", "258 90% 70%"),
  accent("neutral", "Neutral", "#71717a", "240 4% 46%", "240 5% 65%"),
];

// ── Fonts (tweakcn "Heading" / "Font") ──────────────────────────────────────
export type FontDef = { id: string; label: string; stack: string; href?: string };
const g = (fam: string) =>
  `https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, "+")}:wght@400;500;600;700;800&display=swap`;

export const FONTS: FontDef[] = [
  { id: "inter", label: "Inter", stack: '"Inter", system-ui, sans-serif', href: g("Inter") },
  { id: "geist", label: "Geist", stack: '"Geist", system-ui, sans-serif', href: g("Geist") },
  { id: "system", label: "System", stack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { id: "roboto", label: "Roboto", stack: '"Roboto", system-ui, sans-serif', href: g("Roboto") },
  { id: "noto-sans", label: "Noto Sans", stack: '"Noto Sans", system-ui, sans-serif', href: g("Noto Sans") },
  { id: "nunito-sans", label: "Nunito Sans", stack: '"Nunito Sans", system-ui, sans-serif', href: g("Nunito Sans") },
  { id: "figtree", label: "Figtree", stack: '"Figtree", system-ui, sans-serif', href: g("Figtree") },
  { id: "raleway", label: "Raleway", stack: '"Raleway", system-ui, sans-serif', href: g("Raleway") },
  { id: "dm-sans", label: "DM Sans", stack: '"DM Sans", system-ui, sans-serif', href: g("DM Sans") },
  { id: "public-sans", label: "Public Sans", stack: '"Public Sans", system-ui, sans-serif', href: g("Public Sans") },
  { id: "outfit", label: "Outfit", stack: '"Outfit", system-ui, sans-serif', href: g("Outfit") },
  { id: "archivo", label: "Archivo", stack: '"Archivo", system-ui, sans-serif', href: g("Archivo") },
];

export const RADII = [0, 0.25, 0.375, 0.5, 0.625, 0.75, 1] as const;

// ── Lookups ─────────────────────────────────────────────────────────────────
export const getBaseColor = (id?: string) => BASE_COLORS.find((b) => b.id === id);
export const getAccent = (id?: string) => ACCENT_COLORS.find((a) => a.id === id);
export const getFont = (id?: string) => FONTS.find((f) => f.id === id);

function injectFont(font?: FontDef) {
  if (typeof document === "undefined" || !font?.href) return;
  if (document.querySelector(`link[data-mk-font="${font.id}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = font.href;
  link.dataset.mkFont = font.id;
  document.head.appendChild(link);
}

/**
 * Apply a theme_config's token overrides for the given mode. Only the knobs that
 * are set take effect (others leave the underlying skin values untouched).
 */
export function applyThemeConfig(cfg: ThemeConfig | null | undefined, mode: "light" | "dark") {
  if (typeof document === "undefined" || !cfg) return;
  const root = document.documentElement;
  const dark = mode === "dark";
  const setv = (name: string, v: string) => root.style.setProperty(name, v);

  // Base neutral scale → surfaces + text + border + secondary + muted.
  const base = getBaseColor(cfg.base);
  if (base) {
    const r = dark ? base.dark : base.light;
    setv("--background", r.background);
    setv("--foreground", r.foreground);
    setv("--card", r.card);
    setv("--card-foreground", r.cardForeground);
    setv("--popover", r.card);
    setv("--popover-foreground", r.cardForeground);
    setv("--muted", r.muted);
    setv("--muted-foreground", r.mutedForeground);
    setv("--accent", r.muted);
    setv("--accent-foreground", r.secondaryForeground);
    setv("--secondary", r.secondary);
    setv("--secondary-foreground", r.secondaryForeground);
    setv("--border", r.border);
    setv("--input", r.border);
  }

  // Accent hue → primary + ring.
  const acc = getAccent(cfg.accent);
  if (acc) {
    setv("--primary", dark ? acc.dark : acc.light);
    setv("--primary-foreground", acc.ink);
    setv("--ring", dark ? acc.dark : acc.light);
  }

  // Chart hue → --chart-1 (the preview bars read --primary today, but expose this
  // for components that use a dedicated chart token).
  const chart = getAccent(cfg.chart);
  if (chart) setv("--chart-1", dark ? chart.dark : chart.light);

  // Radius.
  if (typeof cfg.radius === "number") setv("--radius", `${cfg.radius}rem`);

  // Fonts (body + heading). Body drives --font-sans + body font-family.
  const body = getFont(cfg.bodyFont);
  if (body) {
    injectFont(body);
    setv("--font-sans", body.stack);
    document.body.style.fontFamily = body.stack;
  }
  const heading = getFont(cfg.headingFont);
  if (heading) {
    injectFont(heading);
    setv("--font-heading", heading.stack);
  }

  // An explicit agency font_family (applyBrandFont) still wins over theme_config's
  // bodyFont, so re-assert it as the last step (mirrors the brand-color precedence).
  reassertBrandFont();
}
