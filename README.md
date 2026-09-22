# Meerkats Partner Starter Kit

A production-ready **Next.js** app for building a white-labeled ads-intelligence
product on the **Meerkats Partner API**. Your customers sign up through your
brand and get a full dashboard — Cockpit, Explore, Agents, and an approvals
Inbox — all reading live cross-platform ad/revenue data, with your API key kept
safely server-side.

> Clone it, set your API key, pick a theme, and you have a working branded app.

- **Stack:** Next.js (App Router) · shadcn/ui (Radix + Tailwind) · Chart.js + Recharts · iron-session
- **Repo:** https://github.com/Meerkats-Ai/partner-starter

---

## Quick start

```bash
git clone https://github.com/Meerkats-Ai/partner-starter.git
cd partner-starter
npm install

cp .env.example .env.local
#   MEERKATS_API_KEY   → from the Meerkats dashboard (API Keys → Create key)
#   MEERKATS_API_BASE  → https://partners.meerkats.ai/api/public/v1
#   SESSION_SECRET     → openssl rand -base64 32

npm run dev          # http://localhost:3000
```

Sign up (or add a user in **Meerkats dashboard → API Keys → View users**), then
you're in. Land on the **Cockpit** by default.

---

## What's included

| Page | Route | What it does |
| --- | --- | --- |
| **Cockpit** | `/dashboard/cockpit` | Founder / Growth / Media-buyer / Health personas — KPIs, ROAS, revenue trends, cohorts, campaign tables (Chart.js + Recharts). Pinned-chart strip. |
| **Explore** | `/dashboard/explore` | Per-platform ads explorer — KPI cards, drill-down, CSV export, pin to Cockpit. |
| **Agents** | `/dashboard/agents` | Scheduled AI agents — Custom + Template agents, enable/disable, run, test, run history, inbox activity. |
| **Inbox** | `/dashboard/queue` | Approvals queue — staged actions + AI recommendations, approve/reject. |
| **Auth** | `/login`, `/signup`, `/forgot` | Branded end-user auth, themed from your `/branding` config. |

All data comes from the Partner API via a **secure server-side proxy** — the API
key never reaches the browser.

---

## The auth model (important)

Every request uses **two credentials**:

| Credential | Header | Held by |
| --- | --- | --- |
| **API key** | `X-API-Key: mk_live_…` | your **server** (a Next.js route handler adds it) — never the browser |
| **End-user token** | `Authorization: Bearer <jwt>` | the browser (an httpOnly session cookie) |
| **Workspace** | `X-Workspace-Id: <uuid>` | selected in the sidebar |

Flow: the browser calls your own Next.js routes (`/api/login`, `/api/proxy/*`);
those add the API key + the end-user's token and forward to the Partner API.

```
Browser ─▶ /api/login          (Next route) ─▶ POST /auth/login → JWT in httpOnly cookie
Browser ─▶ /api/proxy/<path>   (Next route) ─▶ <path> on the API (adds key + Bearer + workspace)
```

**Never** put `MEERKATS_API_KEY` in client code. It stays in the route handlers.

---

## Theming

The app themes itself two ways:

1. **Runtime, from your branding** — on load it calls `/branding` and applies your
   `primary_color`, `logo_url`, `app_name`, and `tagline` (see
   `components/brand-provider.tsx`). Set these in **Meerkats dashboard → API Keys →
   Auth email branding**.

2. **Static, in `app/globals.css`** — the shadcn CSS-variable palette. Edit the
   HSL tokens (`--primary`, `--background`, `--radius`, …) to hard-set a look.
   The **"Start with the starter kit"** picker in the Meerkats dashboard generates
   a ready-to-paste `globals.css` theme block for your chosen colors/radius/font.

Both light and dark themes are defined; the viewer's OS preference is respected.

---

## Project structure

```
app/
  api/
    login, signup, logout, workspace, branding   ← auth + session route handlers
    proxy/[...path]                               ← the generic authed proxy
  (auth)/{login,signup,forgot}                    ← themed auth screens
  dashboard/
    cockpit, explore, agents, queue               ← the four product pages
    layout.tsx                                    ← auth-guarded shell + sidebar
lib/
  config.ts        ← server-only env (API key, base URL, session secret)
  api.ts           ← server API client (adds X-API-Key)
  session.ts       ← iron-session cookie (holds the end-user JWT)
  client.ts        ← browser helper → talks to our routes only
  *.ts             ← proxy-backed API shims (metrics, adRules, systemAgents, cdp, …)
components/
  ui/              ← shadcn components — own them, restyle them
  charts/          ← the ported dashboard chart components
  pages/           ← ported page components (Agents, tooltips, run detail)
```

---

## Extending it

- **Add a metric card**: call
  `authFetch("/metrics/query", { method: "POST", body: { metrics, groupBy, dateRange } })`.
  Discover valid metric/dimension names via `GET /metrics/catalog`.
- **Add a page**: drop a folder under `app/dashboard/`, add a nav item in
  `components/sidebar.tsx`, and call the API through `authFetch`.
- Everything under `components/ui/` is plain shadcn/ui — restyle freely.

---

## Build & deploy

```bash
npm run build && npm start
```

Deploy anywhere that runs Next.js (Vercel, a Node host, Docker). Set the three
env vars on your host; keep `MEERKATS_API_KEY` a **server** env var only.

---

## Notes

- **Agent authoring form** (create/edit an agent) is a placeholder — author agents
  in the Meerkats dashboard; this app manages, runs, and monitors them.
- **Agent chat** ("Fix with agent", live run transcript) isn't part of the public
  API, so those affordances are disabled/summarized.

Full API reference: `https://partners.meerkats.ai/api/public/v1/docs` ·
OpenAPI spec: `.../openapi.json`
