# Session Handoff: Phase 1 — Dashboard, Log RO, and History complete

## Metadata

- **Created:** 2026-04-22 13:08:54
- **Project:** Flat Rate Tracker (web app for automotive flat-rate techs)
- **Project root:** `/home/slime/Projects/flat_rate_tracker`
- **Repo:** https://github.com/fjeX/flat-rate-tracker (private)
- **Branch:** `main`
- **HEAD:** `8f78bec` — "Make Log RO's date field actually usable"
- **Working tree:** clean (only `session-handoff.md` is untracked — it's the skill README dropped into the repo root by the user)
- **Continues from:** none — this is the first handoff for this project

Recent commits (newest → oldest):
```
8f78bec Make Log RO's date field actually usable
8cde77e Fix nested-form bug that ate Log RO progress on op-code modals
592f61e Add History page + reusable RO detail modal
ea5f564 UX polish on Log RO and Dashboard
56a7a60 Add Dashboard + Log RO screens with shared app shell
3d76768 Add domain types + Supabase data layer
0384672 Add email+password auth via Supabase SSR
80bacd5 Add Supabase CLI + initial schema migration
27d7ecf Ignore per-machine Claude Code local settings
e6f7908 Initial commit from Create Next App
```

---

## 1. Current State Summary

Flat Rate Tracker has reached a **functional MVP for the core logging loop**. The user can:

- Sign up / sign in / sign out (Supabase Auth, email+password, email confirmation off in dev)
- Log a new repair order with op codes from a typeahead library, one-time "Other" custom op codes, or newly-created library entries
- Edit existing ROs (`/log?edit=<id>`)
- See daily / weekly / pay-period / monthly stats on the Dashboard with live efficiency calc
- Enter today's clocked hours (saves on blur + Enter)
- Browse all ROs on History with filter chips (Today/Week/Period/Month/All/Custom), search across RO# / vehicle / notes, and a summary bar
- Open a reusable **RO detail modal** from the Dashboard or History that shows all lines, lets you edit any actual-hours inline, delete the RO with confirmation, or jump to full-form edit

Everything in this list has been verified end-to-end in the browser by the user, with two round-trips of bug reports already fixed (nested-form bug, date-field dark-mode styling).

**Deploy phase:** 1 (local-only). Users testing this personally for ~1 month before Phase 2 NAS deployment.

---

## 2. Important Context

### Stack (see `docs/handoff.md` for full product spec)
- **Framework:** Next.js 16.2.4 with Turbopack, App Router, React 19.2.4, TypeScript strict
- **Styling:** Tailwind v4 (via `@tailwindcss/postcss`); dark-mode only, orange accent on zinc neutrals
- **Backend:** Supabase — local Docker stack via `supabase` CLI v2.93.0. Postgres 17.
- **Auth:** `@supabase/ssr` with new-style `sb_publishable_...` publishable keys
- **Icons:** `lucide-react`

### Local dev prerequisites (these are non-obvious)
1. **Docker must be accessible as user `slime`** — the user had to reboot once to pick up docker group membership; this is done.
2. **Supabase local stack** must be running before `npm run dev`:
   ```
   npx supabase start    # pulls ~1GB images first time, ~5s on subsequent starts
   npx supabase stop     # when done
   npx supabase status   # check services, get keys
   ```
   Studio at http://127.0.0.1:54323, Mailpit at :54324, DB at :54322, API at :54321.
3. **Environment variables** in `.env.local` (gitignored; `.env.example` is committed as a template):
   - `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (from `npx supabase status`)

### Next.js 16 specifics (these **differ from training data**)
- Middleware is renamed to **proxy**. Our session-refresh lives in `src/proxy.ts` and `src/lib/supabase/proxy.ts`. Do NOT create a `middleware.ts`.
- `cookies()`, `headers()`, and route `params`/`searchParams` are **all async** — you must `await` them.
- React 19's `react-hooks/set-state-in-effect` lint rule is strict; the pattern we use for "reset state on modal open" is to put the state-holding component inside the Modal body (which itself returns null when closed), so open → mount → fresh state.
- The `AGENTS.md` at repo root explicitly warns agents about Next 16 breakage and points to `node_modules/next/dist/docs/`.

### User profile
- User is new to web app development (comfortable with Linux/Docker/homelab, not with JS tooling).
- They want high-level walk-throughs before non-obvious changes and like seeing each chunk atomic commit with a clear commit body.
- They appreciate polish — they've flagged UX bugs twice now and both were correct.
- Deploy plan is in `.claude/../memory/project_flat_rate_tracker.md`: phase 1 local now → phase 2 self-host on Proxmox/Ubuntu/Traefik with homelab subdomain → phase 3 maybe Vercel + paid domain. Env-driven and migration-based code means no rewrites between phases.

---

## 3. Decisions Made

### Architecture-level

| Decision | Rationale |
|---|---|
| Route group `(app)` wraps authenticated pages with a shared layout (Header + Nav); `/signin`, `/signup` are outside it | Keeps auth gating in one place and lets public pages have no app chrome. The route group is URL-invisible. |
| All DB functions take a `SupabaseClient` as first arg (lives in `src/lib/db/`) | Same functions work from Server Components, Server Actions, and Client Components without duplication. |
| Snake_case in DB, camelCase in TS; mapper functions per resource | Matches each side's convention. Mappers are in the `db/*.ts` files, private to the module. |
| `Database` type auto-generated from live schema → `src/lib/supabase/database.types.ts` | Regenerate after **every** migration. Command: `npx supabase gen types typescript --local > src/lib/supabase/database.types.ts` then strip the first-line "Connecting to db 5432" noise. |
| Server actions throw on error; clients catch and surface; server calls `revalidatePath` but lets the client do `router.push` | Keeps error handling in React-land rather than dealing with `redirect()` NEXT_REDIRECT throws inside try/catch. |
| Stats aggregation done in `src/lib/stats.ts` against in-memory entries | Personal data volumes are small. Avoids N DB roundtrips. Dashboard fetches one wide window (start-of-month → today) and filters. |
| Period keys are `"YYYY-MM-P1"` / `"YYYY-MM-P2"` strings; period math in `src/lib/periods.ts` is **string-based** (YYYY-MM-DD) to avoid timezone drift | When Phase 2 hits servers in UTC, Date objects with local TZ would disagree with client. Strings don't. |
| DB trigger `entry_op_codes_recompute_aiud` keeps `entries.flag_hours` in sync with `sum(entry_op_codes.flag_hours)` | Clients never have to maintain it; updates cascade correctly on line changes. |
| DB trigger `on_auth_user_created` seeds `user_settings` + 6 default op codes for every new auth user | Single source of truth for "what a fresh account looks like." |
| Atomic create-entry-with-lines is **not yet** implemented via RPC — we insert entry then lines sequentially with best-effort cleanup on failure | Known gap; acceptable for phase 1. Flagged in the commit message for `3d76768`. Promote to RPC later. |

### UI-level

| Decision | Rationale |
|---|---|
| Log RO form's outer element is a `<div>`, not a `<form>`; Save button is `type="button" onClick={handleSave}` | Modals use their own `<form>` for Enter-to-submit; nested forms caused a nasty bug where modal submits bubbled to the outer form and triggered a full RO save. Commit `8cde77e` for full context. |
| "Custom" op-code terminology was renamed to "Other" throughout per user preference | User's word choice; applies to dropdown buttons, modal titles, and per-line badges. |
| Dashboard's Recent ROs and the History list both use the same `RoList` component, which opens the same `RoDetailModal` | Handoff spec: "Opens from any RO# click anywhere in the app." |
| `color-scheme: dark` on `:root` | Dark-mode-only app; without this, native widgets (date picker icon, number spinners) render OS-default and are invisible on light-OS machines. |

---

## 4. Immediate Next Steps

The user's last instruction was: *"Let's add the ability to change the date when logging an RO before continuing on."* That was shipped in commit `8f78bec`. After that the user asked for this handoff. So:

**Step 1: Ask the user to pick the next screen to build.** They have four choices (any of the remaining tabs from the handoff doc §4):

1. **Op Codes library page** (`/op-codes`) — currently a `ComingSoon` placeholder. Needs:
   - Add / edit / delete library op codes
   - **Drag-and-drop reorder with `@dnd-kit/core` + `@dnd-kit/sortable`** (handoff spec §4.6 explicitly calls for this; native HTML5 drag was rejected because it doesn't work on mobile).
   - Search bar that hides the drag handles when a query is active
   - `listOpCodes`, `createOpCode`, `updateOpCode`, `deleteOpCode`, `reorderOpCodes` are all already in `src/lib/db/op-codes.ts`.

2. **Timer** (`/timer`) — currently a `ComingSoon` placeholder. Needs:
   - Big digital HH:MM:SS display with READY / RUNNING / PAUSED states
   - Start / Pause / Reset controls
   - "Attached RO" section with clear button + recent ROs list for picking one
   - "Save to Job" button opens a modal listing the attached RO's op codes; user picks one; replaces `actualHours` (with confirm if one already exists)
   - **Persistent across devices** — timer state stored server-side in `user_settings` (`timer_ro_id`, `timer_start_time`, `timer_accumulated`); `setTimerState` already exists in `src/lib/db/settings.ts`
   - Green pulsing dot on the Timer tab in the Nav when timer is running (requires moving Nav to a context-aware component or passing timer state into the layout)

3. **Pay Period** (`/pay-period`) — currently placeholder. Needs:
   - Period selector dropdown (lists periods with entries/paid/overrides)
   - Set custom dates / Edit custom dates / Reset to default controls
   - 4 mini stats (RO count, Flag, Clocked, Efficiency)
   - Pay Discrepancy Check card: Actual Paid input, Logged (readonly), Difference (color-coded, ±0.1h tolerance for match)
   - ROs-in-period list (uses `RoList` again)
   - All data-layer functions exist: `listPaidPeriods`, `getPaidPeriod`, `upsertPaidPeriod`, and period math in `src/lib/periods.ts`.

4. **Settings + data import/export** — currently placeholder. Needs:
   - Pay Period defaults (splitDay number input with preview of resulting ranges)
   - Export JSON (full user data dump)
   - Import JSON (replaces all data, with confirm)
   - Danger Zone: Clear all data (double confirm)

**Recommendation to present to user:** Op Codes library is the most self-contained (~200 lines, no new dependencies except `@dnd-kit`); Timer is the most novel (persistent cross-device state, interesting design); Pay Period is the most product-valuable (it's what makes the whole discrepancy-check value prop real). Settings is the smallest.

---

## 5. Pending Work

### Screens (all from handoff §4, in handoff's suggested order)
- [ ] Op Codes library page (`src/app/(app)/op-codes/page.tsx`)
- [ ] Timer (`src/app/(app)/timer/page.tsx`)
- [ ] Pay Period (`src/app/(app)/pay-period/page.tsx`)
- [ ] Settings + data import/export (`src/app/(app)/settings/page.tsx`)

### Known tech debt (flagged in commits)
- [ ] Promote `createEntry` / `updateEntry` to an atomic Postgres function called via `supabase.rpc()` — currently it inserts entry then lines sequentially with best-effort cleanup. Commit `3d76768` flags this. Low priority for phase 1.
- [ ] Timer tab's green-pulse indicator when running needs to live in the shared Nav — likely means lifting timer state into a client context or making Nav server-component-aware of the user's `user_settings.timer_start_time`.

### Phase transitions (future, don't block on them)
- [ ] Phase 2: Docker Compose for self-hosted Supabase + Next.js on user's Proxmox Ubuntu VM. Env-driven means swap the URL/keys and adjust Traefik labels.
- [ ] Phase 2: turn email confirmation back ON in `supabase/config.toml` (currently `enable_confirmations = false` at line 219).
- [ ] Phase 3: maybe Vercel + Supabase cloud.

---

## 6. Critical Files

### Config & schema
- `supabase/config.toml` — Supabase local config (auth settings, ports, etc.). Email confirmation disabled at line ~219.
- `supabase/migrations/20260422005715_initial_schema.sql` — full DB schema, RLS policies, triggers.
- `src/lib/supabase/database.types.ts` — auto-generated from schema; regenerate after migrations.
- `.env.local` (gitignored) — Supabase URL + publishable key for local dev.
- `.env.example` — template for new dev machines.
- `docs/handoff.md` — full product spec from the user (data model, screen-by-screen features, design system). Read this when unsure what a screen should do.

### Entry points
- `src/proxy.ts` — Next 16 proxy (formerly middleware); session refresh + auth route-gating.
- `src/app/layout.tsx` — root layout (fonts, metadata, html/body).
- `src/app/(app)/layout.tsx` — authenticated layout (Header + Nav + auth gate).
- `src/app/(app)/page.tsx` — Dashboard.
- `src/app/(app)/log/page.tsx` — Log RO (server fetches library + optional edit entry).
- `src/app/(app)/history/page.tsx` — History (server fetches all entries + settings).

### Data layer — `src/lib/db/`
- `_client.ts` — `DbClient` type + `getCurrentUserId(supabase)` helper.
- `entries.ts` — RO CRUD + `setLineActualHours`.
- `op-codes.ts` — library CRUD + `reorderOpCodes`.
- `settings.ts` — settings read/write + `setTimerState` (for Timer tab).
- `daily-clock.ts` — daily clocked hours upsert.
- `paid-periods.ts` — per-period paid-flag-hours upsert.
- `index.ts` — barrel export (`import * as db from "@/lib/db"`).

### Server actions — `src/app/actions/`
- `auth.ts` — signUp / signIn / signOut.
- `entries.ts` — `saveEntry` (create or update; validates RO# uniqueness), `deleteEntryAction`, `setLineActualHoursAction`.
- `op-codes.ts` — `createLibraryOpCode` (used by Log RO's "Create new library op code" modal).
- `daily-clock.ts` — `upsertDailyClockHoursAction`.

### Key components
- `src/components/layout/{Header,Nav}.tsx` — shared app shell.
- `src/components/ui/Modal.tsx` — reusable modal (bottom-sheet on mobile, centered on desktop, Escape-to-close, backdrop-click-to-close, body-scroll lock).
- `src/components/forms/LogRoForm.tsx` — Log RO form (client, ~550 lines). **This is a `<div>` not a `<form>`** — see Decisions §3.
- `src/components/forms/OpCodeModals.tsx` — the two op-code modals (Custom/Other + New Library).
- `src/components/ro/RoList.tsx` — list of ROs with pills; opens the detail modal.
- `src/components/ro/RoDetailModal.tsx` — RO detail modal; editable actual hours, delete, edit.
- `src/components/dashboard/{ClockedHoursInput,StatCard}.tsx` — Dashboard pieces.
- `src/components/history/HistoryView.tsx` — filters + search + summary + list.
- `src/components/ComingSoon.tsx` — placeholder used by the 4 unbuilt tabs.

### Utilities
- `src/lib/types.ts` — domain types (camelCase). The shape components use.
- `src/lib/periods.ts` — string-based date math; period resolution; formatting.
- `src/lib/stats.ts` — aggregation + formatting helpers (`fmtHours`, `fmtPct`, `computeEfficiency`).

---

## 7. Key Patterns Discovered

### Component patterns
- **Client vs Server:** Pages are Server Components by default and fetch data. Interactive sub-trees (forms, modals, list-with-selected-item) are Client Components marked `"use client"`. Pass server-fetched data as props.
- **Avoiding react-hooks/set-state-in-effect:** Don't use `useEffect` to reset state on prop change. Instead, render the state-holding component inside a conditional parent (like `<Modal>` which returns null when closed). On open, the child mounts fresh; on close, it unmounts. See `CustomOpCodeBody` / `NewLibraryBody` in `OpCodeModals.tsx`.
- **Click-outside:** `useEffect` + mousedown listener + ref on the container. See the op-code picker in `LogRoForm.tsx`.
- **Router.refresh after mutation:** Server actions call `revalidatePath`; client calls `router.refresh()` after success to sync server-rendered data. See the editable actual-hours in `RoDetailModal`'s `LineRow`.

### Form patterns
- Raw-string state for numeric inputs that must be clearable — see `ClockedHoursInput` and `RoDetailModal`'s `LineRow`. Otherwise `0` persists and blocks clearing.
- Server-side validation in the action (throws); client catches and displays error.
- RO# uniqueness enforced via `getEntryByRoNumber` check in `saveEntry` action (excludes the edited entry's own id).

### Supabase patterns
- Every mutation goes through a server action → server-side Supabase client → data layer function. Gives us RLS enforcement + automatic cookie handling.
- `.select()` with nested join: `.select("*, entry_op_codes(*)")` — used in `entries.ts` to fetch entries with their lines in one roundtrip.
- `.upsert(..., { onConflict: "user_id,date" })` for daily clock and paid period tables.

### Route-group trick for public vs private
```
src/app/
  layout.tsx            ← root (html, body, fonts only)
  signin/, signup/      ← public routes, no shell
  (app)/
    layout.tsx          ← auth gate + shared Header + Nav
    page.tsx, log/, history/, ...
```

---

## 8. Potential Gotchas

1. **Port 3000 can get held by orphan dev servers.** Seen multiple times; `kill -9` the PID shown in the "Another next dev server is already running" message, or reboot.
2. **After running a migration, regenerate the Database types:** `npx supabase gen types typescript --local > src/lib/supabase/database.types.ts` then remove the first-line "Connecting to db 5432" noise.
3. **Dashlane / 1Password / other password managers cause a benign hydration warning** on `/signin` and `/signup` by injecting `data-dashlane-*` attributes after hydration. Ignore. Disappears in incognito.
4. **Next.js 16 route `params` and `searchParams` are Promises.** `await` them:
   ```tsx
   export default async function Page({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
     const { edit } = await searchParams;
     ...
   }
   ```
5. **Do NOT nest `<form>` elements.** The Log RO's outer element is a `<div>` for this reason (commit `8cde77e` fixed this the hard way).
6. **Timer state in `user_settings`** stores `timer_start_time` as epoch ms (bigint). Client needs to compute elapsed as `Date.now() - timer_start_time + timer_accumulated` when running, or just `timer_accumulated` when paused. See the handoff doc `docs/handoff.md` §3.6.
7. **"This Week" starts on Sunday** per handoff. Implemented in `src/lib/periods.ts`. Don't change to Monday without asking.
8. **RLS policies are strict.** If a query returns empty where you expected rows, double-check the client is authenticated and the row's `user_id` matches the current user. Studio at :54323 lets you disable RLS temporarily to debug, but remember to turn it back on.
9. **`user_settings` has `period_overrides jsonb`** — in TS it's `Record<string, {start: string, end: string}>`. The mapper in `settings.ts` handles the cast.
10. **The seed trigger depends on `auth.users` inserts.** Deleting a user cascades settings + op codes (tested). Creating a user OUTSIDE the normal signup flow (e.g. via raw SQL `insert into auth.users`) also fires the trigger, as expected.

---

## 9. Handoff Chain

- **Previous:** none — this is the first handoff.
- **Next:** will link back to this file (`2026-04-22-130854-phase1-dashboard-log-history-complete.md`) via `--continues-from` when it's created.

---

## 10. Resume Checklist for the Next Agent

Before writing any code:

1. [ ] Read `docs/handoff.md` (the product spec — 355 lines, essential).
2. [ ] Read `AGENTS.md` at repo root (1 paragraph, warns about Next 16 breakage).
3. [ ] Read `src/lib/types.ts` (domain types — short, gives you the vocabulary).
4. [ ] Read `src/app/(app)/log/page.tsx` + `src/components/forms/LogRoForm.tsx` for the exemplar end-to-end pattern (server page → client form → server action → DB → revalidate → router.push).
5. [ ] Skim `src/lib/db/index.ts` barrel to see what's available.
6. [ ] Run `npx supabase status` — confirm the stack is up. If not, `npx supabase start`.
7. [ ] Run `npm run dev` — confirm dev server boots cleanly. Hit http://localhost:3000.
8. [ ] Ask the user which of the four remaining tabs they want next (see §4 Immediate Next Steps).

---

## Validation

- [x] No `[TODO: ...]` placeholders remain.
- [x] All 10 required sections populated.
- [x] No secrets (publishable keys are safe-by-design; no service-role key; no `.env.local` contents).
- [x] All referenced files exist at the cited paths (verified against `ls`/`find`).
