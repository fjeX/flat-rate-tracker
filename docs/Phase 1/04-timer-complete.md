# Handoff: Phase 1 — Timer screen complete (committed). Only Settings remains.

## Session Metadata
- Created: 2026-04-22 19:26:01
- Project: /home/slime/Projects/flat_rate_tracker
- Branch: main
- HEAD: 808cedd (Timer screen, committed this session)
- Session duration: ~1 hour

### Recent Commits (for context)
  - 808cedd Add Timer screen with persistent server-side state
  - bf544c9 Add Pay Period screen with discrepancy check
  - c1ab90d Add Op Codes library page with dnd-kit reorder
  - 6321f07 Add session handoff: phase 1 Dashboard/Log/History complete
  - 8f78bec Make Log RO's date field actually usable

### Uncommitted changes in working tree
```
?? .claude/handoffs/2026-04-22-150623-phase1-op-codes-library-complete.md   (previous-previous handoff, never committed)
?? .claude/handoffs/2026-04-22-171110-phase1-pay-period-complete.md          (previous handoff, never committed)
?? .claude/handoffs/2026-04-22-192601-phase1-timer-complete.md               (this handoff)
```

Three handoffs are stacked untracked. Repo convention (see `6321f07`) is to bundle them into a single "Add session handoffs" commit. Do that when the user asks, or before starting Settings.

## Handoff Chain

- **Continues from**: [2026-04-22-171110-phase1-pay-period-complete.md](./2026-04-22-171110-phase1-pay-period-complete.md)
  - Previous title: Phase 1 — Pay Period screen complete (committed). Timer + Settings remain.
- **Supersedes**: None.

> Read the previous handoff chain for phase-1 baseline (stack, local dev prereqs, data layer, patterns, Next 16 quirks). This handoff only covers the Timer delta.

## Current State Summary

The `/timer` screen (handoff spec §4.4) is fully implemented and **committed** (`808cedd`). `npm run build`, `tsc --noEmit`, and `eslint` all pass. User browser-tested and approved. **Only the Settings screen (§4.7) remains to close the phase-1 loop.** Dev server was running at the end of testing; it may still be up (bg id `bah1o5qpj`, output at `/tmp/claude-1000/-home-slime-Projects-flat-rate-tracker/4a9fffb8-dc65-4b8c-abfd-12fb029afe99/tasks/bah1o5qpj.output`) — check `lsof -i :3000` before starting a new one.

## Codebase Understanding

### Architecture Overview

Timer reuses the established server-page → client-view pattern and adds one wrinkle: **layout-level state for the nav dot.** The root `app/(app)/layout.tsx` now fetches `user_settings` and passes `timerRunning` to `Nav`. Any mutation that affects timer state calls `revalidatePath("/", "layout")` so the nav re-renders across the entire app. All Timer server actions do this.

The digital display is driven by a 1-second `setInterval` ticker that reads `Date.now()` — the elapsed value is always recomputed as `accumulated + (startTime ? now - startTime : 0)` where `startTime` is authoritative and server-stored. No persistent client state; refreshing mid-session is safe.

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/app/(app)/timer/page.tsx` | Server page — fetches settings, recent 20 entries, library; if attached RO isn't in the recent list, fetches it by id | Entry point |
| `src/app/(app)/layout.tsx` | Now fetches settings and passes `timerRunning` to Nav so the pulsing dot appears app-wide | Nav-dot wiring |
| `src/components/timer/TimerView.tsx` | Client root — ticker, Start/Pause/Resume/Reset, Attached-RO card, Recent-RO picker, status badge | Main logic |
| `src/components/timer/TimerSaveModal.tsx` | Radio list of attached entry's op codes; writes `elapsedMs → hours` (2-dec) to chosen line via `saveTimerToLineAction`; confirms replace if line already has actualHours | Save flow |
| `src/components/layout/Nav.tsx` | Now takes optional `timerRunning` prop; renders green ping-dot beside the Timer tab label when true | Nav UI |
| `src/app/actions/timer.ts` | NEW — `startTimerAction`, `pauseTimerAction`, `resetTimerAction`, `setTimerRoAction`, `saveTimerToLineAction`. All revalidate `/timer` + layout; save also revalidates `/`, `/history`, `/pay-period` | Mutations |
| `src/lib/db/settings.ts` | Untouched. Already had `setTimerState` and the `timer*` columns mapped through `toSettings()` | Data layer |
| `docs/handoff.md` §4.4 | Product spec for Timer | Source of truth |

### Key Patterns Discovered (beyond previous handoffs)

- **Layout-level state for app-wide UI via `revalidatePath("/", "layout")`.** The nav's pulsing dot needs to update from any page (a save on `/timer` should stop it; a start on `/timer` should show it on `/log`). Fetching `timerRunning` in the server layout and revalidating the layout tree on mutation lets the client `Nav` get fresh props without a client context or provider. Any future "app-shell indicator" (unread count, sync status, etc.) should use the same pattern.
- **Recompute-from-source-of-truth, don't persist derived.** Client does `elapsed = accumulated + (startTime ? Date.now() - startTime : 0)` every tick. Paused state simply means `startTime === null`. No client-side elapsed state; no drift accumulation. The only setState per tick is `now`.
- **READY / RUNNING / PAUSED is a derived 3-state, not stored.** `RUNNING ⇔ startTime !== null`. `PAUSED ⇔ startTime === null && elapsed > 0`. `READY ⇔ startTime === null && accumulated === 0`. Keep it derived; the DB has only two fields.
- **Destructive action confirm (`window.confirm`) for "Reset with time on it".** Matches delete-RO / delete-op-code UX from §5 design notes. Resetting an empty timer doesn't confirm (the Reset button is disabled in READY state anyway).
- **Fetch-attached-RO-by-id fallback.** Recent-20 entries may not include the one the user attached days ago. Page fetches `db.getEntry(settings.timerRoId)` iff the id isn't already in the recent list. Cheap — one `maybeSingle()` call at most.
- **Two-decimal rounding for `actualHours` on save.** `Math.round((ms / 3_600_000) * 100) / 100` matches the `numeric(5,2)` column. Sub-36-second timers round to `0.00`h — that's fine, the Save button is anyway disabled when elapsed is zero and nearly-zero saves would be a user error.

## Work Completed

### Tasks Finished

- [x] `src/app/actions/timer.ts` — 5 server actions, all with proper revalidation (layout revalidation for the nav dot).
- [x] `TimerView` — live-ticking display, status badge with its own pulsing dot on RUNNING, Start/Pause/Resume/Reset, Attached-RO card with clear button, Recent-RO picker with "Attached" pill, reset-confirm when elapsed > 0.
- [x] `TimerSaveModal` — radio list of op codes, shows current actual, confirms replace, rounds to 2dp, resets timer on save.
- [x] `Nav` updated to accept `timerRunning` prop and render the green ping-dot.
- [x] `layout.tsx` updated to fetch settings and thread `timerRunning` to Nav.
- [x] `/timer/page.tsx` — server page replacing the `ComingSoon` stub.
- [x] Verified `npm run build`, `tsc --noEmit`, `eslint` all clean.
- [x] Dev server started for user browser test; user approved the flow (READY→RUNNING→PAUSED→save-to-line, attach/clear RO, reset-confirm, nav dot cross-page).
- [x] Committed as `808cedd` in the established style (short title, why-bulleted body, `Co-Authored-By` trailer).

### Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `src/app/(app)/timer/page.tsx` | `ComingSoon` → async server component | Entry point for the new screen |
| `src/app/(app)/layout.tsx` | Fetch settings, pass `timerRunning` to Nav | Nav dot needs app-wide visibility |
| `src/components/layout/Nav.tsx` | Accept `timerRunning?: boolean`; render ping-dot on Timer tab | Nav dot UI |
| `src/app/actions/timer.ts` | NEW | All timer mutations |
| `src/components/timer/TimerView.tsx` | NEW | Client root |
| `src/components/timer/TimerSaveModal.tsx` | NEW | Save-to-line modal |

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Store only `startTime` + `accumulated`; derive RUNNING/PAUSED/READY + elapsed in the client | Store a `status` enum; store elapsed and mutate on every tick | Two numbers + one derivation is the minimum sufficient state. No tick-writes to the DB — we'd be firing server actions every second otherwise. |
| 1s setInterval while RUNNING, no interval when paused | 100ms interval; rAF; interval always-on | 1s matches the HH:MM:SS granularity and avoids unnecessary wake-ups. Paused state never changes — no reason to tick. |
| `revalidatePath("/", "layout")` on every timer mutation | revalidate only `/timer`; pass state to Nav via client context / Zustand | Layout revalidation leverages the server as source of truth and avoids adding a client state layer. The nav dot stays consistent across navigation without any provider. |
| Reset keeps `timerRoId`, only clears time | Reset clears everything | RO and time are separate concepts — the "clear RO" X button exists for clearing RO. Reset is "scrap current time", not "start over completely". Save-to-Job does clear everything (full reset), which matches the spec's "After save, the timer resets." |
| Confirm on Reset only when `elapsed > 0` | Always confirm; never confirm | Matches the app's destructive-action UX (§5 notes: "reset timer with time on it"). No time means no data loss. Reset button is disabled in READY state regardless. |
| Fetch attached RO by id as fallback if not in recent-20 | Fetch a larger window; search all entries | A user could attach an RO then log 20 more before coming back. One extra `maybeSingle()` is cheaper than returning a large window. |
| 2-decimal rounding on save (`Math.round(ms/3_600_000 * 100)/100`) | 1-decimal (matches `fmtHours`); raw float | DB column is `numeric(5,2)` — 2dp is the native storage precision. `fmtHours` only affects display. |
| Timer save modal uses radio-list picker | Dropdown; buttons-per-line | Radio list shows `code`, `description`, current actual, and flag side-by-side. On mobile it stays readable; on desktop it's a single column — consistent with modal style elsewhere. |
| Ship nav dot with `animate-ping` (Tailwind built-in) and a solid inner dot | Custom keyframes; CSS-in-JS | Matches the RUNNING badge inside the timer card — same visual language. Two elements (ping layer + solid dot) is the Tailwind-idiomatic approach. |

## Immediate Next Steps

1. **Build the Settings screen (§4.7).** This is the last phase-1 screen. Subsections:
   - **Pay Period Defaults:** `splitDay` number input (1–30) with a preview of the current month's resulting P1/P2 ranges (computed via `getRangeForPeriodKey` with the new splitDay). If any period overrides exist, show a count with a link to `/pay-period` to manage them.
     - `updateSettings({ splitDay })` already exists in `src/lib/db/settings.ts`. Add a `setSplitDayAction` in `src/app/actions/settings.ts` (same file — the handoff before this one kept overrides there too). Revalidate `/pay-period`, `/history`, `/`.
   - **Data / Export:** Generate a JSON file the user can download containing all their entries + op codes + daily clocks + paid periods + user settings. Pure client-initiated download from a server route or server action returning a Blob; no new DB write.
   - **Data / Import:** File input → parse JSON → confirm → replace-all-data server action. Will need a new action that opens a transaction (or close-enough sequential wipe+insert) for entries/op-codes/clocks/paid/settings. Validate the shape carefully.
   - **Danger Zone / Clear all data:** Double-confirm (per §5 design notes). Server action that deletes entries/op-codes/clocks/paid-periods for the user. Does NOT delete user_settings (it'd cascade-remove the timer state and splitDay); reset those fields explicitly.
2. **Before starting Settings: commit the three stacked handoff files** as one `Add session handoffs` commit, matching the `6321f07` pattern.
3. **Follow the usual flow:** read the spec, draft a component split, show the user, implement, keep dev server running, hand off for browser test, commit when approved.

## Blockers/Open Questions

- None technical. Import/Export JSON shape needs a brief decision with the user: round-trippable exact format (camelCase DB-ish) vs. a human-friendly shape. Recommend the former — it's the backup use case; export/import should be symmetric.
- Clear-all-data: should it also reset `splitDay` and clear `period_overrides`? My read is yes (full nuke = factory reset) but confirm with the user before shipping that branch of logic.

## Deferred Items

- **Atomic RPC for `createEntry` / `updateEntry`** — still pending from earliest handoff's tech-debt list. Low priority.
- **Delete paid-hours-for-a-period UX** — deferred from previous handoff. Consider adding once Settings Import/Export exists (import can clear it implicitly anyway).
- **Cross-device live sync of the nav dot.** Right now a second device sees the new state only after navigation / refresh. Not in spec; probably unnecessary. If it ever comes up: Supabase Realtime on `user_settings`.

## Important Context

- **Timer work is committed as `808cedd`.** Build on top of it freely.
- **Three handoffs are untracked** in `.claude/handoffs/`. Commit them together as `Add session handoffs` (see `6321f07`) — bundling into one keeps the history clean.
- **`revalidatePath("/", "layout")` is load-bearing** for the nav dot. Any new timer mutation MUST include it. Same will apply to `splitDay` changes in Settings (dashboard header label + history pay-period chip both read `getPeriodForDate` in their page render) — already handled by existing `revalidatePeriodScreens()` in `src/app/actions/settings.ts`, just make sure `setSplitDayAction` uses it.
- **User is new to web dev** (per memory). Before diving into Settings, briefly explain the import/export plan at a high level since JSON shape + server actions + file download/upload is several moving pieces.
- **User workflow: verify in browser, then commit.** Don't auto-commit. Match the existing commit style (title < 70 chars, bulleted why-focused body, `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`).
- **Don't refactor `src/components/forms/OpCodeModals.tsx`** — previous-handoff rule, still applies.
- **`window.confirm` is the destructive-action pattern.** Settings' "Clear all data" should be a type-to-confirm or double-confirm per previous handoff's note, since blast radius is much higher than single-RO-delete.
- **`splitDay` range is 1–30, not 1–31.** DB check constraint (`split_day between 1 and 30`) in `docs/handoff.md` §3.7. 31 would break periods in 30-day months.

## Assumptions Made

- User's approval of the Timer browser test covers: READY→RUNNING→PAUSED, Reset with and without elapsed time (confirm dialog), attach/clear RO, Save-to-Job with and without pre-existing actualHours, and the nav dot appearing/disappearing across page navigation. I did not verify cross-device persistence (only one device in the test).
- A 1-second tick is fine. If the user ever wants centisecond precision we'd need ~100ms; not in scope.
- The radio list in Save-to-Job is good enough when a single RO has many op codes. Most ROs have 1–3 lines in practice.

## Potential Gotchas

- **Port 3000 orphan:** Previous handoffs warn of this. `lsof -i :3000` → `kill -9 <PID>` if `npm run dev` fails to bind. Do NOT pick a different port.
- **Dev server from this session may still be running.** Background task id `bah1o5qpj`. Either reuse it or kill and restart.
- **Next.js 16 `params`/`searchParams` are Promises.** Any new Settings route that takes searchParams must `await` them.
- **Hydration warning on `/signin` from Dashlane/1Password:** benign carry-over.
- **Supabase local stack is running** (containers started in earlier sessions). `npx supabase status` to verify before next dev session.
- **`saveTimerToLineAction` does a 2-step (update line, reset timer) non-transactionally.** If the line update succeeds but the timer reset fails, the user would see the actualHours saved but the timer not reset. Extremely unlikely (same request, same DB) but document if it ever bites.
- **Timer `startTime` is a `bigint` in the DB.** Node numbers are 2^53; epoch-ms is fine for ~285k years. Don't worry about it, but don't try to fit it into a postgres `int` either.
- **The status badge's own pulsing dot (inside the timer card) and the nav's pulsing dot share the same Tailwind `animate-ping` — if you change the keyframe speed anywhere, the other will look off.** Keep them in sync.

## Environment State

### Tools/Services Used

- Supabase local stack: running (containers left up from prior sessions).
- Node/Next: Next 16.2.4 with Turbopack on Arch Linux.
- Next dev server: **running in background** at end of session — pid held by bg task `bah1o5qpj`. Output at `/tmp/claude-1000/-home-slime-Projects-flat-rate-tracker/4a9fffb8-dc65-4b8c-abfd-12fb029afe99/tasks/bah1o5qpj.output`. May still be alive; check `lsof -i :3000`.

### Active Processes

- `supabase` Docker containers
- Possibly the Next dev server (see above)

### Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` (local dev → http://127.0.0.1:54321)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (local dev publishable key)
- Both in `.env.local` (gitignored); `.env.example` is the committed template.

## Related Resources

- [Previous handoff — Pay Period](./2026-04-22-171110-phase1-pay-period-complete.md)
- [Handoff before that — Op Codes](./2026-04-22-150623-phase1-op-codes-library-complete.md)
- [Original baseline — Dashboard/Log/History](./2026-04-22-130854-phase1-dashboard-log-history-complete.md)
- `docs/handoff.md` §4.4 (Timer — done), §4.7 (Settings — next)
- `docs/handoff.md` §3.6, §3.7 (user_settings data model + schema + splitDay constraint)
- `src/lib/db/settings.ts` — `updateSettings({ splitDay })` and `setTimerState` already implemented
- `src/app/actions/settings.ts` — `setPeriodOverrideAction` / `clearPeriodOverrideAction` already here; add `setSplitDayAction` + Import/Export/Clear-all actions here too
- `src/lib/periods.ts` — `getRangeForPeriodKey` for the Settings preview
- `src/components/forms/` — reference shape for form components when building Settings forms

---

**Security Reminder**: Before finalizing, run `validate_handoff.py` to check for accidental secret exposure.
