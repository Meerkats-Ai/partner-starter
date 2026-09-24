/**
 * parse-css-theme — turn a tweakcn / shadcn "CSS variables" theme export into the
 * starter's Skin token shape.
 *
 * The starter's Tailwind reads every color as `hsl(var(--token))`, so tokens MUST be
 * bare HSL triplets ("H S% L%"), NOT full colors. A tweakcn export instead writes
 * complete color values (`oklch(0.5 0.2 320)`, `hsl(...)`, `#rrggbb`, `rgb(...)`).
 * This module extracts the `:root {}` (light) and `.dark {}` (dark) `--token: value`
 * pairs and converts each color to the triplet, so the parsed result can drive the
 * existing skin engine (applySkin) with zero component changes.
 *
 * We only keep the tokens the starter actually consumes (see CORE_TOKENS); sidebar/
 * chart tokens in the export are ignored. `--radius` passes through as-is (a length).
 *
 * Pure + dependency-free so it runs identically in the browser (customizer preview),
 * the starter (SkinProvider), and Node.
 */

// The shadcn tokens the starter's Tailwind/globals actually use.
const CORE_TOKENS = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground",
  "muted", "muted-foreground", "accent", "accent-foreground",
  "destructive", "destructive-foreground", "border", "input", "ring",
] as const;

export interface ParsedThemeTokens {
  [k: string]: string; // token name → "H S% L%" (colors) or raw (radius)
}
export interface ParsedTheme {
  light: ParsedThemeTokens;
  dark: ParsedThemeTokens;
  radius?: string;
  /** true if we recognized at least a few core tokens (a plausible theme file). */
  ok: boolean;
}

// ── color → { h, s, l } (0–360, 0–100, 0–100) ────────────────────────────────

function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

// oklch → linear sRGB → sRGB (0–255). Formula per the CSS Color 4 / Björn Ottosson.
function oklchToRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  let R = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const toSrgb = (c: number) => {
    c = clamp(c, 0, 1);
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return [Math.round(toSrgb(R) * 255), Math.round(toSrgb(G) * 255), Math.round(toSrgb(B) * 255)];
}

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function fmtTriplet(h: number, s: number, l: number): string {
  const r = (n: number, d = 0) => {
    const f = Math.round(n * 10 ** d) / 10 ** d;
    return String(f);
  };
  return `${r(h, 1)} ${r(s, 1)}% ${r(l, 1)}%`;
}

/**
 * Convert one CSS color value to the starter's "H S% L%" triplet. Handles:
 *   oklch(L C H [/ a]) · hsl(H S% L% [/ a]) / "H S% L%" · #hex · rgb(r,g,b)
 * Alpha is dropped (the starter applies alpha via hsl(var(--x) / <a>) at use sites).
 * Returns null if it can't parse (caller then skips that token).
 */
export function toHslTriplet(value: string): string | null {
  const v = value.trim().replace(/;+$/, "");
  if (!v) return null;

  // Already a bare triplet: "H S% L%"
  const bare = v.match(/^(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%$/);
  if (bare) return `${bare[1]} ${bare[2]}% ${bare[3]}%`;

  // oklch(L C H [/ a]) — L may be 0–1 or a %; C unitless; H degrees.
  const ok = v.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.%]+)?\s*\)$/i);
  if (ok) {
    const L = ok[1].endsWith("%") ? parseFloat(ok[1]) / 100 : parseFloat(ok[1]);
    const [r, g, b] = oklchToRgb(L, parseFloat(ok[2]), parseFloat(ok[3]));
    const [h, s, l] = rgbToHsl(r, g, b);
    return fmtTriplet(h, s, l);
  }

  // hsl(H S% L% [/ a]) or hsl(H, S%, L%)
  const hsl = v.match(/^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+(-?[\d.]+)%[\s,]+(-?[\d.]+)%/i);
  if (hsl) return `${hsl[1]} ${hsl[2]}% ${hsl[3]}%`;

  // rgb(r, g, b [/ a])
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) {
    const [h, s, l] = rgbToHsl(parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3]));
    return fmtTriplet(h, s, l);
  }

  // #hex
  if (v.startsWith("#")) {
    const rgbv = hexToRgb(v);
    if (rgbv) { const [h, s, l] = rgbToHsl(...rgbv); return fmtTriplet(h, s, l); }
  }

  return null;
}

/** Pull the `--token: value;` declarations out of one CSS rule body. */
function declsFromBlock(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out[m[1].trim()] = m[2].trim();
  return out;
}

/**
 * Extract the body of the first rule whose selector list contains `selector` (a
 * LITERAL like ":root" or ".dark"). Brace-matched so nested/adjacent rules don't
 * confuse it. Matches the selector followed (possibly via a selector list) by "{".
 */
function ruleBody(css: string, selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // <selector> then any non-brace chars (rest of the selector list) then "{".
  const re = new RegExp(`${esc}[^{}]*\\{`);
  const m = re.exec(css);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1, i = start;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
  }
  return css.slice(start, i - 1);
}

/**
 * Parse a tweakcn/shadcn CSS export into { light, dark, radius, ok }. Strips comments
 * first. If there's no `.dark` block, dark falls back to light so mode-toggling is safe.
 */
export function parseCssTheme(cssRaw: string): ParsedTheme {
  const css = String(cssRaw || "").replace(/\/\*[\s\S]*?\*\//g, ""); // strip /* */ comments
  const rootBody = ruleBody(css, ":root") || "";
  const darkBody = ruleBody(css, ".dark") || "";
  const rootDecls = declsFromBlock(rootBody);
  const darkDecls = declsFromBlock(darkBody);

  const convert = (decls: Record<string, string>): ParsedThemeTokens => {
    const out: ParsedThemeTokens = {};
    for (const t of CORE_TOKENS) {
      const raw = decls[t];
      if (raw == null) continue;
      const triplet = toHslTriplet(raw);
      if (triplet) out[t] = triplet;
    }
    return out;
  };

  const light = convert(rootDecls);
  const darkRaw = convert(darkDecls);
  // Dark inherits any light token it didn't override.
  const dark: ParsedThemeTokens = { ...light, ...darkRaw };

  const radius = rootDecls["radius"] || darkDecls["radius"] || undefined;
  // Consider it a real theme file if we resolved the essentials.
  const ok = !!(light.background && light.foreground && light.primary);

  return { light, dark, radius, ok };
}
