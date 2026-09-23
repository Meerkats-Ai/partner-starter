/**
 * Skin registry — "same template, different skin".
 *
 * A SKIN is pure data: a full set of shadcn design tokens for light + dark. Because
 * every page/component in this starter consumes the shadcn tokens (via Tailwind
 * classes like bg-background / text-primary / border-border — see tailwind.config.ts
 * + globals.css), swapping a skin re-colors the ENTIRE app with zero component
 * changes. The template (sidebar + layout shell) is unchanged; only the tokens move.
 *
 * Token values are HSL triplets "H S% L%" (NOT wrapped in hsl()), so components can
 * do hsl(var(--primary) / <alpha>). This is the shadcn convention already used in
 * globals.css.
 *
 * To add a new skin from an HTML mockup: read its :root / [data-theme=dark] block,
 * convert each hex to an "H S% L%" triplet, and drop a new entry below. No code.
 *
 * Resolution today: SkinProvider reads the choice from localStorage (dev/preview).
 * Later (Phase 2) the choice comes from the agency's /branding config, resolved by
 * host — same registry, different source. The `classic` skin equals the current
 * globals.css defaults, so nothing regresses when a tenant has no skin set.
 */

/** The shadcn token names a skin fills. Keep in sync with globals.css + tailwind.config.ts. */
export type SkinTokens = {
  background: string;
  foreground: string;
  card: string;
  "card-foreground": string;
  popover: string;
  "popover-foreground": string;
  primary: string;
  "primary-foreground": string;
  secondary: string;
  "secondary-foreground": string;
  muted: string;
  "muted-foreground": string;
  accent: string;
  "accent-foreground": string;
  destructive: string;
  "destructive-foreground": string;
  border: string;
  input: string;
  ring: string;
  radius: string; // e.g. "0.6rem" — not HSL
};

export type Skin = {
  id: string;
  label: string;
  /** Optional web font family applied to --font-sans (falls back to system). */
  font?: string;
  /** Optional Google Fonts href to inject when this skin is active. */
  fontHref?: string;
  light: SkinTokens;
  dark: SkinTokens;
};

// ── classic ─────────────────────────────────────────────────────────────────
// The current default (globals.css indigo). Kept identical so an unset tenant
// looks exactly as before.
const classic: Skin = {
  id: "classic",
  label: "Classic Indigo",
  light: {
    background: "0 0% 100%",
    foreground: "240 10% 3.9%",
    card: "0 0% 100%",
    "card-foreground": "240 10% 3.9%",
    popover: "0 0% 100%",
    "popover-foreground": "240 10% 3.9%",
    primary: "244 75% 59%",
    "primary-foreground": "0 0% 100%",
    secondary: "240 4.8% 95.9%",
    "secondary-foreground": "240 5.9% 10%",
    muted: "240 4.8% 95.9%",
    "muted-foreground": "240 3.8% 46.1%",
    accent: "240 4.8% 95.9%",
    "accent-foreground": "240 5.9% 10%",
    destructive: "0 72% 51%",
    "destructive-foreground": "0 0% 100%",
    border: "240 5.9% 90%",
    input: "240 5.9% 90%",
    ring: "244 75% 59%",
    radius: "0.6rem",
  },
  dark: {
    background: "240 10% 3.9%",
    foreground: "0 0% 98%",
    card: "240 10% 5.5%",
    "card-foreground": "0 0% 98%",
    popover: "240 10% 5.5%",
    "popover-foreground": "0 0% 98%",
    primary: "244 75% 66%",
    "primary-foreground": "240 10% 3.9%",
    secondary: "240 3.7% 15.9%",
    "secondary-foreground": "0 0% 98%",
    muted: "240 3.7% 15.9%",
    "muted-foreground": "240 5% 64.9%",
    accent: "240 3.7% 15.9%",
    "accent-foreground": "0 0% 98%",
    destructive: "0 62.8% 50.6%",
    "destructive-foreground": "0 0% 98%",
    border: "240 3.7% 15.9%",
    input: "240 3.7% 15.9%",
    ring: "244 75% 66%",
    radius: "0.6rem",
  },
};

// ── lime ────────────────────────────────────────────────────────────────────
// Lifted from the "Digital Theory" mockups (login.html / app.html / explore.html):
// warm off-white paper in light, near-black panels in dark, lime accent (#a6e24c /
// #9bd431). The mockups' --panel/--line/--fg-dim map onto card/border/muted here.
const lime: Skin = {
  id: "lime",
  label: "Digital Theory Lime",
  font: '"Archivo", system-ui, -apple-system, "Segoe UI", sans-serif',
  fontHref:
    "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&display=swap",
  light: {
    background: "80 26% 92%", // #eef1e8 paper
    foreground: "84 30% 8%", // #14180e
    card: "0 0% 100%", // #ffffff panel
    "card-foreground": "84 30% 8%",
    popover: "0 0% 100%",
    "popover-foreground": "84 30% 8%",
    primary: "84 62% 40%", // #6aa81e accent-strong (readable on white)
    "primary-foreground": "84 42% 8%", // #10180a accent-ink
    secondary: "78 33% 96%", // #f6f8f1 panel-2
    "secondary-foreground": "90 12% 34%", // #5b6250 fg-dim
    muted: "78 33% 96%",
    "muted-foreground": "88 12% 45%", // #8a9179 fg-faint (bumped for contrast)
    accent: "82 63% 51%", // #9bd431 accent
    "accent-foreground": "84 42% 8%",
    destructive: "9 66% 51%", // #d6452f bad
    "destructive-foreground": "0 0% 100%",
    border: "84 24% 88%", // #e2e7d8 line
    input: "84 24% 88%",
    ring: "82 63% 51%",
    radius: "0.75rem",
  },
  dark: {
    background: "120 4% 4%", // #0a0b0a ink
    foreground: "84 26% 94%", // #f1f4ec
    card: "120 5% 7%", // #111311 panel
    "card-foreground": "84 26% 94%",
    popover: "120 5% 7%",
    "popover-foreground": "84 26% 94%",
    primary: "82 71% 59%", // #a6e24c accent
    "primary-foreground": "84 60% 6%", // #0c1204 accent-ink
    secondary: "90 8% 10%", // #171a15 panel-2
    "secondary-foreground": "84 26% 94%",
    muted: "90 8% 10%",
    "muted-foreground": "84 6% 60%", // #9aa091 fg-dim
    accent: "82 71% 59%",
    "accent-foreground": "84 60% 6%",
    destructive: "6 100% 71%", // #ff7a6b bad
    "destructive-foreground": "84 60% 6%",
    border: "96 8% 15%", // #262b23 line
    input: "96 8% 15%",
    ring: "82 71% 59%",
    radius: "0.75rem",
  },
};

// ── slate-amber ─────────────────────────────────────────────────────────────
// Matches the generator preview on the API-Keys page (Slate base · Amber accent).
// Neutral slate surfaces + a warm amber primary.
const slateAmber: Skin = {
  id: "slate-amber",
  label: "Slate · Amber",
  light: {
    background: "0 0% 100%",
    foreground: "222 47% 11%", // slate-900
    card: "0 0% 100%",
    "card-foreground": "222 47% 11%",
    popover: "0 0% 100%",
    "popover-foreground": "222 47% 11%",
    primary: "38 92% 50%", // amber-500
    "primary-foreground": "26 83% 14%", // amber-950 ink
    secondary: "210 40% 96%", // slate-100
    "secondary-foreground": "222 47% 11%",
    muted: "210 40% 96%",
    "muted-foreground": "215 16% 47%", // slate-500
    accent: "210 40% 96%",
    "accent-foreground": "222 47% 11%",
    destructive: "0 72% 51%",
    "destructive-foreground": "0 0% 100%",
    border: "214 32% 91%", // slate-200
    input: "214 32% 91%",
    ring: "38 92% 50%",
    radius: "0.5rem",
  },
  dark: {
    background: "222 47% 8%", // slate-950-ish
    foreground: "210 40% 98%",
    card: "222 44% 11%", // slate-900
    "card-foreground": "210 40% 98%",
    popover: "222 44% 11%",
    "popover-foreground": "210 40% 98%",
    primary: "38 92% 55%", // amber, brighter for dark
    "primary-foreground": "26 83% 12%",
    secondary: "217 33% 17%", // slate-800
    "secondary-foreground": "210 40% 98%",
    muted: "217 33% 17%",
    "muted-foreground": "215 20% 65%", // slate-400
    accent: "217 33% 17%",
    "accent-foreground": "210 40% 98%",
    destructive: "0 63% 51%",
    "destructive-foreground": "210 40% 98%",
    border: "217 33% 20%",
    input: "217 33% 20%",
    ring: "38 92% 55%",
    radius: "0.5rem",
  },
};

// ── Generated presets ───────────────────────────────────────────────────────
// The 3 hand-tuned skins above are the reference. The rest are generated from a
// compact spec (neutral hue/sat + accent HSL + radius/font) so adding a named
// "style" is one line. makeSkin() derives the full light+dark token set the same
// way the hand-tuned ones are shaped.
function makeSkin(spec: {
  id: string;
  label: string;
  nHue: number; // neutral hue
  nSat: number; // neutral saturation
  aLight: string; // accent HSL for light
  aDark: string; // accent HSL for dark
  ink?: string; // primary-foreground (on-accent)
  radius?: string;
  font?: string;
  fontHref?: string;
}): Skin {
  const { nHue: h, nSat: s } = spec;
  const ink = spec.ink ?? "0 0% 100%";
  const radius = spec.radius ?? "0.6rem";
  return {
    id: spec.id,
    label: spec.label,
    font: spec.font,
    fontHref: spec.fontHref,
    light: {
      background: "0 0% 100%",
      foreground: `${h} ${s}% 10%`,
      card: "0 0% 100%",
      "card-foreground": `${h} ${s}% 10%`,
      popover: "0 0% 100%",
      "popover-foreground": `${h} ${s}% 10%`,
      primary: spec.aLight,
      "primary-foreground": ink,
      secondary: `${h} ${s}% 96%`,
      "secondary-foreground": `${h} ${s}% 12%`,
      muted: `${h} ${s}% 96%`,
      "muted-foreground": `${h} ${Math.max(s - 2, 4)}% 45%`,
      accent: `${h} ${s}% 96%`,
      "accent-foreground": `${h} ${s}% 12%`,
      destructive: "0 72% 51%",
      "destructive-foreground": "0 0% 100%",
      border: `${h} ${s}% 90%`,
      input: `${h} ${s}% 90%`,
      ring: spec.aLight,
      radius,
    },
    dark: {
      background: `${h} ${s}% 6%`,
      foreground: `${h} ${Math.min(s + 6, 40)}% 96%`,
      card: `${h} ${s}% 9%`,
      "card-foreground": `${h} ${Math.min(s + 6, 40)}% 96%`,
      popover: `${h} ${s}% 9%`,
      "popover-foreground": `${h} ${Math.min(s + 6, 40)}% 96%`,
      primary: spec.aDark,
      "primary-foreground": ink,
      secondary: `${h} ${s}% 15%`,
      "secondary-foreground": `${h} ${Math.min(s + 6, 40)}% 96%`,
      muted: `${h} ${s}% 15%`,
      "muted-foreground": `${h} ${s}% 64%`,
      accent: `${h} ${s}% 15%`,
      "accent-foreground": `${h} ${Math.min(s + 6, 40)}% 96%`,
      destructive: "0 63% 51%",
      "destructive-foreground": "0 0% 98%",
      border: `${h} ${s}% 18%`,
      input: `${h} ${s}% 18%`,
      ring: spec.aDark,
      radius,
    },
  };
}

const midnight = makeSkin({ id: "midnight", label: "Midnight Blue", nHue: 222, nSat: 16, aLight: "217 91% 60%", aDark: "217 91% 66%", radius: "0.5rem" });
const emerald = makeSkin({ id: "emerald", label: "Emerald", nHue: 160, nSat: 8, aLight: "160 84% 39%", aDark: "160 84% 45%", ink: "160 90% 8%", radius: "0.75rem" });
const rose = makeSkin({ id: "rose", label: "Rose", nHue: 350, nSat: 8, aLight: "347 77% 50%", aDark: "347 77% 60%", radius: "1rem" });
const violet = makeSkin({ id: "violet", label: "Violet", nHue: 265, nSat: 10, aLight: "258 90% 60%", aDark: "258 90% 66%", radius: "0.625rem" });
const sand = makeSkin({ id: "sand", label: "Sand", nHue: 40, nSat: 10, aLight: "25 95% 45%", aDark: "25 95% 55%", ink: "20 90% 10%", radius: "0.5rem" });
const ocean = makeSkin({ id: "ocean", label: "Ocean", nHue: 200, nSat: 14, aLight: "189 94% 38%", aDark: "189 94% 48%", ink: "190 90% 8%", radius: "0.75rem" });
// Mono uses white text on a dark-gray accent in BOTH modes (dark accent kept dark
// enough for white ink to stay legible) — avoids the near-white-on-white trap.
const mono = makeSkin({ id: "mono", label: "Mono", nHue: 0, nSat: 0, aLight: "0 0% 18%", aDark: "0 0% 30%", ink: "0 0% 100%", radius: "0.375rem" });

export const SKINS: Skin[] = [
  classic, lime, slateAmber, midnight, emerald, rose, violet, sand, ocean, mono,
];

export const DEFAULT_SKIN_ID = "classic";

export function getSkin(id: string | null | undefined): Skin {
  return SKINS.find((s) => s.id === id) || classic;
}
