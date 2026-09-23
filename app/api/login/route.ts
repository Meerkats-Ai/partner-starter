/**
 * POST /api/login — proxy to the Partner API's /auth/login, then store the
 * returned end-user JWT in the httpOnly session cookie. Body: { email, password }.
 */
import { NextResponse } from "next/server";
import { apiCall } from "@/lib/api";
import { getSession } from "@/lib/session";
import { assertServerConfig, appIdFromRequest } from "@/lib/config";

export async function POST(req: Request) {
  assertServerConfig();
  const { email, password } = await req.json();
  const r = await apiCall<{ success: boolean; data: { token: string; user: any } }>("/auth/login", {
    method: "POST", body: { email, password }, appId: appIdFromRequest(req),
  });
  // The API wraps the payload: { success, data: { token, user } }.
  const payload = r.data?.data;
  if (!r.ok || !payload?.token) {
    return NextResponse.json({ error: r.error || "Login failed" }, { status: r.status || 401 });
  }
  const session = await getSession();
  session.token = payload.token;
  session.email = payload.user?.email;
  await session.save();
  return NextResponse.json({ ok: true, user: payload.user });
}
