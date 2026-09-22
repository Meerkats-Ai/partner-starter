/** savedCharts — proxy shim (same shape as frontend api/savedCharts). */
interface AxiosLike<T = any> { data: T }
async function proxy<T = any>(method: string, apiPath: string, body?: any): Promise<AxiosLike<T>> {
  const res = await fetch(`/api/proxy${apiPath}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return { data };
}
const savedCharts = {
  list: (pinnedOnly = false) => proxy("GET", `/saved-charts${pinnedOnly ? "?pinned=true" : ""}`),
  save: (spec: any, opts: any = {}) => proxy("POST", "/saved-charts", { spec, ...opts }),
  setPinned: (specId: string, isPinned: boolean) => proxy("PATCH", `/saved-charts/${encodeURIComponent(specId)}`, { is_pinned: isPinned }),
  remove: (specId: string) => proxy("DELETE", `/saved-charts/${encodeURIComponent(specId)}`),
};
export default savedCharts;
