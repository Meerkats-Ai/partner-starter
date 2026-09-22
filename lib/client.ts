/**
 * Browser-side fetch helper. The browser talks ONLY to our own Next.js route
 * handlers (never to the Meerkats API directly, so the API key stays server-side).
 *
 *  - authFetch("/metrics/query", { method, body })  → proxied to the Partner API
 *    with the key + the session's Bearer token + selected workspace added server-side.
 *  - login / signup / logout hit dedicated handlers that manage the session cookie.
 */

export interface ClientResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function toResult<T>(res: Response): Promise<ClientResult<T>> {
  let body: any = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, data: body ?? null, error: res.ok ? undefined : body?.error };
}

/** Call a Partner API path through our proxy (adds key + Bearer + workspace). */
export async function authFetch<T = any>(
  apiPath: string,
  opts: { method?: string; body?: any } = {},
): Promise<ClientResult<T>> {
  const res = await fetch(`/api/proxy${apiPath.startsWith("/") ? "" : "/"}${apiPath}`, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return toResult<T>(res);
}

export async function login(email: string, password: string): Promise<ClientResult> {
  const res = await fetch("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return toResult(res);
}

export async function signup(email: string, password: string, full_name?: string): Promise<ClientResult> {
  const res = await fetch("/api/signup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, full_name }),
  });
  return toResult(res);
}

export async function forgotPassword(email: string): Promise<ClientResult> {
  const res = await fetch("/api/proxy/auth/forgot-password", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return toResult(res);
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" });
}

/** Set the active workspace (persisted in the session cookie). */
export async function setWorkspace(workspaceId: string): Promise<ClientResult> {
  const res = await fetch("/api/workspace", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  return toResult(res);
}
