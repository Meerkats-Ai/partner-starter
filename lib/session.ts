/**
 * Session — a lightweight httpOnly cookie (iron-session) that holds the
 * END-USER JWT returned by the Meerkats /auth/login. The browser never sees the
 * API key; it only carries this encrypted cookie. No NextAuth: the Partner API's
 * end-user token IS the session, we just keep it server-side.
 */
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { config } from "./config";

export interface SessionData {
  token?: string;          // the Meerkats end-user JWT
  email?: string;
  workspaceId?: string;    // the currently selected workspace
}

export const sessionOptions: SessionOptions = {
  password: config.sessionSecret,
  cookieName: "mk_partner_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

/** True if the visitor has an authenticated end-user token. */
export async function isAuthed(): Promise<boolean> {
  const s = await getSession();
  return !!s.token;
}
