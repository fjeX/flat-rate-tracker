-- Unpaid Time Engine, Phase 2 — see docs/plans/PLAN-unpaid-time-engine.md
--
-- Marks comebacks in the RO data itself, so the app can tell "I did this work
-- for free" apart from "I didn't work". Two columns and one constraint:
--
--   1. entry_op_codes.is_comeback   — line-level, because the shop does BOTH
--      paperwork shapes (decision #1). A comeback written as a NEW ro marks
--      every line plus entries.comeback_of_entry_id; a comeback APPENDED to the
--      original ticket marks only the new lines and leaves the entry link null.
--      Line-level is the only granularity that covers both without lying.
--   2. entries.comeback_of_entry_id — the redo → original link, when there is
--      an original in this user's data. Self-referencing and nullable: a
--      comeback on ANOTHER tech's work has no original RO here at all.
--   3. The CHECK that makes the auto-fill trap structurally impossible.
--
-- Why the CHECK matters more than it looks (bug #1 from the Phase 1 audit):
-- QuickAddModal.tsx:128 and useLogRoForm.ts:42 auto-fill the library's flag
-- hours the moment an op code is picked. Logging a comeback the natural way
-- therefore flags PAID hours for FREE work — the exact inversion this whole
-- feature exists to expose, silently committed by the log form. Enforcing
-- "a comeback line flags zero" in the database means no future UI change, no
-- import path, and no bulk edit can reintroduce it. UI discipline cannot make
-- that guarantee; a constraint can.
--
-- The recompute_entry_flag_hours trigger needs NO change — it only sums
-- flag_hours, and a comeback line is 0 by construction.
--
-- Partial goodwill pay (shop hands you 0.5h on a comeback) is deliberately NOT
-- modelled here. It is not flag time; it goes in the existing `bonuses` table,
-- which already carries an optional entry_id. No new machinery.
--
-- Do NOT reuse laborType 'warranty' for comebacks. In this codebase warranty
-- means "paid at a lower rate"; hijacking it corrupts warrantyLoss() and
-- earningsByLaborType().
--
-- This migration may be applied ahead of the code deploy and re-run by the
-- normal post-pull migrate flow, so every statement is idempotent.

-- =========================================================================
-- Columns
-- =========================================================================
alter table public.entry_op_codes
  add column if not exists is_comeback boolean not null default false;

-- Self-referencing, nullable. ON DELETE SET NULL: deleting the original job
-- keeps the comeback record — the redo still happened and the tech still ate
-- the hours; only the pointer back is lost.
alter table public.entries
  add column if not exists comeback_of_entry_id uuid
    references public.entries on delete set null;

-- WHOSE comeback this is. Not derivable from comeback_of_entry_id being null —
-- that covers three different situations that must not be conflated:
--   - it's your own work but the original predates the app / wasn't logged
--   - it's ANOTHER tech's work (Liem's shop tracks these separately, and they
--     have no original RO in this user's data by definition)
--   - same-visit rework, caught before the car left, so there is no second
--     ticket at all
--
-- Deliberately the SAME vocabulary as unpaid_time.kind, so RO-side comebacks
-- and ledger-side comebacks aggregate without a translation table. null = this
-- entry has no comeback lines.
alter table public.entries
  add column if not exists comeback_kind text;

do $comeback_kind_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'entries_comeback_kind_valid'
      and conrelid = 'public.entries'::regclass
  ) then
    alter table public.entries
      add constraint entries_comeback_kind_valid
        check (comeback_kind is null or comeback_kind in (
          'comeback_own', 'comeback_other', 'rework_same_visit'
        ));
  end if;
end
$comeback_kind_check$;

-- =========================================================================
-- The constraint that kills the auto-fill trap
-- =========================================================================
-- Postgres has no "add constraint if not exists", so guard on pg_constraint.
-- Existing rows all pass trivially (is_comeback defaults to false), so this
-- validates instantly on the current data.
do $comeback_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'entry_op_codes_comeback_zero_flag'
      and conrelid = 'public.entry_op_codes'::regclass
  ) then
    alter table public.entry_op_codes
      add constraint entry_op_codes_comeback_zero_flag
        check (is_comeback = false or flag_hours = 0);
  end if;
end
$comeback_check$;

-- =========================================================================
-- Indexes
-- =========================================================================
-- Partial: comeback lines are the rare case, and every query that wants them
-- wants only them ("how many unpaid hours did I eat this period").
create index if not exists entry_op_codes_comeback_idx
  on public.entry_op_codes(entry_id)
  where is_comeback;

-- Walks the redo → original link, and answers "has this job come back?"
create index if not exists entries_comeback_of_idx
  on public.entries(comeback_of_entry_id)
  where comeback_of_entry_id is not null;
