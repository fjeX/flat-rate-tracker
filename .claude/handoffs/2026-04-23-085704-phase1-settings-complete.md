# Handoff: Phase 1 complete — all 7 screens shipped. Phase 2 begins.

## Session Metadata
- Created: 2026-04-23 08:57:04
- Project: /home/slime/Projects/flat_rate_tracker
- Branch: main
- HEAD: f1ced97 (Settings screen, committed this session)
- Session duration: ~1 hour

### Recent Commits (for context)
  - f1ced97 Add Settings screen — phase 1 complete
  - 647d638 Add session handoffs: phase 1 Op Codes, Pay Period, Timer
  - 808cedd Add Timer screen with persistent server-side state
  - bf544c9 Add Pay Period screen with discrepancy check
  - c1ab90d Add Op Codes library page with dnd-kit reorder

## Handoff Chain

- **Continues from**: [2026-04-22-192601-phase1-timer-complete.md](./2026-04-22-192601-phase1-timer-complete.md)
  - Previous title: Phase 1 — Timer screen complete. Only Settings remains.
- **Supersedes**: None.

> Read the previous handoff chain for full phase-1 baseline (stack, local dev prereqs, data layer, patterns, Next 16 quirks, Timer architecture). This handoff covers only the Settings delta and what comes next.

## Current State Summary

**Phase 1 is 100% complete and committed.** The Settings screen (§4.7) shipped as `f1ced97` and was browser-tested and approved by the user. All seven phase-1 screens are live: Dashboard, Log RO (create + edit), History, Timer, Pay Period, Op Codes, and Settings. The codebase passes `tsc --noEmit`, `eslint`, and `npm run build` cleanly. The dev server is stopped. Supabase local stack is still running (containers were left up from earlier sessions). **The project now moves to phase 2**, which is homelab deployment on Proxmox + Ubuntu + Traefik + Supabase self-hosted, per `docs/handoff.md` and the user's memory notes.

## Codebase Understanding

### Architecture Overview

Settings follows the same server-page → client-component pattern as every other screen. The page (`src/app/(app)/settings/page.tsx`) is a thin async server component that fetches `getSettings` and passes props down. The three sections are independent client components in `src/components/settings/`.

**New server actions** in `src/app/actions/settings.ts` (alongside the existing period-override actions):
- `setSplitDayAction` — validates 1–30, calls `db.updateSettings`, then `revalidatePeriodScreens()` + `revalidatePath("/settings")`.
- `exportDataAction` — fetches all five data categories in parallel, returns a formatted JSON string. Client turns it into a Blob download.
- `importDataAction(bundle)` — sequential delete-then-insert across all tables; updates settings; calls `revalidateAll()` (a local helper that hits all 8 paths + layout).
- `clearAllDataAction` — same delete pattern, then `db.updateSettings({ splitDay:15, periodOverrides:{} })` + `db.setTimerState(null/null/0)`, then `revalidateAll()`.

**Export JSON shape (version: 1):**
```json
{
  "version": 1,
  "exportedAt": "ISO-string",
  "settings": { "splitDay": number, "periodOverrides": {...} },
  "entries": [...],       // includes nested opCodes[]
  "opCodes": [...],
  "dailyClocks": [...],
  "paidPeriods": [...]
}
```
Import parses client-side first (FileReader), validates version + array presence, shows a count-summary modal, then calls the server action. Timer state is NOT imported (resets to null/0).

**`revalidateAll` helper** (local to settings.ts) hits: `"/" layout`, `/`, `/log`, `/history`, `/pay-period`, `/timer`, `/op-codes`, `/settings`. Any future action that needs a full-app cache flush should call this.

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/app/(app)/settings/page.tsx` | Server page — fetches settings, renders three cards | Entry point |
| `src/app/actions/settings.ts` | ALL settings mutations — period overrides + new splitDay/export/import/clear | Mutations |
| `src/components/settings/SplitDayCard.tsx` | Split-day input with live P1/P2 preview for current month | Section 1 |
| `src/components/settings/DataCard.tsx` | Export button + file-input import with count-summary modal | Section 2 |
| `src/components/settings/DangerZoneCard.tsx` | Type-to-confirm (DELETE) clear-all card | Section 3 |
| `src/lib/db/settings.ts` | `updateSettings`, `setTimerState` — used by clear/import actions | Data layer |
| `src/lib/periods.ts` | `getRangeForPeriodKey`, `formatPeriodLabel`, `isoDate` — imported directly in SplitDayCard client component (pure fns, no server-only deps) | Period preview |
| `docs/handoff.md` | Full product spec — §4.7 (Settings, done), §5 (design notes), §3.x (data model) | Source of truth |

### Key Patterns Discovered (beyond previous handoffs)

- **Pure `src/lib/periods.ts` functions are safe to import in client components.** No server-only APIs used; tree-shaking works fine. `SplitDayCard` imports `getRangeForPeriodKey`, `formatPeriodLabel`, `isoDate` directly.
- **`import type { Foo }` from a `"use server"` file is safe in client components.** `ImportBundle` type is imported from `settings.ts` in `DataCard.tsx` with `import type` — TypeScript strips it; the bundler never sees it at runtime.
- **Client-side FileReader → server action is the right pattern for file uploads that replace data.** Parse + validate on the client (cheap, no round-trip), show confirm modal with counts, then fire the action once on confirm. Avoids streaming multipart to a server action.
- **`revalidateAll()` local helper pattern.** When a mutation touches everything (import, clear), define a local helper that calls all 8 `revalidatePath` calls rather than repeating them in every action.
- **Type-to-confirm for high-blast-radius actions.** `DangerZoneCard` requires the user to type `DELETE` before the button enables. `window.confirm` is used for medium-blast actions (reset timer with time, delete single RO); type-to-confirm is reserved for clear-all.

## Work Completed

### Tasks Finished

- [x] `setSplitDayAction` — validates 1–30, updates DB, revalidates period screens + settings.
- [x] `exportDataAction` — parallel fetch of all data, JSON.stringify, returned as string to client.
- [x] `importDataAction(bundle)` — delete-then-insert all tables, update settings; full revalidation.
- [x] `clearAllDataAction` — delete all tables, reset splitDay+periodOverrides+timer; full revalidation.
- [x] `SplitDayCard` — controlled input, live P1/P2 preview updating as user types, Save button disabled until dirty, "Saved!" flash on success, override-count notice.
- [x] `DataCard` — Download backup button (Blob download), Import backup file picker (hidden input), FileReader parse, count-summary confirm modal, inline success/error messages.
- [x] `DangerZoneCard` — red-bordered card, AlertTriangle icon, description of what gets wiped, type-to-confirm input, clears to "All data cleared. Settings reset to defaults." on success.
- [x] `src/app/(app)/settings/page.tsx` — ComingSoon stub replaced with real server page.
- [x] Verified `npm run build`, `tsc --noEmit` all clean.
- [x] Browser-tested: splitDay save + preview, export download, import replace-with-confirm, danger zone DELETE confirm. User approved.
- [x] Committed as `f1ced97`.
- [x] Dev server stopped.

### Files Modified / Created

| File | Changes | Rationale |
|------|---------|-----------|
| `src/app/(app)/settings/page.tsx` | ComingSoon → async server component | Entry point for the screen |
| `src/app/actions/settings.ts` | Added 4 new actions + `revalidateAll` helper; existing override actions untouched | All settings mutations in one file |
| `src/components/settings/SplitDayCard.tsx` | NEW | Section 1 — pay period defaults |
| `src/components/settings/DataCard.tsx` | NEW | Section 2 — export + import |
| `src/components/settings/DangerZoneCard.tsx` | NEW | Section 3 — danger zone |

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Round-trippable camelCase JSON for export shape | Human-friendly flat format | Backup use case — export/import should be symmetric. Domain types map directly. |
| Client FileReader + count-modal, then server action | Stream file to server action; server-side file parse | Client parse is instant; modal gives user a chance to abort without a server round-trip. |
| Type `DELETE` to confirm clear-all | `window.confirm`; double-confirm button | Higher blast radius than any previous destructive action in the app (§5 design notes). `window.confirm` is reserved for medium-blast. |
| Timer state NOT imported | Import timer state | An imported backup is a data restore, not a device sync. The timer's attached RO ID from months ago could point to a different device's in-flight job. Reset is safer. |
| Clear-all resets `splitDay` to 15 and wipes `periodOverrides` | Keep settings, nuke data only | User confirmed: full nuke = factory reset. `splitDay=15` is the DB default. |
| `revalidateAll()` hits layout + all 8 route paths | Just hit `/`; let ISR cascade | ISR caching is per-path in Next.js app dir — a layout revalidation doesn't automatically cascade to child routes. Explicit is correct. |

## Pending Work

### Immediate Next Steps

**Phase 2: Homelab deployment.** Read `docs/handoff.md` (look for any phase-2 section) and the user's memory notes about their homelab setup. The broad strokes from memory:

1. **Supabase self-hosted** on the Proxmox/Ubuntu stack (Docker Compose). Migration: export from local Supabase (`npx supabase db dump`), import into self-hosted instance. Set up the same schema via migrations.
2. **Next.js deployment**: build the app and deploy to the homelab server. The user uses Traefik as a reverse proxy with a homelab domain. This likely means a Docker container or a systemd service running `next start`.
3. **Environment variables**: swap `.env.local` values to point at the self-hosted Supabase URL and keys instead of localhost.
4. **Auth**: Supabase self-hosted includes GoTrue; make sure the redirect URLs are updated for the homelab domain.

Before starting phase 2, ask the user to confirm the exact target setup and whether they want to start with Supabase migration or the Next.js container first.

### Blockers/Open Questions

- Phase-2 target is not fully spec'd in `docs/handoff.md` as far as we know (previous handoffs don't cover it). Ask the user before assuming the deployment topology.
- The existing data in local Supabase should be migrated to the self-hosted instance. Confirm whether user wants to use the new Export/Import feature for this or use `supabase db dump` + pg_restore directly.

### Deferred Items

- **Atomic RPC for `createEntry` / `updateEntry`** — still pending from earliest handoff's tech-debt list. Low priority.
- **Delete paid-hours-for-a-period UX** — deferred from Pay Period handoff.
- **Cross-device live sync of the nav timer dot** — Supabase Realtime on `user_settings`. Not in spec; deferred.
- **Import is non-transactional** — if op-codes insert succeeds but entries insert fails, DB is partially wiped. Acceptable for a personal app but worth noting.

## Context for Resuming Agent

### Important Context

- **Phase 1 is done. Every ComingSoon stub is replaced.** All seven screens are committed, browser-tested, and approved. Do not look for remaining phase-1 work — there is none.
- **The export/import JSON format is `version: 1`** — if schema changes in the future, bump the version and add a migration path in `importDataAction`.
- **`revalidateAll()` in settings.ts is local (not exported).** If another actions file needs full-app revalidation, either import it (export it first) or duplicate the pattern. Don't silently call it from outside settings.ts.
- **User is new to web dev** (per memory). Explain deployment concepts clearly before diving into phase 2 — Docker Compose, Traefik config, environment variables, and DNS are all things the user may want walked through step by step.
- **User workflow: verify in browser, then commit.** Don't auto-commit. Match commit style (title < 70 chars, bulleted why-focused body, `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`).
- **Don't refactor `src/components/forms/OpCodeModals.tsx`** — standing rule from earlier sessions.
- **Closing-out ritual (for future sessions):** kill dev server → commit → create handoff via `session-handoff` skill.

### Assumptions Made

- User's browser test of Settings covered: splitDay save + live preview, export download (file landed), import replace (count modal + confirm), danger zone DELETE confirm and data wipe. Verified and approved before commit.
- Supabase local stack is still running (containers left up). Verify with `npx supabase status` before starting any new dev session.

### Potential Gotchas

- **Port 3000 orphan** — perennial issue. `lsof -i :3000` → `kill -9 <PID>` if `npm run dev` fails to bind.
- **Next.js 16 `params`/`searchParams` are Promises** — `await` them in any new route that uses them.
- **`import type` from `"use server"` files** — safe. But importing a non-type value from a server action file in a client component without `"use client"` on the importing file would make that file a server module too. Always check the directive.
- **Supabase insert with explicit `id`** — works fine (Postgres accepts client-provided UUIDs on insert). The import action relies on this to preserve op code IDs so entry FK references stay intact.
- **`flag_hours` DB trigger** — the DB trigger recomputes `flag_hours` on `entries` after `entry_op_codes` are inserted. The value we write in the import is immediately overwritten by the trigger. This is fine — the trigger produces the correct value. Don't try to skip inserting it.

## Environment State

### Tools/Services Used

- Supabase local stack: **running** (Docker containers left up).
- Node/Next: Next 16.2.4 with Turbopack on Arch Linux.
- Next dev server: **stopped** at end of session.

### Active Processes

- Supabase Docker containers (check `npx supabase status`)
- No dev server running.

### Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` — points to `http://127.0.0.1:54321` for local dev
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — local dev publishable key
- Both in `.env.local` (gitignored). `.env.example` is the committed template.

## Related Resources

- [Previous handoff — Timer](./2026-04-22-192601-phase1-timer-complete.md)
- `docs/handoff.md` — full product spec (all §4.x screens now done)
- `src/app/actions/settings.ts` — all settings mutations including new ones
- `src/components/settings/` — three new card components
- Memory file: user homelab reference (`reference_homelab.md`) — Proxmox + Ubuntu + Traefik + homelab domain for phase 2

---

**Security Reminder**: Before finalizing, run `validate_handoff.py` to check for accidental secret exposure.
