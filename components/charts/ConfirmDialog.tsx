"use client";
/**
 * ConfirmDialog — small self-contained Tailwind confirmation modal.
 * Ported from the Meerkats frontend (charts/ConfirmDialog).
 */
import { useEffect } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

export default function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmCls = destructive ? "bg-destructive hover:bg-destructive/90" : "bg-primary hover:bg-primary/90";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={() => !busy && onCancel?.()} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start gap-3">
          {destructive && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
            {message && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{message}</p>}
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={() => !busy && onCancel?.()} disabled={busy}
            className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:border-border disabled:opacity-40">
            {cancelLabel}
          </button>
          <button onClick={() => !busy && onConfirm?.()} disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-primary-foreground transition disabled:opacity-60 ${confirmCls}`}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
