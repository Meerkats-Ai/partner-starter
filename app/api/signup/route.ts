/**
 * POST /api/signup — proxy to /auth/signup, then store the end-user JWT in the
 * session cookie (signup returns a token, so the user is logged in immediately).
 * Body: { email, password, full_name? }.
 */
import { NextResponse } from "next/server";
import { apiCall } from "@/lib/api";
import { getSession } from "@/lib/session";
import { assertServerConfig, appIdFromRequest } from "@/lib/config";

export async function POST(req: Request) {
  assertServerConfig();
  const { email, password, full_name } = await req.json();
  const r = await apiCall<{ success: boolean; data: { token: string; user: any } }>("/auth/signup", {
    method: "POST", body: { email, password, full_name }, appId: appIdFromRequest(req),
  });
  // The API wraps the payload: { success, data: { token, user } }.
  const payload = r.data?.data;
  if (!r.ok || !payload?.token) {
    return NextResponse.json({ error: r.error || "Signup failed" }, { status: r.status || 400 });
  }
  const session = await getSession();
  session.token = payload.token;
  session.email = payload.user?.email;
  await session.save();
  return NextResponse.json({ ok: true, user: payload.user });
}
