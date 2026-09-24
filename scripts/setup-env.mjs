/**
 * Postinstall setup — minimize first-run friction.
 *
 * Runs automatically after `npm install`. If `.env.local` doesn't exist yet, it
 * writes one with a freshly generated SESSION_SECRET so the app boots without any
 * manual crypto step. The ONLY thing the user then has to fill in is their
 * MEERKATS_API_KEY (left as a placeholder). MEERKATS_API_BASE is NOT written —
 * the app hardcodes the production Partner API base and only reads the env var if
 * you explicitly set it (e.g. to point at localhost while developing the API).
 *
 * Idempotent + safe: never overwrites an existing .env.local, never throws (a
 * failure here must not fail `npm install`). Skipped in CI.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

try {
  // Don't scaffold in CI / non-interactive installs.
  if (process.env.CI) process.exit(0);

  const envPath = resolve(process.cwd(), '.env.local');
  if (existsSync(envPath)) process.exit(0); // respect an existing file

  const sessionSecret = randomBytes(32).toString('base64');
  const contents = [
    '# ── Meerkats Partner Starter ──────────────────────────────────────────────',
    '# The ONLY value you must set: your API key from the Meerkats dashboard',
    '# (API Keys → Create key). SERVER-ONLY — never sent to the browser. Use a',
    '# write-scoped key if you want the automations screen to approve/toggle.',
    'MEERKATS_API_KEY=mk_live_replace_with_your_key',
    '',
    '# Auto-generated session-cookie secret (iron-session). Leave it as-is.',
    `SESSION_SECRET=${sessionSecret}`,
    '',
    '# Optional — the app already defaults to the production Partner API. Uncomment',
    '# only to point at a local/staging API while developing.',
    '# MEERKATS_API_BASE=http://localhost:5000/api/public/v1',
    '',
  ].join('\n');

  writeFileSync(envPath, contents, { encoding: 'utf8', flag: 'wx' }); // wx = fail if exists
  console.log('\n✔ Created .env.local with a generated SESSION_SECRET.');
  console.log('  → Set MEERKATS_API_KEY in .env.local, then run `npm run dev`.\n');
} catch {
  // Never block install. If we couldn't write the file, the user copies
  // .env.example manually (README covers it).
  process.exit(0);
}
