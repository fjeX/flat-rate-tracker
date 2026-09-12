# PLAN — Open Tickets: multi-day ROs that tell the truth about the days between

**Status:** design locked 2026-09-12 (grilling, 13 decisions). Nothing built.
**Depends on:** PLAN-unpaid-time-engine (Phase 1 shipped: `active_timers`,
`unpaid_time` ledger, additive timer saves). Extends it; changes nothing it locked.

---

## The problem

An RO in FRT is one row with one `date` and one `flag_hours`. Every stat in the
app (day, week, pay period, efficiency, streaks, schedule inference, the zero-day
prompt) hangs off that single date. That models a job as an *event*. A warranty
engine job is a *process*:

> Day 1: open the ticket, 8h of teardown looking for the cause of failure.
> Day 2–3: waiting on warranty approval.
> Day 4–9: waiting on parts.
> Day 10: engine in, op code and labor time finally known, RO logged.

FRT records that as nine days of nothing and one day of 14 flagged hours. The
days in between read as days off (or trigger the unresolved-day prompt asking if
you showed up), and the close day reads as a superhuman shift. The pay-period
total is right. Everything about *when the work happened* is wrong.

The concrete blocker: an RO cannot be created without at least one op code
(`src/lib/db/entries.ts:264`, `createEntry`). On teardown day the op code does
not exist yet, so the ticket cannot exist, so the timer has nothing to attach
to, so nothing downstream can help.

---

## Locked decisions (grilling, 2026-09-12)

| # | Decision | Why |
|---|---|---|
| 1 | An open ticket is a normal `entries` row with a new `status` (`open`/`closed`). Existing rows backfill to `closed`. | One identity from teardown day to close. Timer, photos, notes, timeline all hang off the same `entry_id`; nothing is copied at close, so nothing is lost at close. |
| 2 | **RO number is the only required field** to open. Vehicle etc. are progressive. | Schema already allows it (vehicle columns default `''`). The form must not block on things you learn later. |
| 3 | Daily hours come from **the timer and manual entry**, both source-tagged. | The timer is the intended path; the manual path is the safety net for the day the phone stayed in the drawer. Same pattern as `actual_source` on lines: a typed 8h is never confused with a measured 8h. |
| 4 | **Hours live in `unpaid_time`** as a new kind `open_work`. **Story lives in a new `ro_events` table.** Hours never ride on events. | The stats layer already sums the ledger by date and it is already backed up and imported. If hours rode on events, editing a note would change a day total. |
| 5 | **Fixed event vocabulary + `custom`.** The latest event *is* the ticket's status; no separate status-text column. Timer hold flips auto-write events (Phase 2). | Readable at a glance, chip-able on the card without parsing English. Library first, custom when the library doesn't fit — same as op codes. |
| 6 | **On close, ledger rows stay.** The close form prefills `actual_hours` on the new line(s) with the sum of `open_work` hours; hold time is excluded; the tech confirms or edits. | The per-day rows are the feature. `actual_hours` still matters (insights, True Time) so the form does the addition. Waiting isn't wrenching. |
| 7 | **A day with any open-ticket hours is a worked day.** No unresolved-day prompt, streak continues, schedule inference sees a shift. **Headline efficiency is unchanged**: 0 flagged reads 0 flagged, with "8.0h on 1 open ticket" beside it. | The blank day is the lie being killed. The raw number never moves; attribution sits next to it (unpaid-time plan decision 7). A "pending" efficiency would let the pay-period total drift from the check. |
| 8 | **No new route.** Three touchpoints: Log form "open ticket" mode; dashboard Open Tickets card; Timeline section inside `RoDetailModal`. | Bottom nav is capped at 5 and full. The modal is already where you look at one RO. |
| 9 | **`entries.date` is the flag day.** While open it holds the opened day as a placeholder; on close it becomes the close day (defaults to today, editable). The opened day is preserved as the auto-written `opened` timeline event. | Flag hours pay on the close day and the pay-period total must match the check. A second date column would have to be taught to backup, import, and every stats function; the timeline already records it. |
| 10 | **`open_work` hours are never "unpaid."** Own bucket ("hours on open tickets"), excluded from every unpaid total before *and* after close. Hold time on the same ticket still counts as unpaid. | Teardown hours on a warranty job aren't free, they're paid late. Mixing them in would make the dispute pack say different things on different days. |
| 11 | **Reopen is allowed.** Writes a `reopened` event, ticket returns to the card. Flag hours stay put; a second close moves `date` **only if the tech says so**. | Second approved line, closed-by-mistake. Editing lines on a closed RO already works and is untouched. A reopen must never silently move paid hours off the day they were paid. |
| 12 | **Signed-in only.** Guests never see open mode or the card. | Every pay feature is signed-in-only by precedent; a guest timeline with no hours is a demo of a notepad. |
| 13 | **Two phases**, each one migration + one rebuild, verified live before the next. | Phase 1 fully solves the stated problem without the timer. Phase 2 touches `saveTimerAction`, the most race-prone path in the app, and deserves its own verification pass. |

---

## Schema

### Phase 1 migration — `2026MMDDHHmmss_open_tickets.sql`

Idempotent throughout (may be applied ahead of the code deploy and re-run by
the post-pull migrate flow, like every migration since 20260724).

```sql
-- 1. entries.status
alter table public.entries
  add column if not exists status text not null default 'closed';
-- CHECK via the same pg_constraint guard pattern as entries_logged_time_hhmm
--   check (status in ('open', 'closed'))
-- Default 'closed' IS the backfill: every existing row is a finished RO.
-- The app sets 'open' explicitly; the DB never guesses.
create index if not exists entries_user_open_idx
  on public.entries(user_id) where status = 'open';
-- Partial index: the card queries "my open tickets" on every dashboard load;
-- open rows are a handful, closed rows are thousands.

-- 2. ro_events — the timeline
create table if not exists public.ro_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  entry_id uuid not null references public.entries on delete cascade,
  date date not null,          -- string-compared like entries.date; see 20260816
  time text,                   -- HH:MM wall clock, nullable, same CHECK as logged_time
  kind text not null,          -- CHECK below
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- kind in ('opened','diag_done','teardown_approved','teardown_done',
--          'cause_found','parts_ordered','approval_received','repair_done',
--          'hold_parts','hold_approval','reopened','closed','custom')
-- Not an enum type: adding a value to a CHECK is a one-line ALTER
-- (same reasoning as actual_source).
create index if not exists ro_events_entry_idx
  on public.ro_events(entry_id, date, time);
-- RLS: own_ro_events, user_id = auth.uid(), same shape as unpaid_time.
-- user_id is denormalised onto the row (not derived via entry_id) so the
-- policy is a column compare, not a subquery per row — entry_op_codes pays
-- that subquery and it is the one RLS policy in the schema that does.

-- 3. unpaid_time.kind gains 'open_work'
-- Drop + re-add the CHECK (guarded), adding 'open_work' to the list.
-- source CHECK is unchanged: 'manual' | 'timer' | 'zero_day' already covers
-- both capture paths (decision 3).
```

**Cascade note.** `ro_events.entry_id` is `on delete cascade`, unlike
`unpaid_time.entry_id` which is `set null`. A timeline without its ticket is
meaningless; a ledger row without its ticket is still hours you worked. Deleting
an open ticket therefore keeps its `open_work` rows (dated, orphaned, still
counted as worked days). That is correct: the hours happened.

### Phase 2 migration — none expected

Timer integration and reopen are code-only against the Phase 1 schema. If a
column turns out to be needed (e.g. `active_timers.writes_to_ledger`), it gets
its own migration; do not retrofit Phase 1's.

---

## Behaviour, surface by surface

### Log form — "Open ticket" mode (Phase 1)

- A toggle on `/log`: **"Open ticket — no op codes yet."** Signed-in only.
- When on: op-code section hidden, flag hours hidden, vehicle optional, RO
  number required. Save calls a new `createOpenEntry` (not `createEntry` with an
  empty array — keep the "at least one op code" throw in place for closed ROs;
  it is a real guard, not a bug).
- `createOpenEntry` writes: the entry with `status='open'`, `date=today` (tz-aware,
  same helper as `saveTimerAction`), and one `ro_events` row `kind='opened'`
  with today's date. The `opened` event is written by the server action, never
  by the client, so it cannot be forgotten.
- Duplicate RO numbers: `entries_user_ro_unique` was dropped in 20260615 because
  the shop recycles numbers. Opening a ticket whose number matches an existing
  **open** ticket should warn ("RO 12345 is already open") and offer to jump to
  it. Matching a *closed* one is normal and silent.

### Dashboard — Open Tickets card (Phase 1)

- Renders only when the user has ≥1 open ticket. Zero open = card absent, not
  an empty state. (A quiet dashboard should look quiet.)
- One row per ticket: RO number, vehicle (or "vehicle not set"), **latest event
  label** as the status chip, days open (from the `opened` event, not
  `created_at`), hours on it so far. Tap → `RoDetailModal`.
- Sorted oldest-opened first. The car that has sat longest is the one to chase.

### RO detail modal — Timeline section (Phase 1)

- New section between the lines block and `EntryPhotos`. Shown for **every** RO
  that has ≥1 event; open tickets always have one.
- Chronological list: date, optional time, kind label, note. `custom` shows its
  note as the label.
- **Add event**: kind picker (fixed list + custom), date (default today), time
  (optional, default from `track_ro_time` setting like `logged_time`), note.
- **Add hours for a day**: date (default today), hours, optional note → one
  `unpaid_time` row `kind='open_work'`, `source='manual'`, `entry_id` set.
  Listed under the timeline as "Hours: Mon 8.0 · Tue 2.5 · …" with a per-row
  delete (ledger rows are already deletable by PK behind a named confirm —
  2026-09-07 decision; reuse that).
- **Close ticket** button (open tickets only) → opens the close flow below.
- Closed RO with a timeline: shows the timeline read-only plus a **Reopen**
  button (Phase 2).

### Close flow (Phase 1)

A modal step, not a page:

1. Op codes + flag hours — the existing line editor, same validation as a normal
   RO (≥1 line required here; this is where the guard belongs).
2. Close date — default today (tz-aware), editable. Becomes `entries.date`.
3. `actual_hours` prefill — the sum of this ticket's `open_work` rows, shown as
   "Timeline says 14.5h worked. Put it on:" with a line picker when there is
   more than one line (defaults to the largest flag-hours line). The tech can
   edit the number. Hold rows (`wait_parts`/`wait_approval`) are **not** in the
   sum and the UI says so in one line.
   Written with `actual_source='estimate'` when the underlying rows are manual,
   `'timer'` only when every contributing row is `source='timer'`. Mixed → estimate.
   (True Time must not receive a typed number dressed as a measurement.)
4. Save: one server action, one transaction-shaped sequence — lines inserted
   (the recompute trigger sets `entries.flag_hours`), `date` updated,
   `status='closed'`, `ro_events` row `kind='closed'`. If any step fails after
   the first, the ticket must not be left half-closed: do the status flip
   **last**, so a failure leaves an open ticket with lines on it, which the
   modal can show and retry, rather than a closed ticket with no lines.

### Stats (Phase 1) — the part that actually fixes the calendar

- **Worked-day definition** (`src/lib/forecast.ts:45`, `flagHoursByDate`, and
  every consumer that documents itself as sharing it): a date is worked iff
  **an RO row is dated that day OR an `open_work` ledger row is dated that
  day.** Both conditions are needed:
  - while open, the opened day has a row (with 0 flag), intermediate days have
    only ledger rows;
  - after close, the opened day *loses* its row (date moved), and only the
    ledger row keeps it worked.
  `flagHoursByDate` must therefore take `unpaid` as an argument (it already
  flows into `aggregateStats`) and seed `byDate` with 0 for every `open_work`
  date in range.
- **Flag sums**: an open row's `flag_hours` is 0 by construction (no lines), so
  no filter is needed to keep it out of sums. Do not add one "for safety" — a
  filter on `status` in the flag path would silently drop a closed RO the day
  a future bug leaves status stale.
- **`aggregateStats`** (`src/lib/stats.ts:93`): the `switch (u.kind)` gains
  `case "open_work": openTicketHours += u.hours;` and a new `openTicketHours`
  output. It is **not** added to `unpaidHours` (decision 10). Exhaustive switch:
  add the case or TypeScript will flag it — good.
- **Unresolved-day prompt** (`UnresolvedDaysCard`): a date with `open_work`
  hours is resolved. It must not appear.
- **Day / period cards**: wherever a day's flag hours render, an `openTicketHours
  > 0` adds one line: "8.0h on 1 open ticket". Count = distinct `entry_id` among
  that day's `open_work` rows.
- Efficiency, wage check, dispute pack, career odometer, bonuses: **untouched.**
  If a diff touches `computeEfficiency` or the dispute pack for this feature,
  the diff is wrong.

### Timer (Phase 2)

- `attachRoToTimerAction`: an open ticket is attachable. The line picker
  (`setTimerLineAction`) is skipped/hidden when the entry has no lines.
- `saveTimerAction` (`src/app/actions/timer.ts:321`): today it throws
  "That op code line isn't on this RO." when `lineId` is not on the entry. New
  branch: **if the entry is `open` and has no lines, `workHours` writes an
  `unpaid_time` row `kind='open_work'`, `source='timer'`, dated `ledgerDate`
  (the existing earned-on-not-saved-on logic), instead of calling
  `addLineActualHours`.** Hold rows are written exactly as today. The save
  modal's running-total confirm shows the ticket's `open_work` total instead of
  a line total.
- Status flips to `hold_parts` / `hold_approval` on a slot attached to an open
  ticket write a `ro_events` row of the same kind, once per flip (not per
  accrual tick). Flipping back to `working` writes nothing; the next "real"
  event tells the story.
- Auto-stop at shift end (unpaid-time decision 6) already lands time on
  `startedOn`; no change, but the confirm-on-return copy must handle "saved
  4.2h to open ticket RO 12345".

### Reopen (Phase 2)

- Closed RO with `status='closed'` → **Reopen** in the modal → `status='open'`,
  `ro_events` `kind='reopened'`. Lines and `flag_hours` untouched. Back on the card.
- Second close: same close flow, but step 2 asks explicitly: "Keep flag date
  2026-09-04, or move to today?" Default: **keep**. Never move silently
  (decision 11).

---

## Backup / import / schema audit (Phase 1, before the migration commits)

- `backup-manifest.ts`: add `ro_events` (carried, bundleKey `roEvents`,
  `entry_id` remapped like `unpaid_time.entry_id`), add `status` to `entries`
  columns as `carry`. `unpaid_time.kind` needs no manifest change (it's `carry`),
  but `import-remap.ts` validates kinds — add `open_work` to its accepted set or
  imports of a post-Phase-1 bundle will reject every open-ticket row.
- `src/lib/types.ts`: `UnpaidTimeKind` gains `"open_work"`, `UNPAID_TIME_KINDS`
  and `UNPAID_TIME_KIND_LABELS` ("On open ticket") likewise. `isUnpaidTimeKind`
  follows automatically.
- Run **frt-schema-auditor** after the migration is written and before commit.
  Run **frt-postgres-guard** on the migration (the CHECK drop/re-add on
  `unpaid_time.kind` is exactly the class of thing it exists for).
- `database.types.ts` regenerated.

---

## Risks and things that will bite

1. **Callers that assume `entry.opCodes[0]` exists.** `createEntry` guaranteed
   ≥1 line for every row since day one. Grep for `opCodes[0]`, `.lines[0]`,
   `opCodes.length` used as a truthy guard, and any `reduce` that divides by
   line count. The RO list row, the modal header, the OCR/NL entry paths, the
   dispute pack, and `RoList` "primary op code" labels are the likely ones.
   Every one needs an open-row rendering, not a crash.
2. **The recompute trigger** (`recompute_entry_flag_hours`) fires on line
   changes; an open row with no lines never fires it, and `flag_hours` stays at
   its default 0. Correct, but nothing *asserts* it — add a test that an open
   entry reports 0 flag through `aggregateStats`.
3. **`date` moves at close.** Anything that cached or linked by `(user, date)`
   for this RO (photos are by `entry_id` — fine; `logged_time` is a wall clock
   read relative to `date` — fine, but a `logged_time` captured on the opened
   day now describes a time on the close day; the close flow should clear
   `logged_time` and let the setting re-default it).
4. **Duplicate-RO warning** must compare against open tickets only; comparing
   against all rows would fire on every recycled number.
5. **The nightly bot** will see a new toggle on `/log`, a new card, and a new
   modal section. Its checklist must be taught the behaviour the day it ships
   (see the 2026-09-07 "teach the bot" commits) or the next morning's escalation
   queue is a list of non-bugs.
6. **Guest mode** must not render the toggle, the card, or the section. There
   is no guest ledger; an open ticket with no place to put hours is a trap.

---

## Phases

### Phase 1 — manual path (solves the stated problem)
- Migration above. Types, manifest, import-remap, schema audit, postgres guard.
- `createOpenEntry` + `closeEntry` server actions and db functions.
- Log form open mode. Dashboard card. Modal Timeline section with add-event,
  add-hours, close flow.
- Worked-day rule + `openTicketHours` in stats + unresolved-day exclusion +
  day-card line.
- Tests: `aggregateStats` with open rows and `open_work` rows; `flagHoursByDate`
  seeding; close flow leaves no half-closed ticket on failure; `opCodes[0]`
  guards.
- Teach the bot. Rebuild. Verify live: open a ticket, add 8h to yesterday,
  confirm yesterday shows worked with 0 flagged and no prompt, close it, confirm
  the flag lands on close day and yesterday is still worked.

### Phase 2 — timer path + reopen
- `saveTimerAction` open-ticket branch (+ retry tests in `timers.retry.test.ts`
  pattern). Hold flips write events. Line picker hidden for lineless entries.
- Reopen + keep-or-move close date.
- Teach the bot. Rebuild. Verify live with a real timer run across a slot flip.

---

## Out of scope (named so it stays out)

- Per-day *allocation* of flag hours across worked days. Flag pays on the close
  day; the paycheck is the source of truth. Attribution is beside it, never in it.
- A "pending efficiency" number. Rejected in grilling (Q7).
- A dedicated `/open` route. Rejected (Q8), nav is full.
- Guest support. Rejected (Q12).
- Warranty-specific fields (claim number, cause-of-failure text). The `custom`
  event + note covers it for now; promote to columns only if a pattern emerges.
