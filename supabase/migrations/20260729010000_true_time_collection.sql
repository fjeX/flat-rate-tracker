-- True Time, Phase 3a: COLLECTION ONLY. No read surface ships with this.
--
-- The goal: pool what jobs ACTUALLY take, measured by the techs doing them, so
-- FRT can eventually answer "does this op code really pay 1.5h on this vehicle?"
-- ALLDATA and Mitchell sell BOOK time to shops; nobody publishes real time
-- measured from the bay. FRT already captures actual_hours per line, so the data
-- exists — it has just been dying inside one account.
--
-- Phase 3a starts accumulating it. The read surface (Phase 3b) is deliberately
-- held back: with a handful of users, a panel claiming "340 techs average 1.8h"
-- would really be averaging one person, which is worse than showing nothing.
-- The dataset only becomes worth reading with time, so the clock starts now.
--
-- ============================ PRIVACY MODEL ============================
-- Liem delegated this design with two standing constraints: assume the project
-- goes public, and treat scalability + security as first-class. So:
--
-- 1. NO CROSS-USER RAW READS, EVER. labor_time_observations keeps the existing
--    strict per-user RLS. Nothing one user writes is readable by another. There
--    is no policy on it that permits reading someone else's row.
--
-- 2. AGGREGATION IS SERVER-SIDE UNDER A DEFINER FUNCTION. Rollups are computed
--    by refresh_labor_time_aggregates(), which is SECURITY DEFINER and owned by
--    the schema owner, so it can read across users while callers cannot. It
--    writes ONLY rollups into labor_time_aggregates.
--
-- 3. THE ROLLUP TABLE CARRIES NO IDENTITY. No user_id, no RO number, no exact
--    dates — only a normalized job key, counts, and central tendency. Even a
--    full dump of it cannot be traced to a person.
--
-- 4. K-ANONYMITY FLOOR OF 5, ENFORCED TWICE. The refresh function refuses to
--    emit a row backed by fewer than 5 distinct contributors, AND the read
--    policy re-checks contributor_count >= 5. A bug in one layer cannot leak a
--    single-contributor row on its own.
--
-- 5. SHARING IS OFF BY DEFAULT. share_labor_times defaults to false. Only
--    opted-in users are ever aggregated, and revoking consent removes the user
--    from every subsequent refresh (their observations stop counting).
--
-- 6. INCREMENTAL AND SCHEDULED, NOT PER-REQUEST. Reads (Phase 3b) will hit one
--    indexed rollup row regardless of how many users exist.

-- =========================================================================
-- Consent — opt-in, default OFF
-- =========================================================================
alter table public.user_settings
  add column if not exists share_labor_times boolean not null default false;

comment on column public.user_settings.share_labor_times is
  'Opt-in to contributing anonymized flag-vs-actual observations to True Time. '
  'Default false. Revoking stops future aggregation of this user''s rows.';

-- =========================================================================
-- labor_time_observations — one frozen measurement per RO line
-- =========================================================================
-- A snapshot, not a view over entry_op_codes, for the same reason a dispute is
-- frozen: the source rows move. An RO gets edited, an op code renamed, a line
-- deleted. An observation records what was measured at the time it was measured.
--
-- It also decouples pooling from each user's private op-code library, which is
-- arbitrary per tech ("BRK-F" for one, "BF" for another), by storing normalized
-- keys computed at write time.
create table if not exists public.labor_time_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,

  -- Both CASCADE, unlike dispute_lines which deliberately SET NULL.
  --
  -- The difference is what the record means standalone. A dispute must survive
  -- its RO being deleted, because "you asked for these hours" is a fact about a
  -- negotiation. An observation is only meaningful AS a measurement of a job
  -- that exists — if the tech deletes the RO or the line, they are retracting
  -- the measurement, and a retracted number has no business in a shared pool.
  --
  -- CASCADE also eliminates an entire bug class: with SET NULL, deleting a line
  -- leaves an observation whose line_id is NULL, which no `line_id not in (...)`
  -- cleanup can ever match (NULL comparisons yield NULL), so it would sit in the
  -- pool permanently unreachable.
  entry_id uuid references public.entries on delete cascade,
  -- Dedupe key: one observation per line, so correcting actual hours replaces
  -- the measurement instead of double-counting the same job.
  line_id uuid references public.entry_op_codes on delete cascade,

  -- Normalized aggregate key, computed in src/lib/true-time.ts at write time.
  -- Uppercased, punctuation-stripped so "BRK-F" and "brk f" pool together.
  code_norm text not null,
  make_norm text not null default '',
  model_norm text not null default '',
  -- Nullable: plenty of logged ROs have no year. A null-year observation still
  -- pools at the make/model level.
  vehicle_year int,

  -- The measurement itself. Book time vs. what it really took.
  flag_hours numeric(5,2) not null check (flag_hours >= 0),
  actual_hours numeric(5,2) not null check (actual_hours > 0),

  -- Coarsened to the first of the month ON PURPOSE. Exact work dates are
  -- re-identifying when combined with a shop and a vehicle; month is enough to
  -- age out stale observations later.
  observed_month date not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One observation per line. Correcting actual hours updates in place instead of
-- appending a second measurement of the same job.
create unique index if not exists labor_time_obs_line_idx
  on public.labor_time_observations(line_id)
  where line_id is not null;
-- The aggregation scan key.
create index if not exists labor_time_obs_key_idx
  on public.labor_time_observations(code_norm, make_norm, model_norm);
-- Incremental refresh watermark + per-user purge on consent revocation.
create index if not exists labor_time_obs_user_updated_idx
  on public.labor_time_observations(user_id, updated_at);

alter table public.labor_time_observations enable row level security;
-- Strict per-user. Deliberately NO cross-user select policy: pooling happens
-- only through the definer function below.
drop policy if exists "own_labor_time_observations" on public.labor_time_observations;
create policy "own_labor_time_observations" on public.labor_time_observations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- labor_time_aggregates — the only readable surface. No identity in here.
-- =========================================================================
create table if not exists public.labor_time_aggregates (
  code_norm text not null,
  make_norm text not null default '',
  model_norm text not null default '',

  -- Distinct opted-in USERS behind this row (not observation count). This is
  -- the k in k-anonymity: 5 observations from one tech is still one person.
  contributor_count int not null check (contributor_count >= 0),
  observation_count int not null check (observation_count >= 0),

  -- Median is the headline, not the mean: one 40-hour engine job that fought
  -- back would drag a mean badly, and the question a tech is asking is "what
  -- does this usually take?"
  median_actual_hours numeric(6,3) not null,
  median_flag_hours numeric(6,3) not null,
  -- Median of the per-observation ratio, NOT median_actual / median_flag. The
  -- ratio of medians is not the median of ratios, and the per-job ratio is the
  -- figure that means "runs 1.4x book".
  median_ratio numeric(6,3) not null,
  p25_ratio numeric(6,3) not null,
  p75_ratio numeric(6,3) not null,

  refreshed_at timestamptz not null default now(),
  primary key (code_norm, make_norm, model_norm)
);

alter table public.labor_time_aggregates enable row level security;

-- Read policy is the SECOND k-anonymity enforcement point. The refresh function
-- already refuses to write a row below the floor; this guarantees that even if a
-- future refresh bug emitted one, it stays unreadable.
drop policy if exists "read_pooled_labor_times" on public.labor_time_aggregates;
create policy "read_pooled_labor_times" on public.labor_time_aggregates
  for select
  to authenticated
  using (contributor_count >= 5);

-- No insert/update/delete policy for any caller. Only the definer function
-- writes here, and it bypasses RLS by virtue of being SECURITY DEFINER.

-- =========================================================================
-- refresh_labor_time_aggregates() — the only path from raw rows to rollups
-- =========================================================================
-- SECURITY DEFINER so it can read across users; callers cannot. search_path is
-- pinned to defeat search-path hijacking, which is the standard footgun for
-- definer functions.
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
  'Recompute True Time rollups from opted-in observations only. Enforces the '
  'k-anonymity floor of 5 distinct contributors. Safe to run on a schedule; '
  'full recompute so groups that fall below the floor disappear.';

-- Callers must not be able to run this at will (it is a full table scan).
revoke all on function public.refresh_labor_time_aggregates() from public;
revoke all on function public.refresh_labor_time_aggregates() from authenticated;
revoke all on function public.refresh_labor_time_aggregates() from anon;
