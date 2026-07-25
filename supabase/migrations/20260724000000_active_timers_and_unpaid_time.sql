-- Unpaid Time Engine, Phase 1 — see docs/plans/PLAN-unpaid-time-engine.md
--
-- Two things land here:
--
--   1. active_timers — replaces the three timer_* columns on user_settings with
--      a real child table, so a tech can run up to 3 jobs at once (waiting on
--      parts is normal; one global timer never matched the bay).
--   2. unpaid_time — the ledger. Created now so the timer can start writing
--      waiting time immediately, even though nothing surfaces it until Phase 3.
--
-- Why a child table instead of 3× columns or jsonb:
--   - per-row atomicity. Every timer action is a read-modify-write; on one
--     shared row two slots can stomp each other (and the PiP can stomp the
--     /timer page). Separate rows simply cannot collide.
--   - real FKs. `user_settings.timer_ro_id` had none, so deleting an RO left an
--     orphaned id and accumulated ms behind forever.
--   - the 3-slot cap is free: check(slot between 1 and 3) + unique(user_id,slot)
--     makes a 4th row impossible at the database level, not by app discipline.
--
-- This migration may be applied ahead of the code deploy and re-run by the
-- normal post-pull migrate flow, so every statement is idempotent.

-- =========================================================================
-- active_timers — up to 3 concurrent job timers per user
-- =========================================================================
create table if not exists public.active_timers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  slot int not null check (slot between 1 and 3),
  entry_id uuid references public.entries on delete set null,
  line_id uuid references public.entry_op_codes on delete set null,
  -- 'working'      — wrenching on it; accrues to work_accumulated
  -- 'hold_parts'   — waiting on parts; accrues to hold_accumulated
  -- 'hold_approval'— waiting on an approval; accrues to hold_accumulated
  -- 'paused'       — set down; accrues nothing. Also where a slot lands when
  --                  another slot starts working (only one 'working' at a
  --                  time, enforced in the action layer — auto-flipping to a
  --                  hold reason would invent a reason the tech never gave).
  status text not null default 'working' check (
    status in ('working', 'hold_parts', 'hold_approval', 'paused')
  ),
  start_time bigint,                          -- epoch ms; null = not accruing
  -- One accumulator per reason, not one lumped "hold" total. A job can sit
  -- waiting on parts in the morning and waiting on an approval after lunch;
  -- with a single bucket the whole wait gets attributed to whichever reason
  -- happened to be active when it was saved, which is exactly the quiet
  -- wrongness this feature exists to remove.
  work_accumulated bigint not null default 0,
  hold_parts_accumulated bigint not null default 0,
  hold_approval_accumulated bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slot)
);

create index if not exists active_timers_user_idx
  on public.active_timers(user_id);

alter table public.active_timers enable row level security;
drop policy if exists "own_active_timers" on public.active_timers;
create policy "own_active_timers" on public.active_timers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- unpaid_time — hours worked or waited that flag nothing
-- =========================================================================
-- Both entry links are nullable, and that is load-bearing, not laziness:
--   - a comeback on ANOTHER tech's work has no original RO in this user's data
--   - same-visit rework has no ticket at all
--   - waiting on parts has no RO to hang off when nothing got logged that day
--
-- FKs target entries.id, never ro_number: the shop recycles 5-digit RO numbers
-- (see 20260615000000_drop_ro_unique.sql), so linking by number could silently
-- attach a comeback to an unrelated job months later.
create table if not exists public.unpaid_time (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  hours numeric(5,2) not null check (hours >= 0),
  kind text not null check (kind in (
    'comeback_own',       -- redoing your own prior job, unpaid
    'comeback_other',     -- cleaning up another tech's work
    'rework_same_visit',  -- caught it before the car left; no ticket
    'wait_parts',
    'wait_approval',
    'shop_time'           -- meetings, cleanup, dispatch limbo
  )),
  -- The RO this time was spent ON (the return-visit ticket, if one exists).
  entry_id uuid references public.entries on delete set null,
  -- For comeback_own: the original job being redone. Deleting the original
  -- keeps the record — the redo still happened; only the link is lost.
  original_entry_id uuid references public.entries on delete set null,
  source text not null default 'manual' check (
    source in ('manual', 'timer', 'zero_day')
  ),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists unpaid_time_user_date_idx
  on public.unpaid_time(user_id, date);

alter table public.unpaid_time enable row level security;
drop policy if exists "own_unpaid_time" on public.unpaid_time;
create policy "own_unpaid_time" on public.unpaid_time
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- Backfill from the old single-timer columns, then drop them
-- =========================================================================
-- Guarded on the columns still existing so a re-run after the drop is a no-op
-- rather than an error. Only users with a non-default timer get a row; the
-- pre-existing model had exactly one timer, so it becomes slot 1.
--
-- entry_id is resolved through a subquery instead of copied directly: a stale
-- timer_ro_id can point at a since-deleted entry, which would fail the new FK.
-- Unresolvable ids land as null, which is the honest answer anyway.
do $migrate$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_settings'
      and column_name = 'timer_ro_id'
  ) then
    insert into public.active_timers (
      user_id, slot, entry_id, status, start_time, work_accumulated
    )
    select
      us.user_id,
      1,
      (select e.id from public.entries e where e.id = us.timer_ro_id),
      case when us.timer_start_time is not null then 'working' else 'paused' end,
      us.timer_start_time,
      us.timer_accumulated
    from public.user_settings us
    where us.timer_ro_id is not null
       or us.timer_start_time is not null
       or us.timer_accumulated > 0
    on conflict (user_id, slot) do nothing;

    alter table public.user_settings drop column if exists timer_ro_id;
    alter table public.user_settings drop column if exists timer_start_time;
    alter table public.user_settings drop column if exists timer_accumulated;
  end if;
end
$migrate$;
