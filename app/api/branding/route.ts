/**
 * GET /api/branding — the agency's white-label config (app name, logo, colors,
 * skin, theme_config). Works before login (themes the auth screens).
 *
 * Two modes:
 *   • SECRET-KEY: calls /branding with X-API-Key.
 *   • HOST (<appId>.meerkats.ai): no key — calls the public
 *     /apps/:appId/public-branding endpoint, resolving the app by subdomain.
 */
import { NextRequest, NextResponse } from "next/server";
import { apiCall } from "@/lib/api";
import { assertServerConfig, appIdFromRequest } from "@/lib/config";

export async function GET(req: NextRequest) {
  // DEV OVERRIDE: set MK_DEV_BRANDING to a JSON blob to stub /branding locally.
  if (process.env.MK_DEV_BRANDING) {
    try {
      return NextResponse.json({ success: true, data: JSON.parse(process.env.MK_DEV_BRANDING) });
    } catch {
      /* fall through to the real call on bad JSON */
    }
  }
  assertServerConfig();

  const appId = appIdFromRequest(req);
  // HOST mode: resolve branding by subdomain app id (unauth endpoint; pass appId so
  // apiCall uses X-App-Id, not the shared deployment's ambient key). Secret-key mode
  // (single-tenant clone, no subdomain): the keyed /branding.
  const r = appId
    ? await apiCall(`/apps/${encodeURIComponent(appId)}/public-branding`, { appId })
    : await apiCall("/branding");

  return NextResponse.json(r.data ?? { success: false }, { status: r.status || 200 });
}
