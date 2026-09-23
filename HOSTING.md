# Hosting the partner app at `<appId>.meerkats.ai` (multi-tenant by subdomain)

One shared deployment of this app serves **every** Meerkats app, resolved by
subdomain. No per-app secret key: the subdomain IS the app identity.

```
015626c4-….meerkats.ai ─┐
colorqueen-app.meerkats.ai ─┼─▶ ONE Render service ─▶ reads its own host
another-app.meerkats.ai ─┘        → appId → /branding + data by app
```

## How it works (code, already wired)

- **Two auth modes** (`lib/config.ts`):
  - **Secret-key mode** — `MEERKATS_API_KEY` set → sent as `X-API-Key` (self-hosted / single tenant, unchanged).
  - **HOST mode** — no key. `appIdFromRequest()` derives the app id from the request
    `Host` header (`<appId>.meerkats.ai` → `appId`) and every proxied call sends it
    as `X-App-Id`.
- **Branding** resolves by subdomain via the public, keyless endpoint
  `GET /api/public/v1/apps/:appId/public-branding` (returns app_name, logo, colors,
  skin, theme_config — the same public fields shown on the login screen).
- **Data** still requires the end-user's login JWT. The backend's `apiKeyAuth`
  accepts `X-App-Id` in place of a key to establish the app identity + workspace
  allow-list, then `endUserAuth` authorizes WHO + which workspace. **A logged-out
  visitor to a subdomain sees only branding + login. A guessed app id exposes
  nothing beyond that.**

## Environment (the hosted Render service)

```
# HOST mode — DO NOT set MEERKATS_API_KEY.
MEERKATS_API_BASE=https://partners.meerkats.ai/api/public/v1
MEERKATS_HOST_ROOT=meerkats.ai          # the wildcard root; host <appId>.<root>
SESSION_SECRET=<32+ char random string>
# Optional: pin one app id (local dev / testing without a subdomain)
# MEERKATS_APP_ID=015626c4-a81e-4bdd-9a91-c1518c8dd26c
```

If `MEERKATS_API_KEY` *is* set, the service ignores the host and behaves as a
single-tenant app (the original clone behavior) — handy for a partner who
self-hosts one app.

## 1. GCP Cloud DNS — wildcard record

In the `meerkats.ai` zone, add ONE record so every subdomain hits Render:

```
*.meerkats.ai.   CNAME   <your-service>.onrender.com.      TTL 300
```

(If Render gives you an IP/anycast target instead of a CNAME host, use an `A`/`AAAA`
record to that target. CNAME-to-onrender is the normal path.)

That single wildcard covers every current and future app id — no per-app DNS.

## 2. Render — wildcard custom domain + TLS

On the partner-app service → **Settings → Custom Domains**:

1. Add `*.meerkats.ai` as a custom domain.
2. Render issues a **wildcard TLS cert** (validated via DNS-01 ACME). This needs the
   DNS record above to be live so validation resolves.

> ⚠️ **Plan gotcha:** wildcard custom domains + wildcard TLS are a **paid/Pro**
> Render capability. Confirm your plan supports `*.` domains. If not, you either
> upgrade, or fall back to adding each `<appId>.meerkats.ai` as an individual
> custom domain (works, but not "one wildcard" — automate it via Render's API on
> app creation).

3. Set the env vars above on the service. Redeploy.

## 3. Verify

```bash
# branding resolves by subdomain, no key:
curl https://<appId>.meerkats.ai/api/branding
# → { success:true, data:{ app_name, skin, theme_config, … } }

# data requires login (host id alone is not enough):
curl https://<appId>.meerkats.ai/api/proxy/workspaces
# → 401 "Not authenticated" until the user logs in (then their JWT authorizes)
```

Open `https://<appId>.meerkats.ai` in a browser → themed login → sign in with an
end-user account under that app → the dashboard, scoped to that app's workspaces.

## Publish flow

"Save and publish" in the customizer persists `skin` + `theme_config` +
`primary_color` to the app. Because DNS is a wildcard and HOST mode is automatic,
**every app is instantly reachable at `<appId>.meerkats.ai`** once the wildcard is
live — "publish" just saves the look; no per-app provisioning step.

## Notes / follow-ups

- **Pretty subdomains:** today the subdomain is the raw app id (uuid). To get
  `colorqueen.meerkats.ai`, add a unique `subdomain` slug column to `apps` and
  resolve by slug→id in `resolveAppById` (and derive it in `appIdFromHost`). Left
  out for now per scope.
- **Rate limiting** in HOST mode is per-app (`app:<id>`), default
  `PUBLIC_API_RATE_PER_MIN`.
- **CSP / cookies:** the session cookie is host-scoped (each subdomain gets its own
  `mk_partner_session`), so tenants are cookie-isolated automatically.
