/**
 * adRules — drop-in-shaped replacement for the Meerkats frontend's api/adRules.js,
 * backed by our proxy. Same method names/signatures, so ported Automation + Inbox
 * pages call it unchanged. Returns axios-like `{ data }`.
 *
 * IMPORTANT path mapping: the frontend's internal API uses /ad-rules/*; the public
 * partner API mounts the same handlers under /automations/*. This shim maps to the
 * public paths, so the pages don't need to know.
 */

interface AxiosLike<T = any> { data: T }

async function proxy<T = any>(method: string, apiPath: string, body?: any): Promise<AxiosLike<T>> {
  const res = await fetch(`/api/proxy${apiPath}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-json */ }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return { data };
}

const adRules = {
  // Rule CRUD (public: /automations)
  list: () => proxy("GET", "/automations"),
  create: (rule: any) => proxy("POST", "/automations", rule),
  update: (id: string, rule: any) => proxy("PATCH", `/automations/${id}`, rule),
  remove: (id: string) => proxy("DELETE", `/automations/${id}`),
  toggle: (id: string, enabled: boolean) => proxy("POST", `/automations/${id}/toggle`, { enabled }),
  runs: (id: string) => proxy("GET", `/automations/${id}/runs`),
  activity: (ruleId?: string) => proxy("GET", `/automations/activity${ruleId ? `?rule_id=${encodeURIComponent(ruleId)}` : ""}`),
  platformHistory: (days = 14) => proxy("GET", `/automations/platform-history?days=${days}`),

  // NL authoring (LLM — long-running server-side)
  refine: (text: string, defaultMode?: string) => proxy("POST", "/automations/refine", { text, default_mode: defaultMode }),
  test: (draft: any, execute = true) => proxy("POST", "/automations/test", { draft, execute }),

  // Approvals queue
  staged: (status = "pending") => proxy("GET", `/automations/staged?status=${encodeURIComponent(status)}`),
  approve: (id: string) => proxy("POST", `/automations/staged/${id}/approve`, {}),
  reject: (id: string) => proxy("POST", `/automations/staged/${id}/reject`, {}),
};

export default adRules;
