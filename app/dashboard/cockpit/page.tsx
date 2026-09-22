"use client";
/**
 * Cockpit — the full ported Ad Performance Cockpit (Founder / Growth / Media
 * buyer / Health personas). Chat/AI affordances are stubbed (not on the public
 * API); everything else is the real dashboards + charts, wired to the public API.
 *
 * Wrapped in Suspense because the ported CockpitPage uses useSearchParams.
 */
import { Suspense } from "react";
import CockpitPage from "@/components/charts/_CockpitPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading cockpit…</div>}>
      <CockpitPage />
    </Suspense>
  );
}
