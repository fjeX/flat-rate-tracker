# Plan — Google OAuth (Sign in with Google)

Status: **✅ COMPLETE (2026-06-20).** All three steps done and live sign-in verified working on `tracker.slimelab.cc`. Google Cloud configured → VM GoTrue env wired (`google: true`) → app code (callback route, button, idempotent seeding) deployed and tested.

## Decisions locked

- **Account linking:** Auto-link same email. A Google login and an email/password login with the same address resolve to one account (GoTrue default for verified emails).
- **Scope:** Real multi-user — prepping for other techs to sign up, not just Liem.
- **App-code work:** Deferred until Steps 1–2 (Google + VM) are done.

## Context — what we already have

- Auth is 100% Supabase Auth (`@supabase/ssr`), self-hosted behind Kong at `api.slimelab.cc`.
- Existing email/password flow lives in `src/app/actions/auth.ts` (server actions). Session refresh + route gating in `src/lib/supabase/proxy.ts` and `src/proxy.ts`.
- Self-hosted means **no dashboard toggle** — Google is enabled via GoTrue env vars on the VM.

## Build order

### Step 1 — Google Cloud Console (one-time, browser) ✅ DONE 2026-06-19

- ~~Create/reuse a project.~~ Reused existing project **Flat Rate Tracker** (`flat-rate-tracker-499922`).
- **OAuth consent screen** (now "Google Auth Platform") → User type: **External** ✅ (already set).
  - ~~Multi-user requires clicking **"Publish app" → Production".~~ Publishing status flipped **Testing → In production** ✅.
  - Scopes: none added — `email`/`profile`/`openid` are non-sensitive and requested at runtime by Supabase, so no verification review triggered ✅.
- **Credentials → Create OAuth Client ID → Web application** ✅.
  - Client name: `FRT Supabase Auth (Web)`.
  - Authorized redirect URI: `https://api.slimelab.cc/auth/v1/callback` ✅.
  - **Client ID:** `636340327659-1t9no7djiu8591keeoe1ac8ufbio4efd.apps.googleusercontent.com`
  - **Client Secret:** stored in the VM `.env` only — **not committed here** (Google now hashes secrets and shows them once at creation; if lost, add a new secret on the client's detail page).

> **Gotcha for next time:** Google no longer lets you view/download a client secret after creation — the one-time reveal is a JSON download. The original secret's download didn't persist (headless browser), so a fresh secret was generated and the dead original was disabled + deleted. Only one enabled secret exists now.

### Step 2 — Supabase auth container on the VM ✅ DONE 2026-06-20

How it actually wired up on this VM (self-hosted Supabase layout):

- Real values live in `supabase-stack/.env`; `docker-compose.yml` maps them into the GoTrue
  `auth` service via `${...}` references. So Step 2 touched **both** files.
- **`.env`** — appended (secret kept on the VM only, never committed):
  - `GOOGLE_ENABLED=true`
  - `GOOGLE_CLIENT_ID=636340327659-1t9no7djiu8591keeoe1ac8ufbio4efd.apps.googleusercontent.com`
  - `GOOGLE_SECRET=...` (in VM `.env`)
  - `GOOGLE_REDIRECT_URI=https://api.slimelab.cc/auth/v1/callback`
  - `ADDITIONAL_REDIRECT_URLS=https://tracker.slimelab.cc/auth/callback,http://localhost:3000/auth/callback`
    (this feeds `GOTRUE_URI_ALLOW_LIST`). ⚠️ Note: these are the **app** callback URLs the browser
    is redirected to — *not* the Google→GoTrue `api.slimelab.cc/auth/v1/callback` redirect URI.
- **`docker-compose.yml`** — added to the `auth` env block, right after `GOTRUE_SMS_AUTOCONFIRM`:
  - `GOTRUE_EXTERNAL_GOOGLE_ENABLED: ${GOOGLE_ENABLED}`
  - `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}`
  - `GOTRUE_EXTERNAL_GOOGLE_SECRET: ${GOOGLE_SECRET}`
  - `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: ${GOOGLE_REDIRECT_URI}`
- `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED` left unset → auto-link by verified email is the default ✅.
- Recreated auth only: `docker compose up -d auth` → `supabase-auth Up (healthy)`, clean logs.
- Smoke test: `curl https://api.slimelab.cc/auth/v1/settings` → `"google": true` ✅.
- Backups `.env.bak` / `docker-compose.yml.bak` remain in `supabase-stack/`; delete once end-to-end
  sign-in is verified after Step 3.

### Step 3 — App code ✅ DONE 2026-06-20 (built in repo, deployed to VM, live-tested OK)

Three small pieces:

1. **`src/app/auth/callback/route.ts`** (new) — Google sends the user back here with `?code=...`. Handler calls `exchangeCodeForSession(code)` (sets auth cookies via `@supabase/ssr`, PKCE flow), seeds-if-new, redirects to `/dashboard`.
2. **"Continue with Google" button** — small client component on `/signin` + `/signup`. OAuth uses the **browser** client (`src/lib/supabase/client.ts`), unlike the current server-action email flow. Calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: ".../auth/callback" } })`.
3. **Idempotent op-code seeding** — currently `signUp` (`src/app/actions/auth.ts:42`) seeds `STARTER_OP_CODES`. Google users never hit that action, so they'd land with an empty library. Refactor seeding into one helper that seeds only if the user has zero op codes, shared by both the email path and the OAuth callback.

## On the radar (multi-user)

- **Email confirmation:** local dev has confirmation off. In prod, turn it **on** for the email/password path — otherwise auto-link could attach to an unverified, attacker-claimed email. Google emails are pre-verified, so that side is safe; it's the password side to tighten.
- **RLS:** OAuth users get a normal `auth.users` row with a real `user_id`, so existing per-user RLS applies unchanged. Nothing to do.
