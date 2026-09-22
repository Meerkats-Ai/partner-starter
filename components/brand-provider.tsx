"use client";
/**
 * BrandProvider — fetches the agency's branding once and (a) applies the primary
 * color to the theme CSS vars, (b) exposes { app_name, logo_url, tagline, … } to
 * the app via context so auth screens + the sidebar render the agency's brand.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { applyBrandColor, type Branding } from "@/lib/theme";

const BrandContext = createContext<Branding | null>(null);
export const useBranding = () => useContext(BrandContext);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Branding | null>(null);

  useEffect(() => {
    fetch("/api/branding")
      .then((r) => r.json())
      .then((res) => {
        const b: Branding = res?.data || res || {};
        setBranding(b);
        applyBrandColor(b.primary_color);
      })
      .catch(() => {});
  }, []);

  return <BrandContext.Provider value={branding}>{children}</BrandContext.Provider>;
}
