-- True Time: (B) estimates become a separately labelled tier, (A) one-time
-- backfill bookkeeping.
--
-- B. Until now an ESTIMATE line (actual_source = 'estimate', the retro-prompt's
-- "about 3 hours" tap) was simply not written to labor_time_observations. In
-- production that threw away ~19 of ~23 timed lines. They are still not a
-- measurement, so they must never reach the pooled medians — but they are
-- worth keeping, labelled, so Phase 3b can decide how (or whether) to show an
-- "estimates" tier. `source` carries that label. Existing rows are all
-- measured (estimates were never written), which is exactly the column default.
--
-- A. The pool only ever holds ROs saved AFTER opt-in. `true_time_backfilled_at`
-- records that a one-time backfill of the user's existing timed lines has
-- COMPLETED, so the app does it once per account and re-does it after an import
-- wipes the observations. `true_time_backfill_started_at` is a 15-minute lease
-- that stops two tabs backfilling at once, survives a crash (it expires), and
-- backs off a failing run (see src/lib/db/true-time.ts).
--
-- Additive and idempotent. Safe to deploy the app before or after it.

alter table public.labor_time_observations
  add column if not exists source text not null default 'measured';

do $c$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'labor_time_observations_source_check'
       and conrelid = 'public.labor_time_observations'::regclass
  ) then
    alter table public.labor_time_observations
      add constraint labor_time_observations_source_check
      check (source in ('measured', 'estimate'));
  end if;
end
$c$;

comment on column public.labor_time_observations.source is
  'measured = timer or hand-entered actual hours (pools into aggregates); '
  'estimate = retro-prompt guess (stored, labelled, excluded from aggregates).';

alter table public.user_settings
  add column if not exists true_time_backfilled_at timestamptz,
  add column if not exists true_time_backfill_started_at timestamptz;

-- REQUIRED — user_settings has no table-level UPDATE for `authenticated`, only
-- a per-column list (see 20260812010000_lock_is_admin.sql). The backfill claims
-- and completes these columns as the signed-in user.
grant update (true_time_backfilled_at, true_time_backfill_started_at)
  on public.user_settings to authenticated;

comment on column public.user_settings.true_time_backfilled_at is
  'When the one-time True Time backfill of existing timed lines last COMPLETED. '
  'Written only on success. NULL = due. Reset to NULL (with the lease) when '
  'sharing is turned off or an import replaces the account.';

comment on column public.user_settings.true_time_backfill_started_at is
  'Lease for an in-flight backfill: set when a run claims it, cleared on '
  'success. A run may claim only if this is NULL or older than 15 minutes, so a '
  'crashed run is retried after expiry and a failing one is retried at most '
  'every 15 minutes.';

-- Same function as 20260729010000_true_time_collection.sql, with one addition:
-- the eligible CTE keeps only source = 'measured'. Pooled aggregates keep
-- meaning "measured"; estimates never reach a median.
create or replace function public.refresh_labor_time_aggregates()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  written integer;
begin
  -- Full recompute into a temp set, then swap. Cheap at this scale, and it means
  -- a group that FALLS BELOW the floor (a user revokes consent) correctly
  -- disappears instead of lingering from a previous run.
  create temp table _new_aggs on commit drop as
  with eligible as (
    select
      o.user_id,
      o.code_norm,
      o.make_norm,
      o.model_norm,
      o.flag_hours,
      o.actual_hours,
      -- Guard the divide even though actual_hours has a > 0 check.
      case when o.actual_hours > 0
        then o.flag_hours / o.actual_hours
        else null end as ratio
    from public.labor_time_observations o
    join public.user_settings s on s.user_id = o.user_id
    -- The consent gate. Everything downstream is opted-in data only.
    where s.share_labor_times = true
      -- Estimates are stored but never pooled.
      and o.source = 'measured'
  )
  select
    code_norm,
    make_norm,
    model_norm,
    count(distinct user_id)::int as contributor_count,
    count(*)::int as observation_count,
    percentile_cont(0.5) within group (order by actual_hours)::numeric(6,3) as median_actual_hours,
    percentile_cont(0.5) within group (order by flag_hours)::numeric(6,3) as median_flag_hours,
    percentile_cont(0.5) within group (order by ratio)::numeric(6,3) as median_ratio,
    percentile_cont(0.25) within group (order by ratio)::numeric(6,3) as p25_ratio,
    percentile_cont(0.75) within group (order by ratio)::numeric(6,3) as p75_ratio
  from eligible
  where ratio is not null
  group by code_norm, make_norm, model_norm
  -- FIRST k-anonymity enforcement point. Distinct contributors, not rows.
  having count(distinct user_id) >= 5;

  delete from public.labor_time_aggregates;
  insert into public.labor_time_aggregates (
    code_norm, make_norm, model_norm,
    contributor_count, observation_count,
    median_actual_hours, median_flag_hours,
    median_ratio, p25_ratio, p75_ratio, refreshed_at
  )
  select
    code_norm, make_norm, model_norm,
    contributor_count, observation_count,
    median_actual_hours, median_flag_hours,
    median_ratio, p25_ratio, p75_ratio, now()
  from _new_aggs;

  select count(*)::int into written from public.labor_time_aggregates;
  return written;
end;
$$;

comment on function public.refresh_labor_time_aggregates() is
  'Recompute True Time rollups from opted-in, MEASURED observations only. '
  'Enforces the k-anonymity floor of 5 distinct contributors. Safe to run on a '
  'schedule; full recompute so groups that fall below the floor disappear.';

-- Callers must not be able to run this at will (it is a full table scan).
revoke all on function public.refresh_labor_time_aggregates() from public;
revoke all on function public.refresh_labor_time_aggregates() from authenticated;
revoke all on function public.refresh_labor_time_aggregates() from anon;
