"use client";
import { useBranding } from "@/components/brand-provider";
import { BrandMark } from "@/components/brand-mark";

/** Logo + tagline block shown above the auth cards. */
export function AuthBrandHeader() {
  const b = useBranding();
  return (
    <div className="flex flex-col items-center gap-2 mb-6">
      <BrandMark />
      {b?.tagline ? <p className="text-sm text-muted-foreground">{b.tagline}</p> : null}
    </div>
  );
}
