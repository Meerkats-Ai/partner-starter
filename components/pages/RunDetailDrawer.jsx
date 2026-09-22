"use client";
/**
 * STUB — the real RunDetailDrawer embeds the full agent-chat provider stack to
 * show a run's live thread (not on the public API). Renders a minimal read-only
 * drawer with the run's basic fields instead.
 */
export default function RunDetailDrawer({ run, onClose }) {
  if (!run) return null;
  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl">
        <button onClick={onClose} className="mb-4 text-sm text-gray-400 hover:text-gray-600">Close</button>
        <h3 className="text-base font-semibold text-gray-900">Run detail</h3>
        <p className="mt-1 text-xs text-gray-400">Full run transcript isn’t available on the public API.</p>
        <dl className="mt-4 space-y-2 text-sm">
          {Object.entries(run).filter(([, v]) => typeof v === "string" || typeof v === "number").slice(0, 12).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-32 shrink-0 text-gray-400">{k}</dt>
              <dd className="text-gray-700 break-all">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
