"use client";
/**
 * STUB — the real AskBar is the agent-chat composer (not on the public API).
 * Rendered as a disabled pill so the Cockpit layout is preserved and it's clear
 * chat isn't available in the white-label kit.
 */
export function AskBar({ isProcessing }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-400">
      <span className="flex-1">Ask about your ads… (agent chat is not available on the public API)</span>
      <button disabled className="rounded-full bg-gray-200 px-3 py-1 text-xs font-medium text-gray-400 cursor-not-allowed">
        {isProcessing ? "…" : "Send"}
      </button>
    </div>
  );
}
export default AskBar;
