/**
 * pinnedCharts — proxy-backed shim for the frontend's api/pinnedCharts.js.
 * Same methods, returns axios-like { data }. Maps to the public /pinned-charts.
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

const pinnedCharts = {
  list: () => proxy("GET", "/pinned-charts"),
  pin: (spec: any) => proxy("POST", "/pinned-charts", { spec }),
  unpin: (specId: string) => proxy("DELETE", `/pinned-charts/${encodeURIComponent(specId)}`),
  hideDefault: (specId: string) => proxy("POST", "/pinned-charts/hidden", { spec_id: specId }),
  unhideDefault: (specId: string) => proxy("DELETE", `/pinned-charts/hidden/${encodeURIComponent(specId)}`),
};

export default pinnedCharts;
