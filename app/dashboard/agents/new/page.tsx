"use client";
/**
 * Placeholder for the New Agent / Edit form. The full authoring form
 * (SmallAgentForm / NewAutomation) is a large flow with model pickers, tool
 * catalogs, Slack connect, and skill uploads — not ported into the white-label
 * starter. Agencies author agents in the Meerkats dashboard; this app manages,
 * runs, and monitors them.
 */
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function NewAgentPlaceholder() {
  const router = useRouter();
  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-xl font-semibold tracking-tight">Create / edit agent</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The agent authoring form isn’t available in this app. Create and edit agents in the
        Meerkats dashboard; here you can enable/disable, run, test, and monitor them.
      </p>
      <Button className="mt-5" onClick={() => router.push("/dashboard/agents")}>Back to agents</Button>
    </div>
  );
}
