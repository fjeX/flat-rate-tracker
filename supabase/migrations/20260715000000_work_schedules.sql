-- Schedule-based efficiency, phase 2 schema (references/plans/
-- schedule-based-efficiency-plan.md in Claude-EA): work schedules provide the
-- fallback efficiency denominator for days without a daily_clock_hours row.
--
-- Denominator hierarchy per day: clocked hours (daily_clock_hours) always win;
-- else the schedule's paid hours if it's a scheduled workday; else nothing.
-- Note: there is deliberately NO per-day "hours override" table — entering
-- clocked hours for a day IS the override (e.g. left at noon → clock 4h).
--
-- Written idempotent (if not exists / drop-then-create policies) because this
-- migration may be applied ahead of the code deploy and re-run by the normal
-- post-pull migrate flow.

-- =========================================================================
-- work_schedules — append-only, effective-dated schedule versions.
-- A schedule change INSERTS a new row with a later effective_from; the row
-- covering a given date is the latest one with effective_from <= date.
-- History before a change never recalculates. Forward-only: dates before the
-- user's earliest effective_from have no scheduled fallback at all.
--
-- weeks jsonb shape (validated app-side, src/lib/schedule.ts):
--   [ { "mon": {"start":"08:00","end":"17:00","breakMin":60},
--       "tue": { ... }, ..., "sat": null, "sun": null },   -- week A
--     { ... } ]                                            -- week B (rotation only)
-- One element when rotation_weeks = 1, two when 2. null day = not a workday.
-- Paid hours for a day are derived: (end - start) - breakMin.
-- Which week applies: weeks[ floor(days_between(anchor_monday, date) / 7) mod rotation_weeks ].
-- =========================================================================
create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  effective_from date not null,
  rotation_weeks int not null default 1 check (rotation_weeks in (1, 2)),
  anchor_monday date not null,  -- Monday of a "week A"; fixes rotation parity
  weeks jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, effective_from),
  check (extract(dow from anchor_monday) = 1),
  check (jsonb_typeof(weeks) = 'array'
         and jsonb_array_length(weeks) = rotation_weeks)
);
create index if not exists work_schedules_user_idx
  on public.work_schedules(user_id, effective_from desc);

alter table public.work_schedules enable row level security;
drop policy if exists "own_work_schedules" on public.work_schedules;
create policy "own_work_schedules" on public.work_schedules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- work_shift_overrides — one-day departures from the pattern ("staying two
-- hours late Thursday"). Consulted before the pattern when resolving a
-- date's shift. Unlike clocked hours (fact, past/today only) an override is
-- still a *plan* — the efficiency denominator keeps its "scheduled"
-- provenance and future days can be overridden ahead of time. Marking a day
-- fully off is days_off's job, not an override's.
-- shift jsonb shape: {"start":"08:00","end":"19:00","breakMin":60} —
-- same ShiftDef as one day of work_schedules.weeks.
-- =========================================================================
create table if not exists public.work_shift_overrides (
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  shift jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, date),
  check (jsonb_typeof(shift) = 'object')
);

alter table public.work_shift_overrides enable row level security;
drop policy if exists "own_work_shift_overrides" on public.work_shift_overrides;
create policy "own_work_shift_overrides" on public.work_shift_overrides
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- confirmed_zero_days — a scheduled workday with no ROs and no clock entry is
-- held out of efficiency until the user resolves the dashboard prompt:
-- "day off" inserts into days_off (excluded), "real zero" inserts here
-- (counts its full scheduled hours against efficiency). Unresolved days stay
-- out of the calc entirely.
-- =========================================================================
create table if not exists public.confirmed_zero_days (
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.confirmed_zero_days enable row level security;
drop policy if exists "own_confirmed_zero_days" on public.confirmed_zero_days;
create policy "own_confirmed_zero_days" on public.confirmed_zero_days
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
