/** cardFilters — proxy shim (same shape as frontend api/cardFilters). */
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
const cardFilters = {
  list: () => proxy("GET", "/card-filters"),
  save: (cardId: string, filter: any) => proxy("PUT", `/card-filters/${encodeURIComponent(cardId)}`, { filter }),
  clear: (cardId: string) => proxy("DELETE", `/card-filters/${encodeURIComponent(cardId)}`),
};
export default cardFilters;
