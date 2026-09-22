"use client";
import { useBranding } from "@/components/brand-provider";

/** Renders the agency's logo (or app name) — used on auth screens + sidebar. */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  const b = useBranding();
  const name = b?.app_name || "Insights";
  if (b?.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={b.logo_url} alt={name} className={compact ? "h-7 object-contain" : "h-9 object-contain"} />;
  }
  return (
    <div className={compact ? "text-base font-bold text-primary" : "text-xl font-bold text-primary"}>{name}</div>
  );
}
