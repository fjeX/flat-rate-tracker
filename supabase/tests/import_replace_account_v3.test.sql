-- Sandbox test for the v3 additions to import_replace_account():
-- the six Schedule/Career tables, and per-column settings handling.
--
-- The v2 file (import_replace_account.test.sql) still covers atomicity, the
-- cross-account id collision, RLS and the user_id stamp. This one covers only
-- what v3 introduced, so run BOTH.
--
-- WHY THIS EXISTS SEPARATELY
-- v3's headline rule is a NEGATIVE: a settings key the payload does not carry
-- must leave the destination's value ALONE. Nothing in the v2 suite could catch
-- a violation, because v2's behaviour — coalesce to the column default — looked
-- identical whenever the payload happened to carry every key. The bug only
-- appears when restoring an OLDER file into a configured account, which is
-- exactly what "move my account to a new one" does after any future migration.
--
-- HOW TO RUN — on the VM, against the same schema clone the v2 file describes:
--
--   docker exec -i supabase-db psql -U postgres -d frt_import_test -f - \
--     < supabase/migrations/20260812000000_import_replace_account_v3.sql
--   docker exec -i supabase-db psql -U postgres -d frt_import_test -f - \
--     < supabase/tests/import_replace_account_v3.test.sql
--
-- Every check prints PASS or FAIL. Any FAIL, or any ERROR, means import is
-- unsafe to ship. Last full run: 38 PASS / 0 FAIL (2026-08-12), alongside the
-- v2 file's 32 PASS / 0 FAIL against the same v3 function.

\set ON_ERROR_STOP on
\set QUIET on

create or replace function chk(label text, cond boolean) returns void language plpgsql as $fn$
begin
  if cond then raise notice 'PASS  %', label; else raise warning 'FAIL  %', label; end if;
end $fn$;

-- ---- seed, as superuser ----
-- A fresh account. on_auth_user_created seeds its user_settings row at defaults,
-- which is the state a real destination account is in.
delete from auth.users where id = '33333333-3333-4333-8333-333333333333';
insert into auth.users (id, instance_id, aud, role, email)
values ('33333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v3target@test');

-- The payload shape buildImportPayload() emits for v3. anchor_monday is a real
-- Monday (2026-01-05) because work_schedules CHECKs extract(dow) = 1, and
-- career_milestones.achieved_at is deliberately years old — a re-stamp would
-- show up as today's date.
create or replace function v3_payload() returns jsonb language sql immutable as $p$
select $json${
  "settings": {
    "split_day": 20,
    "period_overrides": {"2026-08-P1": {"start": "2026-08-01", "end": "2026-08-14"}},
    "goal_hours": 95,
    "tag_colors": {"Brakes": 4},
    "reference_hourly_rate": 38.25,
    "ro_template": [{"code": "LOF", "description": "Oil change"}],
    "default_labor_type": "warranty",
    "share_labor_times": true
  },
  "op_codes": [], "op_code_variants": [], "entries": [], "entry_op_codes": [],
  "bonuses": [], "daily_clock_hours": [], "paid_period_hours": [],
  "work_schedules": [
    {"id": "e1000000-0000-4000-8000-000000000001",
     "effective_from": "2026-01-05",
     "rotation_weeks": 2,
     "anchor_monday": "2026-01-05",
     "weeks": [
       [{"start":"08:00","end":"17:00","breakMin":60},{"start":"08:00","end":"17:00","breakMin":60},{"start":"08:00","end":"17:00","breakMin":60},{"start":"08:00","end":"17:00","breakMin":60},{"start":"08:00","end":"17:00","breakMin":60},null,null],
       [{"start":"10:00","end":"19:00","breakMin":30},{"start":"10:00","end":"19:00","breakMin":30},{"start":"10:00","end":"19:00","breakMin":30},{"start":"10:00","end":"19:00","breakMin":30},null,null,null]
     ],
     "created_at": "2026-01-05T00:00:00Z"}
  ],
  "days_off": [
    {"id": "e2000000-0000-4000-8000-000000000001",
     "start_date": "2026-03-01", "end_date": "2026-03-07",
     "created_at": "2026-02-01T00:00:00Z"}
  ],
  "work_shift_overrides": [
    {"date": "2026-04-02", "shift": {"start":"08:00","end":"19:00","breakMin":60},
     "created_at": "2026-08-12T00:00:00Z"}
  ],
  "confirmed_zero_days": [
    {"date": "2026-04-09", "created_at": "2026-08-12T00:00:00Z"}
  ],
  "portfolio_snapshots": [
    {"id": "e3000000-0000-4000-8000-000000000001",
     "seq": 1, "ro_threshold": 25,
     "stats": {"roCount": 25, "flagHours": 142.5},
     "created_at": "2026-05-01T00:00:00Z"}
  ],
  "career_milestones": [
    {"threshold": 500, "achieved_at": "2024-11-03T00:00:00Z"},
    {"threshold": 1000, "achieved_at": "2025-09-18T00:00:00Z"}
  ]
}$json$::jsonb
$p$;

-- ---- everything below runs as the signed-in target user, under RLS ----
set request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333"}';
set role authenticated;

\echo
\echo '=========== A. the six v3 tables land ==========='
select import_replace_account(v3_payload());

select chk('work_schedules imported', (select count(*) from work_schedules) = 1);
-- The load-bearing one. anchor_monday fixes which week of the rotation is "week
-- A"; re-deriving it from effective_from would put a 2-week rotation half a
-- cycle out of phase and silently change every scheduled hour — and scheduled
-- hours are the efficiency denominator.
select chk('anchor_monday carried verbatim, not re-derived',
           (select anchor_monday from work_schedules) = date '2026-01-05');
select chk('rotation_weeks + weeks travelled together',
           (select rotation_weeks from work_schedules) = 2
       and (select jsonb_array_length(weeks) from work_schedules) = 2);
select chk('week B shift survived (rotation is not flattened)',
           (select weeks->1->0->>'start' from work_schedules) = '10:00');
select chk('days_off imported as a RANGE, not a single date',
           (select start_date::text||'..'||end_date::text from days_off) = '2026-03-01..2026-03-07');
select chk('work_shift_overrides imported with its shift object',
           (select shift->>'end' from work_shift_overrides where date = '2026-04-02') = '19:00');
select chk('confirmed_zero_days imported',
           (select count(*) from confirmed_zero_days where date = '2026-04-09') = 1);
select chk('portfolio_snapshots imported with frozen stats',
           (select stats->>'flagHours' from portfolio_snapshots where seq = 1) = '142.5');
select chk('career_milestones imported', (select count(*) from career_milestones) = 2);
-- Re-stamping this would compress a multi-year career into one afternoon.
select chk('achieved_at carried verbatim (career not compressed into today)',
           (select achieved_at from career_milestones where threshold = 500) = timestamptz '2024-11-03T00:00:00Z');

\echo
\echo '=========== B. all eight settings columns apply ==========='
select chk('split_day applied',           (select split_day from user_settings) = 20);
select chk('period_overrides applied',    (select period_overrides->'2026-08-P1'->>'start' from user_settings) = '2026-08-01');
select chk('goal_hours applied',          (select goal_hours from user_settings) = 95);
select chk('tag_colors applied',          (select tag_colors->>'Brakes' from user_settings) = '4');
select chk('reference_hourly_rate applied', (select reference_hourly_rate from user_settings) = 38.25);
select chk('ro_template applied',         (select ro_template->0->>'code' from user_settings) = 'LOF');
select chk('default_labor_type applied',  (select default_labor_type from user_settings) = 'warranty');
-- A consent flag. Its old behaviour — silently reverting to false — un-enrolled
-- a True Time contributor without telling them.
select chk('share_labor_times applied (consent not silently revoked)',
           (select share_labor_times from user_settings) = true);

\echo
\echo '=========== C. a key the payload omits keeps the DESTINATION value ==========='
-- This is the v3 rule. Restoring an older file into a configured account must
-- not reset the columns that file predates. v2 wrote the column DEFAULT here.
do $omit$
begin
  perform import_replace_account(
    jsonb_set(v3_payload(), '{settings}',
              '{"split_day": 12, "period_overrides": {}}'::jsonb)
    - 'work_schedules' - 'days_off' - 'work_shift_overrides'
    - 'confirmed_zero_days' - 'portfolio_snapshots' - 'career_milestones');
end $omit$;

select chk('omitted goal_hours kept the destination value (not reset to 88)',
           (select goal_hours from user_settings) = 95);
select chk('omitted tag_colors kept the destination value (not blanked)',
           (select tag_colors->>'Brakes' from user_settings) = '4');
select chk('omitted share_labor_times kept consent ON (not reverted to false)',
           (select share_labor_times from user_settings) = true);
select chk('omitted reference_hourly_rate kept the destination value',
           (select reference_hourly_rate from user_settings) = 38.25);
select chk('a key the payload DOES carry still applies',
           (select split_day from user_settings) = 12);
-- Same "absent is meaningful" rule the v2 tables already follow.
select chk('a v2-shaped payload leaves the schedule alone, does not empty it',
           (select count(*) from work_schedules) = 1
       and (select count(*) from career_milestones) = 2);

\echo
\echo '=========== D. no settings key at all => user_settings untouched ==========='
-- v2 ran its upsert unconditionally, so this wrote split_day = 15.
do $nosettings$
begin
  perform import_replace_account(v3_payload() - 'settings');
end $nosettings$;
select chk('payload with no settings object left split_day alone',
           (select split_day from user_settings) = 12);
select chk('payload with no settings object left goal_hours alone',
           (select goal_hours from user_settings) = 95);

\echo
\echo '=========== E. is_admin cannot be smuggled in ==========='
-- A backup is a JSON file the user can open in a text editor. is_admin is never
-- named in the RPC''s SET list, so no shape of input can reach the column.
reset role;
update user_settings set is_admin = false where user_id = '33333333-3333-4333-8333-333333333333';
set role authenticated;

do $esc$
begin
  perform import_replace_account(
    jsonb_set(v3_payload(), '{settings,is_admin}', 'true'::jsonb));
end $esc$;
select chk('crafted "is_admin": true in the backup did NOT grant admin',
           (select is_admin from user_settings) = false);

-- The mirror case: an admin importing a normal backup must not lose the flag,
-- for the same reason — the column is not the payload''s business either way.
reset role;
update user_settings set is_admin = true where user_id = '33333333-3333-4333-8333-333333333333';
set role authenticated;
do $keepadmin$
begin
  perform import_replace_account(v3_payload());
end $keepadmin$;
select chk('an existing admin flag survived an import that never mentions it',
           (select is_admin from user_settings) = true);
reset role;
update user_settings set is_admin = false where user_id = '33333333-3333-4333-8333-333333333333';
set role authenticated;

\echo
\echo '=========== F. absent and null are different ==========='
-- On a NULLABLE column an explicit null is a real value — "this account has no
-- reference rate" — and writing it through is the point.
do $nulls$
begin
  perform import_replace_account(
    jsonb_set(v3_payload(), '{settings}',
      '{"split_day": 20, "period_overrides": {},
        "reference_hourly_rate": null, "ro_template": null,
        "default_labor_type": null}'::jsonb));
end $nulls$;
select chk('explicit null CLEARED reference_hourly_rate',
           (select reference_hourly_rate from user_settings) is null);
select chk('explicit null on default_labor_type cleared it',
           (select default_labor_type from user_settings) is null);
-- `->` would have stored the jsonb token 'null' here, which is NOT SQL NULL, and
-- every `IS NULL` read downstream would have missed it.
select chk('explicit null stored ro_template as SQL NULL, not the token ''null''',
           (select ro_template from user_settings) is null);
select chk('the same payload still left the untouched columns alone',
           (select goal_hours from user_settings) = 95);

-- On a NOT NULL column a null can only be corruption, so it reads as absent
-- rather than aborting an otherwise good import.
do $notnull$
begin
  perform import_replace_account(
    jsonb_set(v3_payload(), '{settings}',
      '{"split_day": 20, "period_overrides": {},
        "goal_hours": null, "tag_colors": null, "share_labor_times": null}'::jsonb));
  perform chk('null on a NOT NULL settings column did not abort the import', true);
exception when not_null_violation then
  perform chk('null on a NOT NULL settings column did not abort the import: ' || SQLERRM, false);
end $notnull$;
select chk('null goal_hours read as absent, destination value kept',
           (select goal_hours from user_settings) = 95);
select chk('null share_labor_times read as absent, consent kept',
           (select share_labor_times from user_settings) = true);

\echo
\echo '=========== G. v3 tables are REPLACED, not merged ==========='
do $replace$
begin
  perform import_replace_account(
    jsonb_set(v3_payload(), '{career_milestones}',
              '[{"threshold": 100, "achieved_at": "2023-01-01T00:00:00Z"}]'::jsonb));
end $replace$;
select chk('career_milestones replaced wholesale, the stale rows are gone',
           (select count(*) from career_milestones) = 1
       and (select threshold from career_milestones) = 100);
select chk('work_schedules replaced without a unique-violation on (user_id, effective_from)',
           (select count(*) from work_schedules) = 1);
select chk('portfolio_snapshots replaced without a unique-violation on (user_id, seq)',
           (select count(*) from portfolio_snapshots) = 1);

reset role;
reset request.jwt.claims;
