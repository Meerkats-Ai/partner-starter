/**
 * cdpApi — proxy-backed shim for the frontend's api/cdpAdmin. Only the methods
 * the Cockpit uses. Same shape (`cdpApi.cdp.method()`, axios-like { data }).
 * Note: the frontend hits /cookie-provider/connected-platforms; the public API
 * mounts it at /cdp/connected-platforms — mapped here.
 */
interface AxiosLike<T = any> { data: T }

async function proxy<T = any>(method: string, apiPath: string): Promise<AxiosLike<T>> {
  const res = await fetch(`/api/proxy${apiPath}`, { method });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-json */ }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return { data };
}

const cdp = {
  connectedPlatforms: () => proxy("GET", "/cdp/connected-platforms"),
  getConnectorStats: () => proxy("GET", "/cdp/connector-stats"),
  getCohorts: (grain = "month") => proxy("GET", `/cdp/cohorts?grain=${encodeURIComponent(grain)}`),
};

// Admin cohorts alias (never taken on the public API — end user is single-ws).
const getCohorts = (_ws: string, grain = "month") => cdp.getCohorts(grain);

const cdpApi = { cdp, getCohorts };
export default cdpApi;
