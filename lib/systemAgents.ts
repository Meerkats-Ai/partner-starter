/**
 * systemAgents — proxy shim for the Agents page + HealthDashboard. Maps the
 * frontend's insight-scheduler methods onto the public /agents surface. Same
 * axios-like { data } shape so ported components run unchanged.
 *
 * The full page needs 12 methods (list/get/enable/disable/run/testAutomation/
 * runHistory/health/pause/resume/automationRunDetail/remove). Create/edit form
 * methods (draft/toolCatalog/models/skills/create/update) are intentionally
 * omitted — the New Agent / Edit flow is a placeholder in the starter.
 */
interface AxiosLike<T = any> { data: T }
type Cfg = { params?: Record<string, any> };

async function proxy<T = any>(method: string, apiPath: string, body?: any, cfg?: Cfg): Promise<AxiosLike<T>> {
  let path = apiPath;
  if (cfg?.params) {
    const qs = new URLSearchParams(
      Object.entries(cfg.params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]),
    ).toString();
    if (qs) path += (path.includes("?") ? "&" : "?") + qs;
  }
  const res = await fetch(`/api/proxy${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return { data };
}

const systemAgents = {
  list: (params: any = {}) => proxy("GET", "/agents", undefined, { params }),
  get: (agentKey: string) => proxy("GET", `/agents/${agentKey}`),
  enable: (agentKey: string) => proxy("POST", `/agents/${agentKey}/enable`, {}),
  disable: (agentKey: string) => proxy("POST", `/agents/${agentKey}/disable`, {}),
  run: (agentKey: string) => proxy("POST", `/agents/${agentKey}/run`, {}),
  testAutomation: (agentKey: string, body: any = { dry_run: true }) => proxy("POST", `/agents/${agentKey}/test-automation`, body),
  runHistory: (params: any = {}) => proxy("GET", "/agents/run-history", undefined, { params }),
  health: (params: any = {}) => proxy("GET", "/agents/health", undefined, { params }),
  pause: (agentKey: string) => proxy("POST", `/agents/${agentKey}/pause`, {}),
  resume: (agentKey: string) => proxy("POST", `/agents/${agentKey}/resume`, {}),
  automationRunDetail: (agentKey: string, params: any = {}) =>
    proxy("GET", `/agents/${agentKey}/automation-run-detail`, undefined, { params }),
  remove: (agentKey: string) => proxy("DELETE", `/agents/${agentKey}`),
  // Create/edit form endpoints are not wired in the starter (placeholder flow).
};

export default systemAgents;
