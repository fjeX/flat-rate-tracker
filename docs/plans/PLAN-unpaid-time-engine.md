# PLAN — Unpaid Time Engine + 3-Slot Timer

**Status:** design locked 2026-07-24. **Phase 1 built 2026-07-24** — not yet deployed
(migration not applied, UI visual gate not run; see "Verification state" at the bottom).
Phases 2–3 not started.
**Supersedes nothing.** Independent of PLAN-ocr-claude-vision / PLAN-nl-ro-entry / PLAN-insights-page.

## The thesis

A flat-rate tech gets paid for flagged hours. Everything else — redoing your own work
for free, cleaning up another tech's comeback, standing around waiting on parts or an
approval — is time you are physically at the shop, on the clock, earning nothing.

Today the app records that time as *nothing*, or worse, as **your fault**. A day spent
on a comeback reads as "0% efficiency — slow day." A day spent waiting on parts reads as
"Nothing logged yet today," which is indistinguishable from not showing up.

This plan closes that hole. Every hour on the clock lands in a named bucket, unpaid time
becomes a number you can show someone, and the timer becomes the thing that captures it
without extra logging.

---

## Locked decisions (from the 2026-07-24 grilling)

| # | Decision | Why |
|---|---|---|
| 1 | A comeback may be a **new RO or appended to the original** — both happen at Liem's shop | Model must support both shapes |
| 2 | **Same-visit rework** (catch your own mistake before delivery) is modeled as unpaid time | Same economic event; keeps true job cost honest |
| 3 | **Another tech's comeback** gets its own bucket, tracked separately | Different story: someone else's mistake costing you money. Strongest goodwill-time argument there is |
| 4 | Hold statuses **keep counting**, into a separate waiting accumulator | This is what turns a status chip into data |
| 5 | **One timer "working" at a time**; holds may accrue concurrently | Working hours can never exceed the wall clock |
| 6 | Forgotten timers **auto-stop at scheduled shift end**, confirm on return | Uses the schedule that already exists; no 16-hour phantom jobs |
| 7 | **Raw efficiency is unchanged.** Attribution is shown beside it | The number stays honest; the wage-check's piece-rate math depends on it |
| 8 | Comeback entry uses a **toggle that zeroes and locks flag hours** | The auto-fill trap (below) makes any softer guard useless |
| 9 | Zero-day prompt gains a **third option: "Worked — unpaid"** | Today both existing options are lies with consequences |
| 10 | Timer hold time **auto-writes to the ledger** on save | Zero extra logging — the timer is the capture device |
| 11 | Timer saves are **additive** to `actual_hours`, with a running-total confirm | Multi-day jobs are normal; replace silently destroys Monday's data |
| 12 | **No new route.** Cards on Dashboard / Pay Period / dispute pack | Mobile bottom nav is hard-capped at 5 and full |
| 13 | Guest mode gets **3 timers, no ledger** | Timer is a showcase demo surface; every pay feature is signed-in-only by precedent |
| 14 | Dispute pack gets a **separate comeback section**, not merged rows | "You shorted me" and "I worked for free" are two different asks |
| 15 | **Phased delivery**, each phase = one migration + one rebuild, verified live | Phase 1 ships useful alone and starts collecting data immediately |

---

## Bugs this fixes (found by audit, all confirmed in source)

1. **The auto-fill trap — highest severity.** `QuickAddModal.tsx:128` and
   `useLogRoForm.ts:42,234` auto-fill the library's flag hours when an op code is picked.
   Logging a comeback the natural way silently flags *paid* hours for *free* work,
   corrupting `entries.flag_hours` (via the recompute trigger), career odometer, period
   earnings, and efficiency — in the wrong direction. No guard exists anywhere.
2. **The forced lie.** A zero-flag scheduled day lands in `UnresolvedDaysCard` offering
   only "Day off" (false — poisons schedule inference and streak logic) or "Worked, zero
   flag" (writes `confirmed_zero_days`, permanently tanking that day's efficiency with no
   record of why).
3. **Waiting time is unrecordable.** `db/entries.ts:178` throws
   `"At least one op code is required"` — an entry cannot exist without a billable line.
4. **Dangling timer RO reference.** `user_settings.timer_ro_id` has no FK and no cleanup;
   deleting an attached RO leaves orphaned accumulated ms forever.
5. **Destructive timer save.** `db/entries.ts:338` `setLineActualHours` is a REPLACE.
   Timing a job across two days silently discards the first day.
6. **Timer state race.** Every timer action is a read-modify-write on a single
   `user_settings` row with no lock; two surfaces (PiP + `/timer`) can stomp each other.
7. **Pre-existing inconsistency (Phase 2 cleanup).** `forecast.ts:75,136,209` excludes
   zero-flag days from "worked days"; `AveragesChart.tsx:91` includes them. Two
   definitions of "a day you worked" in the same app.

---

## Schema

### Phase 1 migration — `2026MMDDHHmmss_active_timers_and_unpaid_time.sql`

```sql
create table public.active_timers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  slot int not null check (slot between 1 and 3),
  entry_id uuid references public.entries on delete set null,
  line_id uuid references public.entry_op_codes on delete set null,
  status text not null default 'working'
    check (status in ('working','hold_parts','hold_approval','paused')),
  start_time bigint,                            -- epoch ms; null = not accruing
  work_accumulated bigint not null default 0,
  hold_parts_accumulated bigint not null default 0,
  hold_approval_accumulated bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slot)
);
```

**Three accumulators, one clock.** `status` at the moment of accrual decides which
accumulator elapsed time lands in. Changing status flushes elapsed into the *current*
accumulator, then resets `start_time` to now. `paused` accrues nothing.

**Why each hold reason gets its own accumulator** (changed during the build, before
anything shipped): a single lumped `hold_accumulated` can only be attributed to whichever
reason was active at save time. A job that waits on parts in the morning and on an
approval after lunch would report the entire wait under one reason — precisely the kind of
quiet wrongness this feature exists to remove, and it would make the dispute-pack line
misleading.

**The fourth status, `paused`, was not in the original three.** When you start working
slot B, slot A has to go somewhere — and auto-flipping it to a hold reason would invent a
reason the tech never gave. `paused` banks nothing and carries no clock; the tech can
re-label it as a real hold if that's what it actually was.

**Why a real table, not jsonb or 3× columns:** per-row atomicity fixes the read-modify-write
race for free (separate rows cannot collide), real FKs with `on delete set null` fix the
dangling-reference bug at the schema level, and `status` gets a CHECK constraint.
The 3-slot cap is enforced in the action layer, mirroring how `entries.ts`/`op-codes.ts`
already enforce business rules.

```sql
create table public.unpaid_time (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  hours numeric(5,2) not null check (hours >= 0),
  kind text not null check (kind in (
    'comeback_own', 'comeback_other', 'rework_same_visit',
    'wait_parts', 'wait_approval', 'shop_time'
  )),
  entry_id uuid references public.entries on delete set null,
  original_entry_id uuid references public.entries on delete set null,
  source text not null default 'manual'
    check (source in ('manual','timer','zero_day')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index unpaid_time_user_date_idx on public.unpaid_time(user_id, date);
```

Both links nullable — required, not optional design. Another tech's comeback has no
original entry in *your* data. Same-visit rework has no ticket. Waiting time has no RO.

**FK targets `entries.id`, never `ro_number`** — RO numbers are recycled at the shop
(`20260615000000_drop_ro_unique.sql`); linking by number could silently attach a comeback
to the wrong job months later.

Migration also: backfills at most one `active_timers` row per user from the old columns
(`status='working'`, all elapsed → `work_accumulated`), then drops
`user_settings.timer_ro_id` / `timer_start_time` / `timer_accumulated`.

### Phase 2 migration — comeback marking

```sql
alter table public.entry_op_codes
  add column if not exists is_comeback boolean not null default false;

alter table public.entries
  add column if not exists comeback_of_entry_id uuid
    references public.entries on delete set null;

alter table public.entry_op_codes
  add constraint entry_op_codes_comeback_zero_flag
    check (is_comeback = false or flag_hours = 0);
```

Line-level `is_comeback` handles **both** paperwork shapes from decision #1: a new RO has
all lines marked plus `comeback_of_entry_id` on the entry; an appended comeback marks only
the new lines on the existing entry. The CHECK makes the auto-fill trap structurally
impossible rather than relying on UI discipline.

**Partial goodwill pay** (shop pays 0.5h on a comeback) is *not* flag hours — it goes in
the existing `bonuses` table, which already has an optional `entry_id` link. No new
machinery.

**Do NOT reuse `laborType: "warranty"`** for comebacks. In this codebase warranty means
*paid at a lower rate*; hijacking it corrupts `warrantyLoss()` and `earningsByLaborType()`.

**The `recompute_entry_flag_hours` trigger needs no change** — it only sums `flag_hours`,
and a comeback line is 0.

---

## Phases

### Phase 1 — 3-slot timer + capture *(shippable alone)*

- Migration above (both tables; ledger created now, surfaced later)
- New `src/lib/db/timers.ts` (move timer logic out of `db/settings.ts`, per one-file-per-domain)
- `src/lib/db/unpaid-time.ts` + `listUnpaidTimeSafe` following the `listWorkSchedulesSafe`
  null-means-not-migrated pattern
- Rewrite `src/app/actions/timer.ts` — every action slot-scoped; starting a slot flips any
  other `working` slot to `paused`; save no longer nukes global state
- `TimerView.tsx` → up to 3 slot cards, each with RO binding + status chip + own `RollingNumber`
- `TimerPip.tsx` → one pip listing N rows (not N draggable pips); `frt:timer_line_id` and
  `frt:pip_*` localStorage keys become slot-aware
- `GuestTimerView.tsx` + guest reducer → 3 slots, statuses, no ledger
- Nav/BottomNav dot → "any slot running"
- Additive `actual_hours` save with running-total confirm
- Auto-stop at scheduled shift end + confirm-on-return
- `clearAllDataAction` clears all slots

**Status chip tokens (no new tokens needed):** working → `good`, hold_parts → `warn`,
hold_approval → `info` (defined at `globals.css:44-45`, currently unused), paused → `neutral`.

**Baseline cost:** `timer` + `guest-timer` × 4 projects = **8 minimum**. Verify whether the
reshaped PiP renders during other authed routes' snapshots before assuming 8 is the ceiling.

### Phase 2 — Comeback logging + honest days

- Phase 2 migration
- Comeback toggle on `LogRoForm` / `QuickAddModal`: zeroes + locks flag hours, reveals a
  "redo of…" RO picker (reuse `getEntriesByRoNumber` + `DuplicateRoDialog` disambiguation)
- Comeback kind selector: my work / another tech's / same-visit rework
- `UnresolvedDaysCard` third option → "Worked — unpaid" → hours + reason capture,
  writes `unpaid_time` with `source='zero_day'`, day counts as **worked** for schedule
  inference and streak
- Stats attribution: additive `unpaidHours` / `comebackHours` / `waitingHours` on the
  `Stats` result — **no change to `computeEfficiency`'s formula** (decision #7)
- Fix the `forecast.ts` vs `AveragesChart.tsx` worked-day inconsistency (bug #7)
- `snapshots.ts`: `avgVsBook` currently drops any line with `flagHours === 0`, so comeback
  actual-time is invisible to book-time analytics — decide inclusion explicitly

### Phase 3 — Surfaces

- Dashboard card (renders only when the period has unpaid time)
- Pay Period card, slotted between `ReconciliationCard` and `SpiffsCard`, following the
  collapsed-by-default `ChevronDown` idiom every card there uses
- `WageCheckCard` breakdown: explains what the existing `clockFlagGap` is *made of*.
  **Formula unchanged.** Preserve the module's hard constraint — numbers only, never a
  legal conclusion, no hardcoded wage figure; the only reference is user-entered
- Dispute pack: separate "Unpaid rework performed" section below the variance table, with
  its own totals. Priced via `resolveLineRate` / `hasAnyRate`, degrading to hours-only when
  unrated — never invent a rate. Print route
  (`/pay-period/dispute-pack`) must fetch the ledger too

---

## Conventions to follow

- **Migrations:** `YYYYMMDDHHmmss_snake_case.sql`, banner comment blocks, `drop policy if
  exists` before `create policy` (idempotent — migrations get re-run by the post-pull flow)
- **RLS:** `create policy "own_X" on public.X for all using (user_id = auth.uid()) with
  check (user_id = auth.uid());`
- **Safe reads:** new tables need `listXSafe` returning `null` on PGRST205/42P01 —
  `null` = not migrated, `[]` = migrated and empty. Reads only; writes assume the table exists
- **Actions:** shared `revalidateXScreens()` helper. Must include **`/dashboard`** — `/` is
  the marketing landing page, not the app dashboard
- **CSS:** never fight a `globals.css` component class with a Tailwind utility (unlayered
  rules beat layered ones silently). Add a modifier class in `globals.css` instead
- **Modal:** reuse `ui/Modal.tsx` — do not hand-roll a focus trap, or the `onClose`-identity
  focus bug returns
- **Quality gate:** ≥44px touch targets on mobile (43 fails), visible focus rings, no
  horizontal overflow, `text-overflow: ellipsis` on anything that truncates. Three stacked
  timer cards at 390px is exactly the layout this catches
- **UI gate:** `npm run test:ui` before any commit touching `.tsx`/`.css`; baselines
  committed in the same commit as the change

---

## Open risks

- **PiP blast radius.** If the multi-timer pip grows, it may shift *other* routes' baselines.
  Test before assuming 8.
- **Concurrent `actual_hours` writers.** `RoDetailModal`'s blur-to-save and the timer both
  call `setLineActualHours` with no optimistic concurrency. Latent today; 3 timers raise the
  odds. Decide whether two slots may target the same line at all.
- **`stats.test.ts`** hard-asserts exact values across ~13 branches of
  `aggregateStatsWithSchedule`. Keep Phase 2 changes additive or expect to rewrite them.
- **Snapshots are immutable by design.** Already-frozen portfolio snapshots will not gain
  comeback data retroactively — consistent with the earned-once milestone rule.

---

## Verification state (Phase 1, as built 2026-07-24)

Ran and green:

- `tsc --noEmit` — clean
- `vitest run` — **304 passed**, including 37 new cases in `src/lib/timer.test.ts`
  covering the accumulator split, clock skew, the auto-stop cap, and slot bookkeeping
- `npm run build` — production build succeeds, all routes compile
- `quality.spec.ts` on `guest-timer` × dark/light × 390/1440 — **passes**. These are
  baseline-free mechanical assertions (no horizontal overflow, no clipped text, visible
  focus rings, ≥44px touch targets), so they're real verification of the new 3-slot
  layout at phone width.

**Not verified — do these before trusting the look:**

- **Visual snapshots could not run on the Linux PC.** Every approved baseline in
  `tests/e2e/visual.spec.ts-snapshots/` is `*-win32.png`; Playwright scopes snapshot names
  by platform, so a Linux run finds no baseline, writes the current render as one, and
  "passes" against itself. That is not a regression signal. Run `npm run test:ui` on the
  **Windows PC** (where the approved baselines live) and re-record `timer` + `guest-timer`
  there, or record a full Linux baseline set once and commit it as a second platform.
- **Authed routes could not run at all** on this machine — the server-side sign-in hop
  exits through Cloudflare at `api.slimelab.cc`, which bot-blocks the Node request and
  surfaces "Incorrect email or password." Known issue; the `timer` route's baselines are
  authed, so they're untested here.
- **The migration has not been applied anywhere.** Nothing has touched a real database.
- **The PiP's effect on other routes' baselines is unmeasured** (see UI-cost note above) —
  it now renders whenever any slot exists, not only when one timer is active.

Pre-existing and untouched: `eslint` reports 12 `react-hooks/set-state-in-effect` errors
across the repo; 11 are in files this work never opened, and the one in `TimerPip.tsx` is
on the localStorage-restore effect carried over verbatim from the old component.
