"use client";
/**
 * SkinProvider — "same template, different skin".
 *
 * Resolves the active skin + light/dark mode and applies the full shadcn token set
 * to the document, so every page re-colors with no component changes. Today the
 * choice is read from localStorage (dev/preview + a visible switcher). Later the
 * default skin will come from the agency's /branding config resolved by host; the
 * registry (lib/themes/skins.ts) stays the same, only the source changes.
 *
 * Order of application:
 *   1. applySkin(skin, mode)      — full token set for the skin
 *   2. applyBrandColor(primary)   — optional per-agency --primary override on top
 * (2) is done by BrandProvider after branding loads, so the agency's brand color
 * still wins over the skin's primary. Re-applied whenever skin/mode changes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { applySkin } from "@/lib/theme";
import { SKINS, getSkin, DEFAULT_SKIN_ID, type Skin } from "@/lib/themes/skins";
import { applyThemeConfig, type ThemeConfig } from "@/lib/themes/theme-config";

type Mode = "light" | "dark";

interface SkinContextValue {
  skin: Skin;
  skinId: string;
  mode: Mode;
  skins: Skin[];
  setSkinId: (id: string) => void;
  setMode: (mode: Mode) => void;
  toggleMode: () => void;
  /**
   * Set the skin coming from the agency's /branding config. Only wins if the user
   * hasn't explicitly picked a skin in THIS browser (no localStorage override), so
   * a personal choice via the switcher is never clobbered by the agency default.
   */
  setAgencyDefaultSkin: (id: string | null | undefined) => void;
  /** Apply the agency's theme_config token overrides (from /branding). */
  setAgencyThemeConfig: (cfg: ThemeConfig | null | undefined) => void;
}

const SkinContext = createContext<SkinContextValue | null>(null);
export const useSkin = () => {
  const ctx = useContext(SkinContext);
  if (!ctx) throw new Error("useSkin must be used within <SkinProvider>");
  return ctx;
};

const SKIN_KEY = "mk.skin";
const MODE_KEY = "mk.mode";

/** Default the skin/mode override BEFORE a chosen agency default exists. */
export function SkinProvider({
  children,
  defaultSkinId = DEFAULT_SKIN_ID,
  defaultMode = "light",
}: {
  children: React.ReactNode;
  defaultSkinId?: string;
  defaultMode?: Mode;
}) {
  const [skinId, setSkinIdState] = useState(defaultSkinId);
  const [mode, setModeState] = useState<Mode>(defaultMode);
  // Agency token overrides (base/accent/chart/radius/fonts) applied on top of skin.
  const [themeConfig, setThemeConfig] = useState<ThemeConfig | null>(null);

  // Hydrate ONLY the mode from localStorage (a legit per-user preference). The
  // SKIN is agency-authoritative (set from /branding), so we do NOT restore a
  // stale per-browser skin — and we clear any left over from an old build.
  useEffect(() => {
    localStorage.removeItem(SKIN_KEY);
    const savedMode = localStorage.getItem(MODE_KEY) as Mode | null;
    if (savedMode === "light" || savedMode === "dark") setModeState(savedMode);
  }, []);

  const skin = useMemo(() => getSkin(skinId), [skinId]);

  // Apply whenever skin, mode, or theme_config changes: skin first, then the
  // token overrides on top.
  useEffect(() => {
    applySkin(skin, mode);
    applyThemeConfig(themeConfig, mode);
  }, [skin, mode, themeConfig]);

  const setSkinId = useCallback((id: string) => {
    setSkinIdState(id);
    localStorage.setItem(SKIN_KEY, id);
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    localStorage.setItem(MODE_KEY, m);
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((m) => {
      const next = m === "dark" ? "light" : "dark";
      localStorage.setItem(MODE_KEY, next);
      return next;
    });
  }, []);

  const setAgencyDefaultSkin = useCallback((id: string | null | undefined) => {
    if (!id) return;
    // The agency's configured skin is AUTHORITATIVE — end users don't pick skins,
    // so there is no per-browser override to respect. Always apply it so a change
    // saved in the admin reflects on the next load/refresh. (An unknown id is
    // ignored, keeping the built-in default.)
    if (!SKINS.some((s) => s.id === id)) return;
    setSkinIdState(id);
  }, []);

  const setAgencyThemeConfig = useCallback((cfg: ThemeConfig | null | undefined) => {
    setThemeConfig(cfg ?? null);
  }, []);

  const value: SkinContextValue = {
    skin,
    skinId,
    mode,
    skins: SKINS,
    setSkinId,
    setMode,
    toggleMode,
    setAgencyDefaultSkin,
    setAgencyThemeConfig,
  };

  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
}
