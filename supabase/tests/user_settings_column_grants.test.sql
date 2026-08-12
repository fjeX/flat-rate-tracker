-- Sandbox test for 20260812010000_lock_is_admin.sql.
--
-- The thing under test is a PRIVILEGE, and a privilege is invisible to tsc, to
-- the unit suite and to any test that runs as the table owner. It only shows up
-- when a statement runs as the `authenticated` role, which is why this lives
-- here and not in vitest.
--
-- The escalation this closes was real: before this migration, `UPDATE
-- user_settings SET is_admin = true` on your own row returned UPDATE 1 under the
-- authenticated role, and that account could then read and write every user's
-- bug reports.
--
-- HOW TO RUN — on the VM, against the schema clone the v2 import test describes:
--
--   docker exec -i supabase-db psql -U postgres -d frt_import_test -f - \
--     < supabase/migrations/20260812010000_lock_is_admin.sql
--   docker exec -i supabase-db psql -U postgres -d frt_import_test -f - \
--     < supabase/tests/user_settings_column_grants.test.sql
--
-- Last full run: 8 PASS / 0 FAIL (2026-08-12).

\set ON_ERROR_STOP on
\set QUIET on

create or replace function chk(label text, cond boolean) returns void language plpgsql as $fn$
begin
  if cond then raise notice 'PASS  %', label; else raise warning 'FAIL  %', label; end if;
end $fn$;

delete from auth.users where id = '44444444-4444-4444-8444-444444444444';
insert into auth.users (id, instance_id, aud, role, email)
values ('44444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','grants@test');

set request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444"}';
set role authenticated;

\echo
\echo '=========== the escalation is closed ==========='

do $esc$
begin
  update user_settings set is_admin = true
   where user_id = '44444444-4444-4444-8444-444444444444';
  perform chk('self-granting is_admin is refused', false);
exception when insufficient_privilege then
  perform chk('self-granting is_admin is refused: ' || SQLERRM, true);
end $esc$;

-- Sneaking it in beside a column the user IS allowed to write must fail too —
-- the grant is checked per column named in the SET list, not per statement.
do $esc2$
begin
  update user_settings set goal_hours = 77, is_admin = true
   where user_id = '44444444-4444-4444-8444-444444444444';
  perform chk('is_admin smuggled alongside a legal column is refused', false);
exception when insufficient_privilege then
  perform chk('is_admin smuggled alongside a legal column is refused', true);
end $esc2$;

-- The policy is `for all`, so a user can delete their own settings row. If only
-- UPDATE were locked, DELETE-then-INSERT would be an identical bypass.
do $esc3$
begin
  delete from user_settings where user_id = '44444444-4444-4444-8444-444444444444';
  insert into user_settings (user_id, is_admin)
    values ('44444444-4444-4444-8444-444444444444', true);
  perform chk('DELETE-then-INSERT bypass is refused', false);
exception when insufficient_privilege then
  perform chk('DELETE-then-INSERT bypass is refused: ' || SQLERRM, true);
end $esc3$;

reset role;
select chk('the account is still not an admin after all three attempts',
           coalesce((select is_admin from user_settings
                      where user_id = '44444444-4444-4444-8444-444444444444'), false) = false);

-- Restore the row the delete attempt rolled back into, so the next section runs
-- against the normal state.
insert into user_settings (user_id) values ('44444444-4444-4444-8444-444444444444')
  on conflict (user_id) do nothing;
set role authenticated;

\echo
\echo '=========== legitimate writes still work ==========='

-- Every column src/lib/db/settings.ts writes in updateSettings(). If any of
-- these is missing from the GRANT, the settings page throws in production.
do $legit$
begin
  update user_settings set
    split_day = 20, period_overrides = '{}'::jsonb, goal_hours = 99,
    tag_colors = '{"Brakes":4}'::jsonb, reference_hourly_rate = 38.25,
    ro_template = '[{"code":"LOF"}]'::jsonb, default_labor_type = 'warranty',
    share_labor_times = true, updated_at = now()
   where user_id = '44444444-4444-4444-8444-444444444444';
  perform chk('updateSettings() writes every column it needs', true);
exception when insufficient_privilege then
  perform chk('updateSettings() writes every column it needs: ' || SQLERRM, false);
end $legit$;

select chk('the legitimate write actually landed',
           (select goal_hours from user_settings
             where user_id = '44444444-4444-4444-8444-444444444444') = 99);

-- import_replace_account() is SECURITY INVOKER, so it runs under exactly these
-- grants — including its ensure-the-row-exists INSERT (user_id).
do $rpc$
begin
  perform import_replace_account(
    '{"settings": {"split_day": 7, "period_overrides": {}, "goal_hours": 120},
      "op_codes": [], "op_code_variants": [], "entries": [], "entry_op_codes": [],
      "bonuses": [], "daily_clock_hours": [], "paid_period_hours": []}'::jsonb);
  perform chk('import_replace_account still runs under the narrowed grants', true);
exception when insufficient_privilege then
  perform chk('import_replace_account still runs under the narrowed grants: ' || SQLERRM, false);
end $rpc$;

select chk('the import actually applied its settings',
           (select split_day::text||'/'||goal_hours::text from user_settings
             where user_id = '44444444-4444-4444-8444-444444444444') = '7/120');

reset role;
reset request.jwt.claims;
