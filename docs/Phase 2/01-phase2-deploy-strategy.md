# Session Handoff — Phase 1 complete (all 7 screens shipped). Phase 2 (homelab deploy) begins.

## Where it started

The goal was to build a Flat Rate Tracker web app for automotive flat-rate technicians to log repair orders and reconcile flagged vs paid hours. Phase 1 targeted a fully working app running locally on the user's Arch laptop — all seven screens implemented end-to-end with Supabase local Docker stack and Next.js. Phase 1 is 100% complete and committed. The project now moves to Phase 2: self-hosted deployment on the user's Proxmox homelab with Traefik, a homelab subdomain, and self-hosted Supabase.

## Decisions locked + what shipped

- **Auth (sign in / sign up / sign out)** — Email+password with Supabase GoTrue. Local dev disables email confirmation. Lives in `src/app/signin/page.tsx`, `src/app/signup/page.tsx`, `src/app/actions/auth.ts`.
- **Dashboard (§4.1)** — Clocked-hours card, 4 stat cards (Today/Week/Period/Month), Recent-ROs list. Lives in `src/app/(app)/page.tsx`, `src/components/dashboard/`.
- **Log RO / Edit RO (§4.2)** — Full form with typeahead op-code picker, custom + library op-code modals, flag/actual hours per line, RO# uniqueness check. Lives in `src/app/(app)/log/page.tsx`, `src/components/forms/LogRoForm.tsx`, `src/components/forms/OpCodeModals.tsx`.
- **History (§4.3)** — Filter chips, search, summary bar, entry list, RO detail modal. Lives in `src/app/(app)/history/page.tsx`, `src/components/history/HistoryView.tsx`.
- **Timer (§4.4)** — HH:MM:SS digital display, READY/RUNNING/PAUSED (derived state), server-persisted start time + accumulated ms, attach RO, save to op-code line, nav pulsing dot. Lives in `src/app/(app)/timer/page.tsx`, `src/components/timer/`, `src/app/actions/timer.ts`.
- **Pay Period (§4.5)** — Period selector, custom date override modal, discrepancy check card (±0.1 tolerance), RO list for the period. Lives in `src/app/(app)/pay-period/page.tsx`, `src/components/pay-period/`.
- **Op Codes library (§4.6)** — dnd-kit drag-reorder, search, add/edit/delete modal, seed defaults on new account. Lives in `src/app/(app)/op-codes/page.tsx`, `src/components/op-codes/`.
- **Settings (§4.7)** — SplitDay card with live P1/P2 preview, Data card (export JSON + import JSON with count-confirm modal), Danger Zone card (type "DELETE" to confirm clear-all). Lives in `src/app/(app)/settings/page.tsx`, `src/components/settings/`, `src/app/actions/settings.ts`.
- **RO Detail Modal (§4.8)** — Opens from any RO click app-wide. Editable actual-hours per line (blur-saves), Edit/Delete/Close buttons. Lives in `src/components/ro/RoDetailModal.tsx`.
- **Export JSON shape (version 1)** — `{ version:1, exportedAt, settings, entries, opCodes, dailyClocks, paidPeriods }`. Timer state is excluded from import (always resets). Import is non-transactional (delete-then-insert per table); acceptable for a personal app.
- **Server-page → client-component pattern** — Every screen is a thin async server component that fetches data and passes props to a `"use client"` view component. No client-side data fetching; all mutations are server actions.
- **Layout-level timer dot** — `src/app/(app)/layout.tsx` fetches `timerRunning` from settings and passes it to Nav. Every timer mutation calls `revalidatePath("/", "layout")`.
- **`revalidateAll()` helper in settings.ts** — Local helper hitting all 8 route paths + layout. Call it for any mutation that touches every screen (import, clear-all).
- **Do not refactor `src/components/forms/OpCodeModals.tsx`** — standing rule from earlier sessions.
- **Three-phase deploy strategy** — Phase 1: local only (done). Phase 2: homelab Proxmox/Ubuntu/Traefik/self-hosted Supabase. Phase 3 (maybe): Vercel + Supabase cloud.
- **All config is env-driven** — DB URL, Supabase keys, auth redirect URLs all read from env. `.env.local` for local dev (gitignored); `.env.example` is the committed template.

## Key files for next session

- `/home/slime/Projects/flat_rate_tracker/docs/handoff.md` — Full product spec (§1–§7). All §4.x screens are done. Read §3.x for data model and §3.7 for schema SQL.
- `/home/slime/Projects/flat_rate_tracker/src/app/actions/settings.ts` — All settings mutations including `exportDataAction`, `importDataAction`, `clearAllDataAction`, `setSplitDayAction`, and the `revalidateAll()` helper.
- `/home/slime/Projects/flat_rate_tracker/src/lib/db/settings.ts` — `updateSettings`, `setTimerState`, `getSettings` — the data-layer entry point for user settings and timer state.
- `/home/slime/Projects/flat_rate_tracker/src/lib/supabase/` — `client.ts` (browser), `server.ts` (RSC/server actions), `proxy.ts`, `database.types.ts`. Any phase-2 wiring of self-hosted Supabase touches env vars read here.
- `/home/slime/Projects/flat_rate_tracker/.env.example` — Template for all required env vars. Self-hosted Supabase will need `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the service-role key (if used server-side).
- `/home/slime/Projects/flat_rate_tracker/supabase/` — Supabase CLI project dir (migrations, config). Use `npx supabase db dump` to export local schema for importing into self-hosted instance.
- Memory files: `/home/slime/.claude/projects/-home-slime-Projects-flat-rate-tracker/memory/reference_homelab.md` — Proxmox + Ubuntu + Traefik + homelab domain details for phase 2 infra.

## Running state

- Background processes: none (dev server was stopped at end of Settings session).
- Dev servers / ports: none. Start with `npm run dev` from `/home/slime/Projects/flat_rate_tracker`. Binds to `http://localhost:3000`. If port 3000 is taken: `lsof -i :3000` → `kill -9 <PID>`.
- Supabase local Docker stack: **likely still running** from prior sessions. Verify with `npx supabase status` before starting dev. If not running: `npx supabase start` from the project root.
- Open worktrees / branches: none. Branch is `main`.

## Verification — how to confirm things still work

- `npx supabase status` — confirms local Supabase containers are up and shows the local API URL + keys.
- `npm run build` from `/home/slime/Projects/flat_rate_tracker` — should exit 0 with no TypeScript or lint errors (last verified at commit `f1ced97`).
- `npx tsc --noEmit` — should produce no output (clean).
- Visit `http://localhost:3000` after `npm run dev` — sign in, create an RO, check Dashboard stats, run Timer, verify Settings export downloads a valid JSON file.

## Deferred + open questions

- Deferred: Atomic RPC for `createEntry` / `updateEntry` — non-transactional double-write (entries + entry_op_codes) is currently fine; flagged as tech debt since earliest session.
- Deferred: Delete paid-hours-for-a-period UX — no UI to remove a PaidPeriod row; import/clear-all are the only escape hatches.
- Deferred: Cross-device live sync of the nav timer dot — Supabase Realtime on `user_settings` would fix it; not in spec, not needed for phase 1.
- Deferred: Import is non-transactional — if op-codes insert succeeds but entries insert fails, DB is partially wiped. Acceptable for a personal app.
- Open: Phase 2 deployment topology not fully spec'd — does the user want to start with Supabase self-hosted first, or the Next.js container first? Confirm before starting phase 2 work.
- Open: Data migration path — use the new Export/Import feature (Settings → Export on local → Import on self-hosted) or `supabase db dump` + `pg_restore`? Confirm with user.
- Open: Auth redirect URLs — self-hosted Supabase GoTrue needs the homelab domain added to `GOTRUE_SITE_URL` and `GOTRUE_MAILER_URLPATHS_CONFIRMATION`. Confirm the exact homelab domain before wiring.

## Pick up here

Ask the user to confirm: (1) which phase-2 component to start with (Supabase self-hosted setup or Next.js Docker container), and (2) the exact homelab domain/subdomain they want the app to live at — then read `reference_homelab.md` in memory before writing any config.

---

## Carry-forward context (critical gotchas and patterns)

These do not change between sessions — internalize before writing any new code.

### Next.js version quirks (Next 16.x on this project)
- `params` and `searchParams` in route segments are **Promises** — always `await` them.
- Read `node_modules/next/dist/docs/` for any API you're not certain about; this version has breaking changes from training data.

### Supabase patterns
- All DB calls go through `src/lib/db/index.ts` (re-exports the `db` object from individual files). Never call `supabase` directly in a server action — go through `src/lib/db/`.
- `flag_hours` on `entries` is maintained by a DB trigger that sums `entry_op_codes.flag_hours` — don't try to compute and write it manually; the trigger overwrites it.
- Insert with explicit `id` (client-provided UUID) works fine in Postgres. Import action uses this to preserve op-code IDs so entry FK references survive.
- `timer_start_time` is a `bigint` in the DB — epoch ms, safe for ~285k years, but don't fit it into a postgres `int`.

### Revalidation rules
- `revalidatePath("/", "layout")` is required on every timer mutation (nav dot).
- `revalidatePeriodScreens()` (in `src/app/actions/settings.ts`) hits `/`, `/history`, `/pay-period` — call it whenever `splitDay` or period overrides change.
- `revalidateAll()` (local to `settings.ts`, not exported) hits layout + all 8 routes — use it for import and clear-all only.

### Commit style
- Title < 70 chars, imperative mood.
- Why-focused bulleted body.
- Trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` (use whatever model is active).
- Never auto-commit — always wait for user browser approval first.

### Destructive action UX hierarchy
- `window.confirm` — medium blast (delete single RO, delete single op code, reset timer with time).
- Type-to-confirm input — high blast (clear all data in Settings Danger Zone, requires typing `DELETE`).
- Double-confirm button — not used yet, reserved for future.
