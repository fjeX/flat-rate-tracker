-- RO time-of-day + upsell marking.
--
-- Two independent features that share one migration because both are additive
-- columns on the RO tables and neither backfills anything.
--
-- =========================================================================
-- 1. entries.logged_time — WHEN in the day this RO happened
-- =========================================================================
-- WHY A WALL-CLOCK STRING AND NOT A TIMESTAMPTZ
-- entries.date is a plain `date` on purpose: every date computation in this app
-- is string-based ("YYYY-MM-DD") precisely so a server in UTC and a browser in
-- America/Los_Angeles can never disagree about which day an RO belongs to
-- (src/lib/periods.ts, forecast.ts, streak.ts all say so at the top).
--
-- A timestamptz here would hand that foot-gun straight back. An RO dated
-- 2026-08-14 with worked_at = 2026-08-15T04:42Z renders as Aug 14 in Los
-- Angeles and Aug 15 in UTC, and the app would then hold two answers to "what
-- day was this job" — one of which every period, streak and efficiency
-- calculation ignores.
--
-- A wall-clock time has no such second opinion. It is read as local to the RO's
-- own date, the same way work_schedules stores shift times as "08:00"/"17:00"
-- strings inside its weeks jsonb. The user's timezone setting is consulted at
-- CAPTURE time to pick the default value, and never again — so a tech who logs
-- an RO in Phoenix and reviews it in Denver sees the time they entered.
--
-- Nullable, and null is the common case:
--   * every RO logged before this migration
--   * every RO logged while the setting below is off
-- Null renders as nothing at all. It must never be shown as 00:00, and it must
-- never be inferred from created_at — created_at is when the ROW was written,
-- which for a tech who batches their paperwork at 9pm is exactly the misleading
-- number this feature exists to avoid.
--
-- created_at stays immutable. It is the audit anchor (same reason
-- entry_photos.captured_at is), and "when was this logged" and "when was this
-- worked" are different questions that must not collapse into one column.
alter table public.entries
  add column if not exists logged_time text;

-- 24-hour HH:MM, zero-padded. Zero-padding is load-bearing beyond tidiness:
-- it makes lexicographic ordering agree with chronological ordering, so
-- `order by date, logged_time` is correct without parsing anything.
do $logged_time_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'entries_logged_time_hhmm'
      and conrelid = 'public.entries'::regclass
  ) then
    alter table public.entries
      add constraint entries_logged_time_hhmm
        check (logged_time is null
               or logged_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end
$logged_time_check$;

-- =========================================================================
-- 2. user_settings.track_ro_time — the on/off switch
-- =========================================================================
-- Off by default, which is also what a pre-migration read of this column gives
-- you. Off means the log forms show no time field and write no logged_time —
-- NOT "capture it silently and hide it". A tech who enters twelve ROs at 9pm
-- would otherwise accumulate twelve 9pm timestamps that look like measurements
-- and aren't, and flipping the setting on later would surface them as history.
--
-- This lives in the database rather than in a cookie (where the timezone
-- setting lives) because it changes what gets WRITTEN. A cookie is per-browser;
-- logging an RO from the phone and another from the laptop would otherwise
-- capture different things for the same account.
alter table public.user_settings
  add column if not exists track_ro_time boolean not null default false;

-- REQUIRED, not optional — see 20260812010000_lock_is_admin.sql. That migration
-- revoked the table-level UPDATE on user_settings and handed back a named
-- column list, so is_admin cannot be self-granted. A column added afterwards
-- inherits NO privilege from that table: without this grant the app would fail
-- with "permission denied for column track_ro_time" the first time anyone
-- touched the toggle, in production, at runtime.
grant update (track_ro_time) on public.user_settings to authenticated;

-- =========================================================================
-- 3. entry_op_codes.is_upsell — HOW the work was sold
-- =========================================================================
-- WHY A PER-LINE FLAG AND NOT A LABOR TYPE
-- labor_type answers "who pays for this" (customer_pay / warranty / internal /
-- used_car) and it is what earnings are keyed on — src/lib/earnings.ts looks up
-- the rate by type. An upsell is orthogonal to that: it is still customer pay,
-- and a warranty job can be upsold too. Adding "upsell" as a sixth labor type
-- would leave upsold work unpriced (no rate row), force a duplicate rate, and
-- make "warranty upsell" inexpressible.
--
-- WHY NOT A LIBRARY TAG
-- op_codes.tags describes the op code, not this instance of it. The same code
-- is an upsell on one RO and the customer's original complaint on the next.
-- Only a per-LINE fact can tell those apart.
--
-- The shape is a deliberate copy of is_comeback (2026-07-27), which exists for
-- the same reason at the same granularity.
alter table public.entry_op_codes
  add column if not exists is_upsell boolean not null default false;

-- A line cannot be both. A comeback is unpaid rework — work you are redoing for
-- free — and an upsell is work you sold. Marking one line as both would feed
-- zero flag hours (comebacks flag zero by CHECK) into "hours I upsold", which
-- reports a sale that earned nothing, and would let a mis-tap in the RO modal
-- corrupt the figure silently. The constraint makes the combination impossible
-- rather than relying on the two UI toggles never both being reachable.
do $upsell_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'entry_op_codes_upsell_not_comeback'
      and conrelid = 'public.entry_op_codes'::regclass
  ) then
    alter table public.entry_op_codes
      add constraint entry_op_codes_upsell_not_comeback
        check (not (is_comeback and is_upsell));
  end if;
end
$upsell_check$;

-- Partial, mirroring entry_op_codes_comeback_idx: upsold lines are the minority
-- and every query that wants them wants only them ("what did I sell this
-- period"). Existing rows are all false, so this builds against nothing.
create index if not exists entry_op_codes_upsell_idx
  on public.entry_op_codes(entry_id)
  where is_upsell;

-- =========================================================================
-- 4. Re-run the lock_is_admin tripwire
-- =========================================================================
-- The check at the end of 20260812010000_lock_is_admin.sql runs once, when THAT
-- migration is applied, so it cannot see a column a later migration adds — this
-- one. Re-running it here proves the grant above actually landed, and fails
-- this migration loudly if a future edit drops it.
do $grant_check$
declare
  ungranted text[];
begin
  select array_agg(c.column_name order by c.column_name) into ungranted
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'user_settings'
     and c.column_name not in ('user_id', 'is_admin')
     and not exists (
       select 1 from information_schema.column_privileges p
        where p.table_schema = 'public'
          and p.table_name = 'user_settings'
          and p.column_name = c.column_name
          and p.grantee = 'authenticated'
          and p.privilege_type = 'UPDATE');

  if ungranted is not null then
    raise exception
      'ro_time_and_upsell: user_settings column(s) % have no UPDATE grant for '
      'authenticated. Add them to a GRANT UPDATE, or exclude them deliberately '
      'like is_admin.', ungranted;
  end if;
end
$grant_check$;
