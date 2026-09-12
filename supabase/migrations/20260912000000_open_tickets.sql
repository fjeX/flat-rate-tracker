-- Open Tickets, Phase 1 — see docs/plans/PLAN-open-tickets.md
--
-- A warranty engine job is a PROCESS, not an event: teardown on day 1, waiting
-- on approval and parts for a week, op code and labor time known on day 10.
-- The app modelled it as one row on the close day, so the days between read
-- as days off and the close day read as a 14-hour shift. Three things land
-- here so a ticket can exist from teardown day onward:
--
--   1. entries.status — 'open' | 'closed'. An open ticket is an ordinary
--      entries row with no lines yet (decision 1). One identity from teardown
--      to close; nothing is copied at close, so nothing is lost at close.
--   2. ro_events — the ticket's story (decision 4/5). Hours NEVER ride on an
--      event: editing a note must not change a day total.
--   3. unpaid_time.kind gains 'open_work' — the hours (decision 4/10). The
--      stats layer already sums that ledger by date and it is already backed
--      up and imported. Its own bucket, never an "unpaid" total.
--
-- This migration may be applied ahead of the code deploy and re-run by the
-- normal post-pull migrate flow, so every statement is idempotent.

-- =========================================================================
-- 1. entries.status
-- =========================================================================
-- DEFAULT 'closed' IS THE BACKFILL. Every row that exists today is a finished
-- RO — createEntry has required at least one op code since day one — so the
-- default is the truth for all of them, and no UPDATE is needed. The app sets
-- 'open' explicitly; the database never guesses.
alter table public.entries
  add column if not exists status text not null default 'closed';

do $status_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'entries_status_valid'
      and conrelid = 'public.entries'::regclass
  ) then
    alter table public.entries
      add constraint entries_status_valid
        check (status in ('open', 'closed'));
  end if;
end
$status_check$;

-- Partial: the dashboard card asks "my open tickets" on every load. Open rows
-- are a handful; closed rows are thousands. Nothing else ever filters on
-- status — flag sums deliberately do NOT (an open row's flag_hours is 0 by
-- construction, and a status filter in the flag path would silently drop a
-- closed RO the day a future bug leaves status stale).
create index if not exists entries_user_open_idx
  on public.entries(user_id) where status = 'open';

-- =========================================================================
-- 2. ro_events — the timeline
-- =========================================================================
-- Fixed vocabulary + 'custom' (decision 5). The LATEST event is the ticket's
-- status; there is no separate status-text column to drift from it. Not an
-- enum type: adding a value to a CHECK is a one-line ALTER (same reasoning as
-- entry_op_codes.actual_source).
--
-- `date` is a plain date, string-compared like entries.date (see 20260816 for
-- why a timestamptz would hand the timezone foot-gun straight back). `time` is
-- an optional HH:MM wall clock read as local to its own date, the same shape
-- and the same CHECK as entries.logged_time.
--
-- user_id is denormalised onto the row rather than derived through entry_id so
-- the RLS policy is a column compare, not a subquery per row. entry_op_codes
-- pays that subquery and it is the one policy in the schema that does.
--
-- ON DELETE CASCADE, unlike unpaid_time.entry_id (SET NULL). A timeline
-- without its ticket is meaningless; a ledger row without its ticket is still
-- hours you worked. Deleting an open ticket therefore keeps its open_work rows
-- (dated, orphaned, still counted as worked days). That is correct: the hours
-- happened.
create table if not exists public.ro_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  entry_id uuid not null references public.entries on delete cascade,
  date date not null,
  time text
    constraint ro_events_time_hhmm
      check (time is null or time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  kind text not null
    constraint ro_events_kind_valid
      check (kind in (
        'opened',
        'diag_done',
        'teardown_approved',
        'teardown_done',
        'cause_found',
        'parts_ordered',
        'approval_received',
        'repair_done',
        'hold_parts',
        'hold_approval',
        'reopened',
        'closed',
        'custom'
      )),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chronological read per ticket. Zero-padded HH:MM sorts lexicographically in
-- time order, so (date, time) needs no parsing; a null time sorts after every
-- timed event on the same day (Postgres default NULLS LAST ascending), which
-- is the honest position for "sometime that day".
create index if not exists ro_events_entry_idx
  on public.ro_events(entry_id, date, time);

alter table public.ro_events enable row level security;
drop policy if exists "own_ro_events" on public.ro_events;
create policy "own_ro_events" on public.ro_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Prove the app can reach the new table. 20260815000000_revoke_ddl_grants.sql
-- altered the default privileges for postgres-created tables, and this is the
-- first table created since. If that ALTER DEFAULT PRIVILEGES had taken more
-- than it meant to, the symptom would be "permission denied for table
-- ro_events" thrown from the first Open Ticket save in production — so it is
-- checked here, at the moment the table exists, rather than discovered then.
do $ro_events_crud$
declare
  missing text;
begin
  select string_agg(v.verb, ', ')
    into missing
    from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as v(verb)
   where not has_table_privilege('authenticated', 'public.ro_events'::regclass, v.verb);

  if missing is not null then
    raise exception
      'open_tickets: authenticated has no % on ro_events. The default '
      'privileges did not carry over — grant them explicitly.', missing;
  end if;
end
$ro_events_crud$;

-- =========================================================================
-- 3. unpaid_time.kind gains 'open_work'
-- =========================================================================
-- The original CHECK was written inline on the column in 20260724, so Postgres
-- named it for us (unpaid_time_kind_check). It is located by DEFINITION rather
-- than by that name: a check constraint on this table that mentions `kind` and
-- does not yet admit 'open_work' is the one to replace, whatever it is called.
-- A re-run finds the replacement already admits the value and does nothing.
--
-- The `source` CHECK is unchanged: 'manual' | 'timer' | 'zero_day' already
-- covers both capture paths (decision 3 — typed hours and timer hours are
-- source-tagged exactly like actual_source on a line).
do $open_work_kind$
declare
  stale text;
begin
  select conname
    into stale
    from pg_constraint
   where conrelid = 'public.unpaid_time'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ~ '\mkind\M'
     and pg_get_constraintdef(oid) !~ 'open_work'
   limit 1;

  if stale is not null then
    execute format('alter table public.unpaid_time drop constraint %I', stale);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'unpaid_time_kind_valid'
      and conrelid = 'public.unpaid_time'::regclass
  ) then
    alter table public.unpaid_time
      add constraint unpaid_time_kind_valid
        check (kind in (
          'comeback_own',
          'comeback_other',
          'rework_same_visit',
          'wait_parts',
          'wait_approval',
          'shop_time',
          'open_work'          -- hours on an open ticket; paid late, never "unpaid"
        ));
  end if;
end
$open_work_kind$;

-- Prove it, in both directions: the new value is accepted and an unknown one
-- is still refused. A dropped-but-never-re-added CHECK would pass the first
-- test and silently turn the column into free text.
do $open_work_proof$
declare
  ok boolean;
begin
  select pg_get_constraintdef(oid) ~ 'open_work'
    into ok
    from pg_constraint
   where conname = 'unpaid_time_kind_valid'
     and conrelid = 'public.unpaid_time'::regclass;
  if ok is distinct from true then
    raise exception 'open_tickets: unpaid_time_kind_valid does not admit open_work';
  end if;

  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.unpaid_time'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~ '\mkind\M'
       and conname <> 'unpaid_time_kind_valid'
  ) then
    raise exception 'open_tickets: a second kind CHECK survived on unpaid_time';
  end if;
end
$open_work_proof$;

-- =========================================================================
-- 4. import_replace_account v5 — carry entries.status and ro_events
-- =========================================================================
-- WHY THE WHOLE FUNCTION AGAIN
-- There is no CREATE OR REPLACE ... ADD ONE TABLE; the body is redefined in
-- full (see the v4 header). Everything v3/v4 established is reproduced verbatim
-- below — SECURITY INVOKER under RLS, user_id stamped from auth.uid(), one
-- implicit transaction, a table cleared only when the payload carries its key,
-- a missing settings key meaning "keep the destination's value", is_admin never
-- named — plus:
--
--   * entries.status rides in through jsonb_populate_recordset like every other
--     entries column. It is NOT NULL, so the payload MUST carry it; a pre-v5
--     backup has no such key and src/lib/import-remap.ts fills 'closed' (every
--     RO that predates the feature is a finished RO — the same reading the
--     column default encodes).
--   * ro_events is cleared by the entries cascade (its FK is ON DELETE
--     CASCADE), and restored only when the payload names it. Inserted AFTER
--     entries because entry_id is NOT NULL and a non-deferrable FK.
CREATE OR REPLACE FUNCTION import_replace_account(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  data jsonb;
  s jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'import_replace_account: no authenticated user';
  END IF;
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'import_replace_account: payload must be a JSON object';
  END IF;

  -- Stamp user_id onto every row of every array in one pass, overwriting
  -- whatever the client sent. Tables with no user_id column ignore the extra key
  -- (jsonb_populate_recordset drops keys that match no column), so applying it
  -- uniformly is safe and keeps the ownership rule in exactly one place.
  SELECT jsonb_object_agg(
           t.key,
           CASE WHEN jsonb_typeof(t.value) = 'array' THEN
             coalesce(
               (SELECT jsonb_agg(jsonb_set(elem, '{user_id}', to_jsonb(uid)))
                  FROM jsonb_array_elements(t.value) AS elem),
               '[]'::jsonb)
           ELSE t.value END)
    INTO data
    FROM jsonb_each(payload) AS t;

  -- ---------------------------------------------------------------------
  -- Clear
  -- ---------------------------------------------------------------------

  -- A running timer points at an RO that is about to stop existing. Unlike a
  -- dispute — a frozen claim that outlives its RO by design — a timer slot is
  -- live state, so it is always cleared no matter what the payload carries.
  DELETE FROM active_timers WHERE user_id = uid;

  -- Conditional clears run BEFORE the entry wipe so their rows are deleted
  -- outright rather than first having their entry_id nulled by the FK.
  IF data ? 'disputes' THEN
    -- dispute_lines cascades from disputes; deleted explicitly first so a future
    -- schema change that drops the cascade cannot silently orphan them.
    DELETE FROM dispute_lines WHERE user_id = uid;
    DELETE FROM disputes WHERE user_id = uid;
  END IF;
  IF data ? 'unpaid_time' THEN
    DELETE FROM unpaid_time WHERE user_id = uid;
  END IF;
  IF data ? 'labor_rates' THEN
    DELETE FROM labor_rates WHERE user_id = uid;
  END IF;

  -- v3 tables. None is referenced by a foreign key from anything else, so they
  -- clear in any order and need no placement relative to the entry wipe.
  IF data ? 'work_schedules' THEN
    DELETE FROM work_schedules WHERE user_id = uid;
  END IF;
  IF data ? 'days_off' THEN
    DELETE FROM days_off WHERE user_id = uid;
  END IF;
  IF data ? 'work_shift_overrides' THEN
    DELETE FROM work_shift_overrides WHERE user_id = uid;
  END IF;
  IF data ? 'confirmed_zero_days' THEN
    DELETE FROM confirmed_zero_days WHERE user_id = uid;
  END IF;
  IF data ? 'portfolio_snapshots' THEN
    DELETE FROM portfolio_snapshots WHERE user_id = uid;
  END IF;
  IF data ? 'career_milestones' THEN
    DELETE FROM career_milestones WHERE user_id = uid;
  END IF;

  -- v5. Cascades from entries below, but deleted explicitly first for the same
  -- reason dispute_lines is: a future schema change that drops the cascade
  -- must not silently orphan a timeline onto a stranger's entry id.
  DELETE FROM ro_events WHERE user_id = uid;

  -- Bonuses before entries: the entry_id FK is ON DELETE SET NULL, so dropping
  -- entries first would keep the bonus rows with the link nulled instead of
  -- removing them.
  DELETE FROM bonuses WHERE user_id = uid;
  -- Cascades entry_op_codes, entry_photos, labor_time_observations and
  -- ro_events. The photo BINARIES in storage are purged by the caller only
  -- after this transaction commits, so a rollback leaves both the rows and the
  -- files intact.
  DELETE FROM entries WHERE user_id = uid;
  DELETE FROM op_codes WHERE user_id = uid;  -- op_code_variants cascade
  DELETE FROM daily_clock_hours WHERE user_id = uid;
  DELETE FROM paid_period_hours WHERE user_id = uid;

  -- ---------------------------------------------------------------------
  -- Restore
  --
  -- jsonb_populate_recordset against a null base means an omitted key lands as
  -- NULL, not the column default — so the payload must carry every column. That
  -- is the caller's contract (src/lib/import-remap.ts); a NOT NULL column fails
  -- loudly here and rolls the whole import back.
  -- A missing top-level key yields NULL, which populates zero rows.
  -- ---------------------------------------------------------------------

  INSERT INTO op_codes
  SELECT * FROM jsonb_populate_recordset(null::op_codes, data->'op_codes');

  INSERT INTO op_code_variants
  SELECT * FROM jsonb_populate_recordset(null::op_code_variants, data->'op_code_variants');

  -- comeback_of_entry_id is a self-reference: an RO can be logged as the redo of
  -- one that appears later in the file. Safe in a single multi-row INSERT
  -- because a non-deferrable FK is verified at end of statement, by which point
  -- every row of the batch is present.
  INSERT INTO entries
  SELECT * FROM jsonb_populate_recordset(null::entries, data->'entries');

  -- Fires entry_op_codes_recompute_aiud, which recomputes entries.flag_hours
  -- from the lines — so the denormalized total lands correct by construction.
  -- An open ticket has no lines, never fires it, and keeps the 0 it carried.
  INSERT INTO entry_op_codes
  SELECT * FROM jsonb_populate_recordset(null::entry_op_codes, data->'entry_op_codes');

  -- v5. After entries (entry_id is NOT NULL and a non-deferrable FK).
  IF data ? 'ro_events' THEN
    INSERT INTO ro_events
    SELECT * FROM jsonb_populate_recordset(null::ro_events, data->'ro_events');
  END IF;

  INSERT INTO bonuses
  SELECT * FROM jsonb_populate_recordset(null::bonuses, data->'bonuses');

  INSERT INTO daily_clock_hours
  SELECT * FROM jsonb_populate_recordset(null::daily_clock_hours, data->'daily_clock_hours');

  INSERT INTO paid_period_hours
  SELECT * FROM jsonb_populate_recordset(null::paid_period_hours, data->'paid_period_hours');

  IF data ? 'labor_rates' THEN
    INSERT INTO labor_rates
    SELECT * FROM jsonb_populate_recordset(null::labor_rates, data->'labor_rates');
  END IF;

  IF data ? 'disputes' THEN
    INSERT INTO disputes
    SELECT * FROM jsonb_populate_recordset(null::disputes, data->'disputes');

    INSERT INTO dispute_lines
    SELECT * FROM jsonb_populate_recordset(null::dispute_lines, data->'dispute_lines');
  END IF;

  IF data ? 'unpaid_time' THEN
    INSERT INTO unpaid_time
    SELECT * FROM jsonb_populate_recordset(null::unpaid_time, data->'unpaid_time');
  END IF;

  -- --- v3: Schedule ---------------------------------------------------
  -- work_schedules carries anchor_monday verbatim rather than re-deriving it
  -- from effective_from. The anchor fixes which week of the rotation is "week
  -- A"; re-deriving it lands a 2-week rotation half a cycle out of phase, which
  -- changes every scheduled hour after that date — and scheduled hours are the
  -- efficiency denominator. The table's own CHECK (dow = 1) still enforces that
  -- whatever arrives really is a Monday, and a violation rolls the import back.
  IF data ? 'work_schedules' THEN
    INSERT INTO work_schedules
    SELECT * FROM jsonb_populate_recordset(null::work_schedules, data->'work_schedules');
  END IF;

  IF data ? 'days_off' THEN
    INSERT INTO days_off
    SELECT * FROM jsonb_populate_recordset(null::days_off, data->'days_off');
  END IF;

  IF data ? 'work_shift_overrides' THEN
    INSERT INTO work_shift_overrides
    SELECT * FROM jsonb_populate_recordset(null::work_shift_overrides, data->'work_shift_overrides');
  END IF;

  IF data ? 'confirmed_zero_days' THEN
    INSERT INTO confirmed_zero_days
    SELECT * FROM jsonb_populate_recordset(null::confirmed_zero_days, data->'confirmed_zero_days');
  END IF;

  -- --- v3: Career -----------------------------------------------------
  -- Both of these are frozen records, like a dispute. portfolio_snapshots.stats
  -- is the product — a dated snapshot, never regenerated — and
  -- career_milestones.achieved_at is when the threshold was actually crossed.
  -- Re-stamping either would compress a multi-year career into one afternoon.
  IF data ? 'portfolio_snapshots' THEN
    INSERT INTO portfolio_snapshots
    SELECT * FROM jsonb_populate_recordset(null::portfolio_snapshots, data->'portfolio_snapshots');
  END IF;

  IF data ? 'career_milestones' THEN
    INSERT INTO career_milestones
    SELECT * FROM jsonb_populate_recordset(null::career_milestones, data->'career_milestones');
  END IF;

  -- ---------------------------------------------------------------------
  -- Settings — per-column, presence-driven
  --
  -- Deliberately NOT jsonb_populate_record: that maps an absent key to NULL,
  -- which is the whole bug this section exists to avoid. Each column is applied
  -- only when the payload names it; otherwise the destination keeps what it had.
  --
  -- is_admin does not appear below and must never be added.
  -- ---------------------------------------------------------------------
  IF data ? 'settings' AND jsonb_typeof(data->'settings') = 'object' THEN
    s := data->'settings';

    -- Guarantee a row so the UPDATE has something to hit. handle_new_user()
    -- seeds one on signup, but import must not depend on that having run.
    -- Inserting only user_id means every column starts at its declared default,
    -- so "keep the destination's value" on a fresh account means "keep the
    -- default" — which is the right answer there.
    INSERT INTO user_settings (user_id) VALUES (uid)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE user_settings SET
      -- NOT NULL columns: a JSON null is corruption, not an instruction, so it
      -- reads as absent rather than aborting an otherwise good import.
      split_day = CASE
        WHEN s ? 'split_day' AND jsonb_typeof(s->'split_day') <> 'null'
        THEN (s->>'split_day')::int ELSE split_day END,
      period_overrides = CASE
        WHEN s ? 'period_overrides' AND jsonb_typeof(s->'period_overrides') <> 'null'
        THEN s->'period_overrides' ELSE period_overrides END,
      goal_hours = CASE
        WHEN s ? 'goal_hours' AND jsonb_typeof(s->'goal_hours') <> 'null'
        THEN (s->>'goal_hours')::int ELSE goal_hours END,
      tag_colors = CASE
        WHEN s ? 'tag_colors' AND jsonb_typeof(s->'tag_colors') <> 'null'
        THEN s->'tag_colors' ELSE tag_colors END,
      -- A consent flag. Carried verbatim when present, never inferred: its old
      -- behaviour of quietly reverting to false un-enrolled a True Time
      -- contributor without telling them.
      share_labor_times = CASE
        WHEN s ? 'share_labor_times' AND jsonb_typeof(s->'share_labor_times') <> 'null'
        THEN (s->>'share_labor_times')::boolean ELSE share_labor_times END,
      -- v4. Same NOT NULL treatment as the flags above. Without this line a
      -- restored account silently stops recording RO times: the forms just quit
      -- asking, which nobody notices until they go looking for a time weeks
      -- later and find blanks.
      track_ro_time = CASE
        WHEN s ? 'track_ro_time' AND jsonb_typeof(s->'track_ro_time') <> 'null'
        THEN (s->>'track_ro_time')::boolean ELSE track_ro_time END,

      -- Nullable columns: an explicit null is a real value — "this account has
      -- no reference rate / no template / no default labor type" — and writing
      -- it through is the point. nullif() on the jsonb ones converts a JSON
      -- null to a SQL NULL; `->` would otherwise store the literal token 'null'
      -- and every `IS NULL` read downstream would miss it.
      reference_hourly_rate = CASE
        WHEN s ? 'reference_hourly_rate'
        THEN (s->>'reference_hourly_rate')::numeric ELSE reference_hourly_rate END,
      ro_template = CASE
        WHEN s ? 'ro_template'
        THEN nullif(s->'ro_template', 'null'::jsonb) ELSE ro_template END,
      default_labor_type = CASE
        WHEN s ? 'default_labor_type'
        THEN s->>'default_labor_type' ELSE default_labor_type END,

      updated_at = now()
    WHERE user_id = uid;
  END IF;
END;
$$;

-- Functions are executable by PUBLIC by default; this one replaces an entire
-- account, so narrow it to signed-in callers explicitly.
REVOKE ALL ON FUNCTION import_replace_account(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION import_replace_account(jsonb) TO authenticated;
