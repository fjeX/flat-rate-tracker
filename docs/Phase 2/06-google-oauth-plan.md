# Plan — Google OAuth (Sign in with Google)

Status: **Planned, not started.** Liem will do the Google Cloud + VM Supabase config later, then the app-code side gets built.

## Decisions locked

- **Account linking:** Auto-link same email. A Google login and an email/password login with the same address resolve to one account (GoTrue default for verified emails).
- **Scope:** Real multi-user — prepping for other techs to sign up, not just Liem.
- **App-code work:** Deferred until Steps 1–2 (Google + VM) are done.

## Context — what we already have

- Auth is 100% Supabase Auth (`@supabase/ssr`), self-hosted behind Kong at `api.slimelab.cc`.
- Existing email/password flow lives in `src/app/actions/auth.ts` (server actions). Session refresh + route gating in `src/lib/supabase/proxy.ts` and `src/proxy.ts`.
- Self-hosted means **no dashboard toggle** — Google is enabled via GoTrue env vars on the VM.

## Build order

### Step 1 — Google Cloud Console (one-time, browser)

- Create/reuse a project.
- **OAuth consent screen** → User type: **External**.
  - Multi-user requires clicking **"Publish app" → Production**. Testing mode caps at 100 manually-added test users and shows an "unverified" warning.
  - Scopes: `email`, `profile`, `openid` only. Minimal scopes = no Google verification review needed.
- **Credentials → Create OAuth Client ID → Web application**.
  - Authorized redirect URI: `https://api.slimelab.cc/auth/v1/callback`
  - Save the **Client ID** + **Client Secret**.

### Step 2 — Supabase auth container on the VM

- Add to the supabase-stack env:
  - `GOTRUE_EXTERNAL_GOOGLE_ENABLED=true`
  - `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=...`
  - `GOTRUE_EXTERNAL_GOOGLE_SECRET=...`
  - `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://api.slimelab.cc/auth/v1/callback`
- Confirm `GOTRUE_URI_ALLOW_LIST` includes both:
  - `https://tracker.slimelab.cc/auth/callback`
  - `http://localhost:3000/auth/callback` (local dev)
- Confirm `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED` is **not** forcing manual mode (auto-link is the default).
- `cd ~/docker/flat-rate-tracker/supabase-stack && docker compose up -d` (auth side only — **no app rebuild needed**).
- Smoke test: `curl https://api.slimelab.cc/auth/v1/settings` → should show `"google": true` under external providers.

### Step 3 — App code (build after Steps 1–2)

Three small pieces:

1. **`src/app/auth/callback/route.ts`** (new) — Google sends the user back here with `?code=...`. Handler calls `exchangeCodeForSession(code)` (sets auth cookies via `@supabase/ssr`, PKCE flow), seeds-if-new, redirects to `/dashboard`.
2. **"Continue with Google" button** — small client component on `/signin` + `/signup`. OAuth uses the **browser** client (`src/lib/supabase/client.ts`), unlike the current server-action email flow. Calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: ".../auth/callback" } })`.
3. **Idempotent op-code seeding** — currently `signUp` (`src/app/actions/auth.ts:42`) seeds `STARTER_OP_CODES`. Google users never hit that action, so they'd land with an empty library. Refactor seeding into one helper that seeds only if the user has zero op codes, shared by both the email path and the OAuth callback.

## On the radar (multi-user)

- **Email confirmation:** local dev has confirmation off. In prod, turn it **on** for the email/password path — otherwise auto-link could attach to an unverified, attacker-claimed email. Google emails are pre-verified, so that side is safe; it's the password side to tighten.
- **RLS:** OAuth users get a normal `auth.users` row with a real `user_id`, so existing per-user RLS applies unchanged. Nothing to do.
