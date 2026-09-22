/** POST /api/workspace — set the active workspace in the session. Body: { workspaceId }. */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { workspaceId } = await req.json();
  session.workspaceId = workspaceId || undefined;
  await session.save();
  return NextResponse.json({ ok: true, workspaceId: session.workspaceId });
}
