/**
 * Generic authed proxy. The browser calls /api/proxy/<partner-api-path>; this
 * handler adds X-API-Key (server secret) + the session's Bearer token + the
 * selected X-Workspace-Id, forwards to the Partner API, and relays the response.
 *
 * This is what keeps the API key server-side: the browser only ever sees this
 * same-origin route + its httpOnly session cookie.
 *
 * Supports GET/POST/PATCH/DELETE. The catch-all [...path] maps directly onto the
 * Partner API path, e.g. /api/proxy/metrics/query → POST {apiBase}/metrics/query.
 */
import { NextRequest, NextResponse } from "next/server";
import { apiCall } from "@/lib/api";
import { getSession } from "@/lib/session";
import { assertServerConfig } from "@/lib/config";

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  assertServerConfig();
  const session = await getSession();
  if (!session.token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { path } = await ctx.params;
  const apiPath = "/" + path.join("/");

  // Pass through any query string the browser sent.
  const query: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => { query[k] = v; });

  let body: any = undefined;
  if (req.method !== "GET" && req.method !== "DELETE") {
    try { body = await req.json(); } catch { body = undefined; }
  }

  const r = await apiCall(apiPath, {
    method: req.method,
    body,
    token: session.token,
    workspaceId: session.workspaceId,
    query: Object.keys(query).length ? query : undefined,
  });

  // If the token expired, surface a 401 so the client can bounce to login.
  return NextResponse.json(r.data ?? { success: r.ok, error: r.error }, { status: r.status || 200 });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
