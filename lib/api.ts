/**
 * Server-side Meerkats Partner API client. Used by route handlers ONLY (it reads
 * the server-only API key). It adds X-API-Key on every call, the end-user Bearer
 * token when provided, and X-Workspace-Id for data calls.
 *
 * The browser never calls this directly — it calls our /api/* route handlers,
 * which call this.
 */
import { config } from "./config";

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

interface CallOpts {
  method?: string;
  body?: any;
  token?: string;        // end-user JWT (Authorization: Bearer)
  workspaceId?: string;  // X-Workspace-Id
  appId?: string;        // HOST mode: app id from the subdomain (→ X-App-Id)
  query?: Record<string, string | number | undefined>;
}

export async function apiCall<T = any>(path: string, opts: CallOpts = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  // Auth: HOST mode wins when an app id is supplied for THIS request (the shared
  // <appId>.meerkats.ai deployment has an ambient MEERKATS_API_KEY too, but a
  // host-resolved request must identify by X-App-Id, NOT the ambient key — sending
  // the key there 401s / serves the wrong app). Fall back to the secret key only
  // when no app id is in play (genuine single-tenant clone).
  if (opts.appId) headers["X-App-Id"] = opts.appId;
  else if (config.apiKey) headers["X-API-Key"] = config.apiKey;
  if (opts.body) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.workspaceId) headers["X-Workspace-Id"] = opts.workspaceId;

  let url = `${config.apiBase}${path}`;
  if (opts.query) {
    const qs = Object.entries(opts.query)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }

  try {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* non-json */ }
    return {
      ok: res.ok,
      status: res.status,
      data: data ?? null,
      error: res.ok ? undefined : data?.error || `HTTP ${res.status}`,
    };
  } catch (e: any) {
    return { ok: false, status: 0, data: null, error: e?.message || "network error" };
  }
}
