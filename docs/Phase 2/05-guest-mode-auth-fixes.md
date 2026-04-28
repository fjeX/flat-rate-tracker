# Session Handoff — Guest mode + auth error message fixes (Phase 2)

## Where it started

User confirmed the FRT was deployed to their Ubuntu VM via a separate VS Code Claude Code session yesterday. They wanted to know what that session changed, clarify the correct deploy update workflow, fix a "fetch failed" error blocking login/signup, and add a guest mode so visitors can try the app without an account.

## Decisions locked + what shipped

- **Deployment workflow confirmed** — local changes → `git push` → SSH into VM → `git pull && docker compose down && docker compose build && docker compose up -d`. The `build` step is mandatory; just restarting doesn't pick up code changes.
- **"fetch failed" = connection error, not bad credentials** — the VM's Supabase containers are likely not running, or `NEXT_PUBLIC_SUPABASE_URL` was baked in wrong at build time. The error message fix is code-side; the root cause must be fixed on the VM.
- **Auth error messages improved** — `src/app/actions/auth.ts`: network errors now show "Unable to connect to the server. Please try again."; wrong credentials show "Incorrect email or password." Applied to both `signIn` and `signUp`.
- **Guest mode shipped** — Routes `/guest`, `/guest/log`, `/guest/history` open to unauthenticated users. Data stored in `sessionStorage` — clears when tab closes. Pre-loaded with 6 sample op codes so the picker is functional for demos.
- **"Try as Guest" button** — added to `src/app/signin/page.tsx` below the "Create one" link.
- **proxy.ts split** — `src/lib/supabase/proxy.ts` now separates `AUTH_PAGES` (redirect logged-in users away) from `GUEST_ROUTES` (open to all, no redirect either direction).
- **LogRoForm extended** — `src/components/forms/LogRoForm.tsx` gained `onSave?`, `onCreateOpCode?`, `redirectTo?` props; existing save path unchanged.
- **Committed and pushed** — commit `5d00e96` on `master`, pushed to `origin`.

## Key files for next session

- `src/lib/guest/context.tsx` — guest store (sessionStorage-backed, sample op codes defined here)
- `src/app/guest/layout.tsx` — amber guest banner + GuestStoreProvider wrapper
- `src/app/guest/log/page.tsx` — guest log page; calls `addEntry` from context then redirects to `/guest`
- `src/app/actions/auth.ts` — improved error handling
- `src/lib/supabase/proxy.ts` — updated route gating
- Memory files touched: `/home/slime/Claude-EA/memory/session_state.md`

## Running state

- Background processes: none
- Dev servers / ports: none
- Open worktrees / branches: none — on `master`, up to date with `origin`

## Verification — how to confirm things still work

- `node node_modules/.bin/tsc --noEmit 2>&1 | grep "src/"` from project root — should return nothing (zero source errors)
- After VM pull + rebuild: visit `https://tracker.slimelab.cc/guest` — amber banner visible, nav shows Dashboard / Log RO / History
- After VM pull + rebuild: log a sample RO at `/guest/log`, verify it appears on `/guest` dashboard stats and `/guest/history`
- After VM pull + rebuild: attempt login with wrong password — should show "Incorrect email or password." not "fetch failed"

## Deferred + open questions

- Deferred: **Root cause fix for "fetch failed"** — must be resolved on the VM; see VM instructions in session handoff chat.
- Deferred: Multi-template test with a real second-page RO scan.
- Deferred: Python practice session.
- Open: What exactly did the previous VS Code Claude Code session change on the VM? Those changes are only on the VM filesystem — not committed to this repo. Worth SSHing in and running `git status` / `git diff` in the project folder to see if anything drifted.

## Pick up here

SSH into the VM and run the Supabase diagnostic steps (see session handoff chat); once Supabase is reachable, pull the new commit and rebuild the Docker image to get guest mode and the fixed error messages live.

---

## Carry-forward context (critical gotchas and patterns)

### Next.js version quirks (Next 16.x on this project)
- `params` and `searchParams` in route segments are **Promises** — always `await` them.
- Read `node_modules/next/dist/docs/` for any API you're not certain about.

### Supabase patterns
- All DB calls go through `src/lib/db/index.ts`. Never call `supabase` directly in a server action.
- `flag_hours` on `entries` is maintained by a DB trigger — don't compute/write it manually.
- `timer_start_time` is a `bigint` in the DB (epoch ms) — don't fit it into a postgres `int`.

### NEXT_PUBLIC_* vars are build-time, not runtime
- These are baked into the client JS bundle during `npm run build`. Changing them in `.env` has no effect without rebuilding the image. Always pass them as `build.args` in `docker-compose.yml` and run `docker compose build` when they change.

### Guest mode architecture
- Guest data lives in `src/lib/guest/context.tsx` (GuestStoreProvider + useGuestStore).
- All guest pages are client components under `src/app/guest/`.
- The proxy allows `/guest/*` for all users (auth or not); authenticated users are not bounced away.
- LogRoForm's new props (`onSave`, `onCreateOpCode`, `redirectTo`) are optional — the real save path is untouched.

### Revalidation rules
- `revalidatePath("/", "layout")` required on every timer mutation (nav dot).
- `revalidatePeriodScreens()` in `src/app/actions/settings.ts` — call on splitDay/period override changes.
- `revalidateAll()` in `settings.ts` — call for import and clear-all only.

### Commit style
- Title < 70 chars, imperative mood. Why-focused bulleted body.
- Trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
- Never auto-commit — wait for user confirmation first.

### Do not refactor `src/components/forms/OpCodeModals.tsx` — standing rule.
