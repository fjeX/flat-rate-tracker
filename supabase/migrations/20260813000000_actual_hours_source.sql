-- How a line's actual_hours got there — see docs/plans/PLAN-insights-v2.md
--
-- Retro capture (a one-tap coarse estimate offered after saving an RO that
-- carries a 2h+ line) writes into the same actual_hours column the timer writes
-- into. Without this column those two become indistinguishable the moment they
-- land, and they must not be:
--
--   1. labor_time_observations feeds a SHARED pool. Its whole value is that the
--      medians are measurements. One tech's "call it about 3 hours" is a fine
--      input to their own insights and a corrupting input to everybody else's
--      peer median — and once mixed in, it can never be separated back out.
--   2. On the tech's own page, "you ran this at 0.82x" earns a different amount
--      of trust depending on whether a clock said so or a memory did. The page
--      can only mark an estimate as an estimate if the row remembers.
--
-- Deliberately nullable with NO default, and null is not a third grade of
-- evidence — it means "recorded before this column existed". Every pre-existing
-- row was written by the timer or typed into the log form directly, so null is
-- treated as measured-enough-to-share, preserving the status quo rather than
-- silently retracting observations a consenting tech already contributed.
--
-- Not an enum type: adding a value to a Postgres enum is a migration with a
-- transaction caveat, while adding one to a CHECK is a one-line ALTER. This
-- vocabulary will grow (an OCR'd punch clock, an imported shop-system time) and
-- the cheaper change wins.
--
-- This migration may be applied ahead of the code deploy and re-run by the
-- normal post-pull migrate flow, so every statement is idempotent.

alter table public.entry_op_codes
  add column if not exists actual_source text;

do $actual_source_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'entry_op_codes_actual_source_valid'
      and conrelid = 'public.entry_op_codes'::regclass
  ) then
    alter table public.entry_op_codes
      add constraint entry_op_codes_actual_source_valid
        check (
          actual_source is null
          or actual_source in ('timer', 'estimate')
        );
  end if;
end
$actual_source_check$;

-- A source without an actual is meaningless, and it is the shape a partially
-- applied UI bug would produce (clearing the hours but leaving the marker), so
-- the database refuses it rather than letting the page render "estimated —"
-- forever.
do $actual_source_needs_hours$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'entry_op_codes_actual_source_needs_hours'
      and conrelid = 'public.entry_op_codes'::regclass
  ) then
    alter table public.entry_op_codes
      add constraint entry_op_codes_actual_source_needs_hours
        check (actual_source is null or actual_hours is not null);
  end if;
end
$actual_source_needs_hours$;
