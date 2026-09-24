"use client";
/**
 * Inbox — ported from the Meerkats frontend (crm2/ApprovalsQueuePage).
 *
 * Cleanups for the public-API starter (per "port + clean up"):
 *  - RISK_LABEL/RISK_CLS inlined (were a tiny constants file).
 *  - "Fix with agent" is disabled: it launches an internal agent-chat flow that
 *    isn't part of the public API. The suggestion + Dismiss still work.
 *  - Agent result renders as plain text (dropped the `streamdown` dep).
 * Everything else — staged approvals, approve/reject, recommendations — is the
 * original, wired to the public API via the adRules/businessMetrics shims.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Zap, Sparkles, ArrowRight } from "lucide-react";
import adRules from "@/lib/adRules";
import businessMetricsApi from "@/lib/businessMetrics";
import { notifyStagedChanged } from "@/hooks/useInboxCount";

const RISK_LABEL: Record<string, string> = { low: "Low risk", med: "Med risk", high: "High risk" };
const RISK_CLS: Record<string, string> = {
  low: "bg-success/10 text-success border-success/20",
  med: "bg-warning/10 text-warning border-warning/20",
  high: "bg-destructive/10 text-destructive border-destructive/20",
};
const STATUS_CHIP: Record<string, string> = {
  executed: "bg-success/10 text-success border-success/20",
  rejected: "bg-muted text-muted-foreground border-border",
  reverted: "bg-warning/10 text-warning border-warning/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};
const SEV: Record<string, { chip: string; label: string }> = {
  critical: { chip: "bg-destructive/10 text-destructive border-destructive/20", label: "Critical" },
  watch: { chip: "bg-warning/10 text-warning border-warning/20", label: "Warning" },
  opportunity: { chip: "bg-success/10 text-success border-success/20", label: "Opportunity" },
};
const SUGGESTION_PERSONA = "founder";

export default function ApprovalsQueuePage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  const [recs, setRecs] = useState<any[]>([]);
  const [recsWhen, setRecsWhen] = useState<string | null>(null);
  const [recsLoading, setRecsLoading] = useState(true);
  const [recsRefreshing, setRecsRefreshing] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<number>>(() => new Set());

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };
  const setStatus = (id: string, s: string) => setStatuses((m) => ({ ...m, [id]: s }));
  const setResult = (id: string, r: string) => setResults((m) => ({ ...m, [id]: r }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adRules.staged("pending");
      setItems(Array.isArray(data?.items) ? data.items : []);
      setStatuses({});
    } catch { setItems([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadRecs = useCallback(async () => {
    setRecsLoading(true); setRecsError(null);
    try {
      const res = await businessMetricsApi.metrics.getRecommendations();
      const slice = res.data?.personas?.[SUGGESTION_PERSONA] || null;
      setRecs(slice?.recommendations || []);
      setRecsWhen(slice?.generated_at || null);
    } catch (e: any) {
      setRecsError(e?.message || "Could not load suggestions");
      setRecs([]);
    } finally { setRecsLoading(false); }
  }, []);
  useEffect(() => { loadRecs(); }, [loadRecs]);

  const refreshRecs = async () => {
    setRecsRefreshing(true); setRecsError(null);
    try {
      const res = await businessMetricsApi.metrics.refreshRecommendations();
      if (res.data?.skipped === "no_data") setRecsError("Not enough data yet — connect an ad platform or Shopify first.");
      const slice = res.data?.personas?.[SUGGESTION_PERSONA] || null;
      setRecs(slice?.recommendations || []);
      setRecsWhen(slice?.generated_at || null);
      setDismissed(new Set());
    } catch (e: any) {
      setRecsError(e?.message || "Could not generate suggestions");
    } finally { setRecsRefreshing(false); }
  };

  const lowRiskStaged = useMemo(() => items.filter((q) => !statuses[q.id] && q.risk === "low"), [items, statuses]);
  const stagedIds = useMemo(() => items.filter((q) => !statuses[q.id]).map((q) => q.id), [items, statuses]);
  const visibleRecs = useMemo(() => recs.filter((_, i) => !dismissed.has(i)), [recs, dismissed]);

  const approve = async (q: any) => {
    setPending((p) => ({ ...p, [q.id]: true }));
    try {
      const { data } = await adRules.approve(q.id);
      const resumeStatus = data?.result?.status;
      const resumeOk = data?.success === true && (resumeStatus === "success" || resumeStatus === "no_action");
      if (data?.executed || resumeOk) {
        setStatus(q.id, "executed");
        const out = data?.output || data?.result?.output_summary;
        if (out) setResult(q.id, out);
        flash("Approved — action executed");
      } else {
        setStatus(q.id, "failed");
        const err = data?.error || data?.result?.error;
        if (err) setResult(q.id, err);
        flash(err ? `Failed: ${err}` : "Action failed — see rule run log");
      }
    } catch (e: any) {
      setStatus(q.id, "failed");
      if (e?.message) setResult(q.id, e.message);
      flash(e?.message || "Approve failed");
    } finally {
      setPending((p) => ({ ...p, [q.id]: false }));
      notifyStagedChanged();
    }
  };

  const reject = async (q: any) => {
    setPending((p) => ({ ...p, [q.id]: true }));
    try {
      const { data } = await adRules.reject(q.id);
      setStatus(q.id, "rejected");
      const out = data?.result?.output_summary;
      if (out) setResult(q.id, out);
      flash("Rejected — nothing was executed");
    } catch (e: any) {
      flash(e?.message || "Reject failed");
    } finally {
      setPending((p) => ({ ...p, [q.id]: false }));
      notifyStagedChanged();
    }
  };

  const approveAllLow = async () => {
    for (const q of lowRiskStaged) { await approve(q); }
    flash("Low-risk items processed · higher-risk items still need per-item confirmation");
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold text-foreground">Inbox</h1>
      </div>

      {/* Agent runs — need approval */}
      <div className="mt-6 flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Agent runs — need approval</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{stagedIds.length}</span>
        <button onClick={approveAllLow} disabled={lowRiskStaged.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-border disabled:opacity-40">
          Approve all low-risk ({lowRiskStaged.length})
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading staged actions…
          </div>
        )}
        {!loading && items.map((q) => {
          const st = statuses[q.id];
          const done = !!st;
          const inFlight = !!pending[q.id];
          return (
            <div key={q.id} className={`rounded-2xl border bg-card p-5 shadow-sm transition ${done ? "border-border opacity-70" : "border-border"}`}>
              <div className="flex items-start gap-3">
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${RISK_CLS[q.risk]}`}>{RISK_LABEL[q.risk]}</span>
                <b className="text-[15px] text-foreground">{q.title}</b>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {done ? (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_CHIP[st]}`}>{st}</span>
                  ) : (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{q.reversible ? "Reversible" : "Not reversible"}</span>
                  )}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted-foreground">
                {q.tool && <span>tool <b className="font-mono text-[11.5px] text-foreground">{q.tool}</b></span>}
                {q.params && <span>params <b className="text-foreground">{q.params}</b></span>}
              </div>
              {q.explain && (
                <div className="mt-3 rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-[13px] text-warning">{q.explain}</div>
              )}
              {(q.metric || q.before || q.impact || q.delta) && (
                <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted-foreground">
                  {q.metric && <span>trigger <b className="text-foreground">{q.metric} = {q.metric_value ?? "—"}</b></span>}
                  {q.before && <span>before <b className="text-foreground">{q.before}</b></span>}
                  {q.impact && <span>projected <b className="text-foreground">{q.impact}</b></span>}
                  {q.delta && <span>Δ <b className="text-foreground">{q.delta}</b></span>}
                </div>
              )}
              {done && results[q.id] && (
                <div className={`mt-3 rounded-lg border px-3 py-2 text-[13px] ${st === "failed" ? "bg-destructive/10 border-destructive/20 text-destructive" : "bg-muted border-border text-foreground"}`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Agent result</div>
                  <div className="whitespace-pre-wrap">{results[q.id]}</div>
                </div>
              )}
              <div className="mt-4 flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground">{q.origin}{q.exp ? ` · ${q.exp}` : ""}</span>
                <span className="ml-auto flex items-center gap-2">
                  {done ? (
                    <span className="text-[11px] text-muted-foreground">no actions</span>
                  ) : (
                    <>
                      <button onClick={() => reject(q)} disabled={inFlight}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-border disabled:opacity-40">Reject</button>
                      <button onClick={() => approve(q)} disabled={inFlight}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
                        {inFlight ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {q.confirm ? "Approve (confirm)" : "Approve"}
                      </button>
                    </>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        {!loading && stagedIds.length === 0 && (
          <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Nothing staged — actions from your “require approval” automation rules land here.
          </div>
        )}
      </div>

      {/* Suggestions — need approval */}
      <div className="mt-8 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Suggestions — need approval</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{visibleRecs.length}</span>
        {recsWhen && <span className="text-[11px] text-muted-foreground">generated {recsWhen}</span>}
        <button onClick={refreshRecs} disabled={recsRefreshing} title="Regenerate suggestions"
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${recsRefreshing ? "animate-spin" : ""}`} /> Regenerate
        </button>
      </div>

      {recsError && <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-[12.5px] text-destructive">{recsError}</div>}

      <div className="mt-3 flex flex-col gap-4">
        {recsLoading && (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading suggestions…
          </div>
        )}
        {!recsLoading && visibleRecs.map((r, i) => {
          const sev = SEV[r.severity] || SEV.watch;
          const body = r.detail || r.evidence || r.body || r.why || "";
          return (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${sev.chip}`}>{sev.label}</span>
                <b className="text-[15px] text-foreground">{r.title}</b>
              </div>
              {body && <p className="mt-2 max-w-[80ch] text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>}
              {r.action && <div className="mt-2 text-[12.5px] text-muted-foreground">suggested action <b className="text-foreground">{r.action}</b></div>}
              <div className="mt-4 flex items-center gap-2">
                <button disabled title="Agent chat is not available on the public API"
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-not-allowed">
                  <ArrowRight className="h-3.5 w-3.5" /> Fix with agent
                </button>
                <button onClick={() => setDismissed((s) => new Set(s).add(i))}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">Dismiss</button>
              </div>
            </div>
          );
        })}
        {!recsLoading && visibleRecs.length === 0 && !recsError && (
          <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            All clear — nothing waiting on you.
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">{toast}</div>
      )}
    </div>
  );
}
