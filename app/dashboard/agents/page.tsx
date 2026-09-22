"use client";
/**
 * Agents — the ported scheduled-agent management page (Custom + Template agents,
 * status toggles, run/test, run history, inbox activity). Chat "View full run"
 * uses the compiled-trace path; the New Agent / Edit form is a placeholder (see
 * /dashboard/agents/new). Wrapped in Suspense for useSearchParams.
 */
import { Suspense } from "react";
import AgentsPage from "@/components/pages/AgentsPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading agents…</div>}>
      <AgentsPage />
    </Suspense>
  );
}
