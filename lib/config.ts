/**
 * Server-only configuration. The API KEY lives ONLY here (never shipped to the
 * browser) — every outbound call is made by a Next.js route handler that adds it.
 */
export const config = {
  // Your Meerkats Partner API key (mk_live_... / mk_test_...). SERVER-ONLY.
  apiKey: process.env.MEERKATS_API_KEY || "",
  // Base URL of the Partner API.
  apiBase: process.env.MEERKATS_API_BASE || "https://partners.meerkats.ai/api/public/v1",
  // Secret used to encrypt the session cookie (iron-session). 32+ chars.
  sessionSecret: process.env.SESSION_SECRET || "",
};

export function assertServerConfig() {
  const missing: string[] = [];
  if (!config.apiKey) missing.push("MEERKATS_API_KEY");
  if (!config.sessionSecret || config.sessionSecret.length < 32) missing.push("SESSION_SECRET (32+ chars)");
  if (missing.length) {
    throw new Error(`Missing/invalid env: ${missing.join(", ")}. Copy .env.example to .env.local and fill it in.`);
  }
}
