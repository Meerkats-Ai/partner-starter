/**
 * GET /api/branding — the agency's white-label config (app name, logo, colors).
 * Needs only the API key, so it works before login (themes the auth screens).
 */
import { NextResponse } from "next/server";
import { apiCall } from "@/lib/api";
import { assertServerConfig } from "@/lib/config";

export async function GET() {
  assertServerConfig();
  const r = await apiCall("/branding");
  return NextResponse.json(r.data ?? { success: false }, { status: r.status || 200 });
}
