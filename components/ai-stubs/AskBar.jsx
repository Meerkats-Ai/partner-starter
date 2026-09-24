"use client";
/**
 * STUB — the real AskBar is the agent-chat composer (not on the public API).
 * Rendered as a disabled pill so the Cockpit layout is preserved and it's clear
 * chat isn't available in the white-label kit.
 */
export function AskBar({ isProcessing }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-2.5 text-sm text-muted-foreground/70">
      <span className="flex-1">Ask about your ads… (agent chat is not available on the public API)</span>
      <button disabled className="rounded-full bg-muted-foreground/20 px-3 py-1 text-xs font-medium text-muted-foreground/70 cursor-not-allowed">
        {isProcessing ? "…" : "Send"}
      </button>
    </div>
  );
}
export default AskBar;
