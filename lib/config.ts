/**
 * Server-only configuration. Two ways this app authenticates to the Partner API:
 *
 *   A. SECRET-KEY mode (self-hosted / single tenant): MEERKATS_API_KEY is set and
 *      sent as X-API-Key on every call. The key is SERVER-ONLY (never shipped).
 *
 *   B. HOST mode (hosted at <appId>.meerkats.ai): no secret key. The app id is
 *      derived from the request subdomain and sent as X-App-Id. Branding + login
 *      resolve by app id; data is authorized by the end-user's JWT. This is how
 *      one shared deployment serves every app by subdomain.
 *
 * A given request uses whichever is available: if MEERKATS_API_KEY is set it wins;
 * otherwise the host-derived app id is used. So a self-hosted clone keeps working
 * unchanged, and the hosted multi-tenant deployment needs no per-app key.
 */
export const config = {
  // Your Meerkats Partner API key (mk_live_... / mk_test_...). SERVER-ONLY. Empty
  // in HOST mode (the subdomain identifies the app instead).
  apiKey: process.env.MEERKATS_API_KEY || "",
  // Base URL of the Partner API.
  apiBase: process.env.MEERKATS_API_BASE || "https://partners.meerkats.ai/api/public/v1",
  // The wildcard root the hosted deployment runs under; a host of
  // "<appId>.meerkats.ai" yields appId. Only used in HOST mode.
  hostRoot: process.env.MEERKATS_HOST_ROOT || "meerkats.ai",
  // Secret used to encrypt the session cookie (iron-session). 32+ chars.
  sessionSecret: process.env.SESSION_SECRET || "",
};

/** True when a server secret API key is configured (secret-key mode). */
export const hasApiKey = () => !!config.apiKey;

/**
 * Extract the app id from a request host in HOST mode. `<appId>.meerkats.ai`
 * → `appId`. Returns undefined if the host is the bare root or not under it.
 */
export function appIdFromHost(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  const h = host.split(":")[0].toLowerCase(); // strip port
  const root = config.hostRoot.toLowerCase();
  if (!h.endsWith("." + root)) return undefined;
  const sub = h.slice(0, -(root.length + 1)); // remove ".<root>"
  if (!sub || sub === "www") return undefined;
  return sub;
}

/**
 * Resolve the app id for an incoming request in HOST mode.
 *
 * The SHARED hosted deployment serves every app off `<appId>.meerkats.ai` and it
 * ALSO has a MEERKATS_API_KEY set — so we must NOT let a key's presence force
 * secret-key mode. Mode is decided by the REQUEST: if the host is an app subdomain
 * (or MEERKATS_APP_ID is pinned), it's HOST mode and we resolve by app id; the key
 * is ignored for that request. A genuine single-tenant clone has a key but is
 * served on its OWN domain (not `*.meerkats.ai`), so appIdFromHost returns
 * undefined there and it correctly stays in secret-key mode.
 */
export function appIdFromRequest(req: { headers: Headers }): string | undefined {
  if (process.env.MEERKATS_APP_ID) return process.env.MEERKATS_APP_ID;
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || undefined;
  return appIdFromHost(host);
}

/**
 * Validate server config. The API key is REQUIRED only in secret-key mode; in
 * HOST mode the subdomain supplies identity, so only the session secret matters.
 */
export function assertServerConfig() {
  const missing: string[] = [];
  if (!config.sessionSecret || config.sessionSecret.length < 32) missing.push("SESSION_SECRET (32+ chars)");
  if (missing.length) {
    throw new Error(`Missing/invalid env: ${missing.join(", ")}. Copy .env.example to .env.local and fill it in.`);
  }
}
