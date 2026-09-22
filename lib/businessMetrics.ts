/**
 * businessMetrics — drop-in-shaped replacement for the Meerkats frontend's
 * api/businessMetrics.js, but backed by our secure proxy (/api/proxy/*) instead
 * of axios + a Supabase JWT. Ported pages call `businessMetrics.metrics.query(body)`
 * exactly as before; each method returns an axios-like `{ data }` so page code
 * that reads `res.data.rows` works unchanged.
 *
 * The proxy adds X-API-Key + the end-user Bearer + the selected workspace, so the
 * page never passes workspace_id (matching the frontend's auto-injection).
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

// Concurrency gate for /metrics/query (mirrors the frontend — the metrics
// service can't take a burst of ~8-24 simultaneous queries).
const CONCURRENCY = 4;
let active = 0;
const queue: Array<{ task: () => Promise<any>; resolve: (v: any) => void; reject: (e: any) => void }> = [];
function pump() {
  while (active < CONCURRENCY && queue.length) {
    const { task, resolve, reject } = queue.shift()!;
    active++;
    task().then(resolve, reject).finally(() => { active--; pump(); });
  }
}
function gate<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); pump(); });
}

const metrics = {
  getCatalog: () => proxy("GET", "/metrics/catalog"),
  query: (body: any) => gate(() => proxy("POST", "/metrics/query", body)),
  getRevenueByChannel: () => proxy("GET", "/metrics/revenue-by-channel"),
  getRevenueByMonth: () => proxy("GET", "/metrics/revenue-by-month"),
  getRecommendations: () => proxy("GET", "/metrics/recommendations"),
  refreshRecommendations: () => proxy("POST", "/metrics/recommendations/refresh", {}),
};

// Admin cross-workspace variants aren't available on the public API (an end user
// only ever sees their own workspace). Ported code references them only on
// never-taken (admin=false) branches; we alias them to the ws methods so any
// stray call still works rather than throwing an undefined-method error.
const adminQuery = (_workspaceId: string, body: any) => metrics.query(body);
const adminGetRecommendations = (_workspaceId: string) => metrics.getRecommendations();
const adminRefreshRecommendations = (_workspaceId: string) => metrics.refreshRecommendations();

const businessMetrics = { metrics, adminQuery, adminGetRecommendations, adminRefreshRecommendations };
export default businessMetrics;
export { metrics, adminQuery, adminGetRecommendations, adminRefreshRecommendations };
