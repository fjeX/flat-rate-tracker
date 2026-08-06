-- Sandbox test for import_replace_account(). NOT part of `npm test` — it needs a
-- real Postgres with the full schema, RLS policies and role grants.
--
-- It is the only coverage the RPC has. The id remapping is unit-tested in
-- src/lib/import-remap.test.ts, but atomicity, the cross-account id collision,
-- RLS, the user_id stamp and the NOT NULL column contract can only be proven
-- against an actual database.
--
-- HOW TO RUN — on the VM, against a SCHEMA CLONE, never against prod:
--
--   # 1. clone the schema (keep privileges: without the GRANTs the run dies on
--   #    "permission denied for table active_timers" under the authenticated role)
--   docker exec supabase-db pg_dump -U postgres -d postgres --schema-only --no-owner > /tmp/frt_schema.sql
--   docker exec supabase-db psql -U postgres -d postgres -c "drop database if exists frt_import_test"
--   docker exec supabase-db psql -U postgres -d postgres -c "create database frt_import_test"
--   docker exec -i supabase-db psql -U postgres -d frt_import_test -q -f - < /tmp/frt_schema.sql
--
--   # 2. apply the migration under test, then run this file
--   docker exec -i supabase-db psql -U postgres -d frt_import_test -f - \
--     < supabase/migrations/20260805000000_import_replace_account.sql
--   docker exec -i supabase-db psql -U postgres -d frt_import_test -f - \
--     < supabase/tests/import_replace_account.test.sql
--
--   # 3. clean up (the VM runs close to its disk threshold)
--   docker exec supabase-db psql -U postgres -d postgres -c "drop database frt_import_test"
--
-- Every check prints PASS or FAIL. Any FAIL, or any ERROR, means import is unsafe
-- to ship. Last full run: 32 PASS / 0 FAIL (2026-08-05).
--
-- The payload below is captured output from the real buildImportPayload(). To
-- refresh it after a shape change, call that function in a scratch vitest spec
-- and write the JSON to disk, then paste it into the three $json$ blocks.
--
-- Gotcha worth knowing: inserting into auth.users fires on_auth_user_created,
-- which seeds default op codes. Assertions about the source account therefore
-- check ITS OWN rows, not raw table counts.

\set ON_ERROR_STOP on
\set QUIET on


create or replace function chk(label text, cond boolean) returns void language plpgsql as $fn$
begin
  if cond then raise notice 'PASS  %', label; else raise warning 'FAIL  %', label; end if;
end $fn$;

-- ---- seed, as superuser ----
delete from auth.users where id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
insert into auth.users (id, instance_id, aud, role, email)
values ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','source@test'),
       ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','target@test');

-- SOURCE account holds the backup's ORIGINAL ids
insert into op_codes (id,user_id,code,description,flag_hours,sort_order,notes,tags)
  values ('aaaaaaaa-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','LOF','Oil change',0.3,0,'synthetic only','{Maintenance}');
insert into op_code_variants (id,op_code_id,user_id,code,description,flag_hours,sort_order)
  values ('aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','LOF-SYN','Full synthetic',0.4,0);
insert into entries (id,user_id,date,ro_number,vehicle_year,vehicle_make,vehicle_model,vehicle_vin,vehicle_mileage,notes)
  values ('aaaaaaaa-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','2026-01-15','39104','2016','Subaru','Outback','VINA','92000','front axle');
insert into entry_op_codes (id,entry_id,op_code_id,flag_hours,actual_hours,paid_hours,labor_type,position)
  values ('aaaaaaaa-0000-4000-8000-000000000021','aaaaaaaa-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000001',4,3.8,1,'customer_pay',0);

-- snapshot the source account so "untouched" is an invariant, not a guess
create temp table src_before as
  select (select count(*) from op_codes where user_id='11111111-1111-4111-8111-111111111111') oc,
         (select count(*) from entries where user_id='11111111-1111-4111-8111-111111111111') e,
         (select count(*) from entry_op_codes l join entries x on x.id=l.entry_id where x.user_id='11111111-1111-4111-8111-111111111111') l;

-- TARGET account is NOT empty — this is the data-loss case
insert into op_codes (id,user_id,code,description,flag_hours,sort_order)
  values (gen_random_uuid(),'22222222-2222-4222-8222-222222222222','PREEXISTING','do not lose me',1,0);
insert into entries (id,user_id,date,ro_number) values (gen_random_uuid(),'22222222-2222-4222-8222-222222222222','2026-07-01','99999');
insert into disputes (id,user_id,period_key,scope,status,claimed_hours)
  values (gen_random_uuid(),'22222222-2222-4222-8222-222222222222','2026-07-P1','period','generated',5);

-- CONTROL: the reported collision, reproduced
do $ctl$
begin
  insert into op_codes (id,user_id,code,description,flag_hours,sort_order)
    values ('aaaaaaaa-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','LOF','Oil change',0.3,0);
  perform chk('CONTROL old import collides on a shared DB', false);
exception when unique_violation then
  perform chk('CONTROL old import collides on a shared DB: ' || SQLERRM, true);
end $ctl$;

-- ---- everything below runs as the signed-in target user, under RLS ----
set request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';
set role authenticated;

-- ATOMICITY: a failing import must leave the target account untouched
do $atom$
declare bad jsonb;
begin
  bad := jsonb_set($json${"settings":{"split_day":20,"period_overrides":{"2026-08-P1":{"start":"2026-08-01","end":"2026-08-14"}}},"op_codes":[{"id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","code":"LOF","description":"Oil change","flag_hours":0.3,"sort_order":0,"created_at":"2026-01-01T00:00:00Z","notes":"synthetic only","tags":["Maintenance"]}],"op_code_variants":[{"id":"4d2fa648-47be-49a8-b9ba-e0b206b37edd","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","code":"LOF-SYN","description":"Full synthetic","flag_hours":0.4,"sort_order":0,"created_at":"2026-01-01T00:00:00Z"}],"entries":[{"id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","date":"2026-02-01","ro_number":"67229","vehicle_year":"2019","vehicle_make":"Nissan","vehicle_model":"Altima","vehicle_vin":"VINB","vehicle_mileage":"51000","flag_hours":0,"notes":"","comeback_of_entry_id":"9392a05d-e38d-437b-967e-b25899c93575","comeback_kind":"comeback_own","created_at":"2026-02-01T00:00:00Z","updated_at":"2026-02-01T00:00:00Z"},{"id":"9392a05d-e38d-437b-967e-b25899c93575","date":"2026-01-15","ro_number":"39104","vehicle_year":"2016","vehicle_make":"Subaru","vehicle_model":"Outback","vehicle_vin":"VINA","vehicle_mileage":"92000","flag_hours":4,"notes":"front axle","comeback_of_entry_id":null,"comeback_kind":null,"created_at":"2026-01-15T00:00:00Z","updated_at":"2026-01-15T00:00:00Z"}],"entry_op_codes":[{"id":"c4b3af77-7fb0-4712-800c-e20a102b6585","entry_id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","sub_op_code_id":null,"custom":false,"custom_code":null,"custom_description":null,"flag_hours":0,"actual_hours":0.9,"paid_hours":null,"is_comeback":true,"labor_type":"warranty","notes":"customer returned","position":0},{"id":"46974ec0-91a6-4e88-9c0d-897f116079e0","entry_id":"9392a05d-e38d-437b-967e-b25899c93575","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","sub_op_code_id":"4d2fa648-47be-49a8-b9ba-e0b206b37edd","custom":false,"custom_code":null,"custom_description":null,"flag_hours":4,"actual_hours":3.8,"paid_hours":1,"is_comeback":false,"labor_type":"customer_pay","notes":"torn boot","position":0}],"bonuses":[{"id":"a27c546a-cff8-4c93-8429-b4e48439569e","date":"2026-01-15","amount":25,"category":"spiff","source":"alignment spiff","note":null,"entry_id":"9392a05d-e38d-437b-967e-b25899c93575","created_at":"2026-01-15T00:00:00Z","updated_at":"2026-01-15T00:00:00Z"}],"daily_clock_hours":[{"date":"2026-01-15","hours":8}],"paid_period_hours":[{"period_key":"2026-01-P1","paid_flag_hours":18}],"labor_rates":[{"id":"f974a652-83b2-4e96-93bf-d090345e5bdf","labor_type":"customer_pay","hourly_rate":32,"created_at":"2026-08-05T12:00:00Z","updated_at":"2026-08-05T12:00:00Z"},{"id":"c17bcef4-3b29-401f-bef5-42abcab2c56b","labor_type":"warranty","hourly_rate":28,"created_at":"2026-08-05T12:00:00Z","updated_at":"2026-08-05T12:00:00Z"}],"disputes":[{"id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","period_key":"2026-01-P1","period_label":"Jan 1-15","scope":"lines","status":"resolved","claimed_hours":3,"claimed_dollars":96,"recovered_hours":3,"recovered_dollars":96,"generated_at":"2026-01-20T00:00:00Z","submitted_at":"2026-01-21T00:00:00Z","answered_at":"2026-01-22T00:00:00Z","resolved_at":"2026-01-23T00:00:00Z","note":"paid in full","created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"}],"dispute_lines":[{"id":"cfe804ef-b6f0-48f8-ada0-67740a836762","dispute_id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","entry_id":"9392a05d-e38d-437b-967e-b25899c93575","line_id":"46974ec0-91a6-4e88-9c0d-897f116079e0","ro_number":"39104","code":"CV-AXLE","description":"Front CV axle","work_date":"2026-01-15","flagged_hours":4,"paid_hours":1,"claimed_hours":3,"claimed_dollars":96,"recovered_hours":3,"recovered_dollars":96,"had_photo":false,"position":0,"created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"},{"id":"cf9926f4-2043-46cf-b0ba-41bd22d802a5","dispute_id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","entry_id":null,"line_id":null,"ro_number":"00000","code":"GONE","description":"RO since deleted","work_date":null,"flagged_hours":1,"paid_hours":null,"claimed_hours":1,"claimed_dollars":null,"recovered_hours":0,"recovered_dollars":null,"had_photo":false,"position":1,"created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"}],"unpaid_time":[{"id":"7847c308-a802-4402-9e50-6854f26e23f3","date":"2026-02-01","hours":0.9,"kind":"comeback_own","entry_id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","original_entry_id":"9392a05d-e38d-437b-967e-b25899c93575","source":"timer","note":"redo","created_at":"2026-02-01T00:00:00Z","updated_at":"2026-02-01T00:00:00Z"}]}$json$::jsonb,
                   '{entry_op_codes,0,labor_type}', '"not_a_labor_type"');
  perform import_replace_account(bad);
  perform chk('ATOMICITY poisoned import rejected', false);
exception when check_violation then
  perform chk('ATOMICITY poisoned import rejected: ' || SQLERRM, true);
end $atom$;

select chk('ATOMICITY target op code survived the failed import',
           (select count(*) from op_codes where code='PREEXISTING') = 1);
select chk('ATOMICITY target RO survived the failed import',
           (select count(*) from entries where ro_number='99999') = 1);

-- V1 RESTORE: no disputes/labor_rates key => those tables are left alone
do $v1$
declare v1 jsonb;
begin
  v1 := $json${"settings":{"split_day":20,"period_overrides":{"2026-08-P1":{"start":"2026-08-01","end":"2026-08-14"}}},"op_codes":[{"id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","code":"LOF","description":"Oil change","flag_hours":0.3,"sort_order":0,"created_at":"2026-01-01T00:00:00Z","notes":"synthetic only","tags":["Maintenance"]}],"op_code_variants":[{"id":"4d2fa648-47be-49a8-b9ba-e0b206b37edd","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","code":"LOF-SYN","description":"Full synthetic","flag_hours":0.4,"sort_order":0,"created_at":"2026-01-01T00:00:00Z"}],"entries":[{"id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","date":"2026-02-01","ro_number":"67229","vehicle_year":"2019","vehicle_make":"Nissan","vehicle_model":"Altima","vehicle_vin":"VINB","vehicle_mileage":"51000","flag_hours":0,"notes":"","comeback_of_entry_id":"9392a05d-e38d-437b-967e-b25899c93575","comeback_kind":"comeback_own","created_at":"2026-02-01T00:00:00Z","updated_at":"2026-02-01T00:00:00Z"},{"id":"9392a05d-e38d-437b-967e-b25899c93575","date":"2026-01-15","ro_number":"39104","vehicle_year":"2016","vehicle_make":"Subaru","vehicle_model":"Outback","vehicle_vin":"VINA","vehicle_mileage":"92000","flag_hours":4,"notes":"front axle","comeback_of_entry_id":null,"comeback_kind":null,"created_at":"2026-01-15T00:00:00Z","updated_at":"2026-01-15T00:00:00Z"}],"entry_op_codes":[{"id":"c4b3af77-7fb0-4712-800c-e20a102b6585","entry_id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","sub_op_code_id":null,"custom":false,"custom_code":null,"custom_description":null,"flag_hours":0,"actual_hours":0.9,"paid_hours":null,"is_comeback":true,"labor_type":"warranty","notes":"customer returned","position":0},{"id":"46974ec0-91a6-4e88-9c0d-897f116079e0","entry_id":"9392a05d-e38d-437b-967e-b25899c93575","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","sub_op_code_id":"4d2fa648-47be-49a8-b9ba-e0b206b37edd","custom":false,"custom_code":null,"custom_description":null,"flag_hours":4,"actual_hours":3.8,"paid_hours":1,"is_comeback":false,"labor_type":"customer_pay","notes":"torn boot","position":0}],"bonuses":[{"id":"a27c546a-cff8-4c93-8429-b4e48439569e","date":"2026-01-15","amount":25,"category":"spiff","source":"alignment spiff","note":null,"entry_id":"9392a05d-e38d-437b-967e-b25899c93575","created_at":"2026-01-15T00:00:00Z","updated_at":"2026-01-15T00:00:00Z"}],"daily_clock_hours":[{"date":"2026-01-15","hours":8}],"paid_period_hours":[{"period_key":"2026-01-P1","paid_flag_hours":18}],"labor_rates":[{"id":"f974a652-83b2-4e96-93bf-d090345e5bdf","labor_type":"customer_pay","hourly_rate":32,"created_at":"2026-08-05T12:00:00Z","updated_at":"2026-08-05T12:00:00Z"},{"id":"c17bcef4-3b29-401f-bef5-42abcab2c56b","labor_type":"warranty","hourly_rate":28,"created_at":"2026-08-05T12:00:00Z","updated_at":"2026-08-05T12:00:00Z"}],"disputes":[{"id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","period_key":"2026-01-P1","period_label":"Jan 1-15","scope":"lines","status":"resolved","claimed_hours":3,"claimed_dollars":96,"recovered_hours":3,"recovered_dollars":96,"generated_at":"2026-01-20T00:00:00Z","submitted_at":"2026-01-21T00:00:00Z","answered_at":"2026-01-22T00:00:00Z","resolved_at":"2026-01-23T00:00:00Z","note":"paid in full","created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"}],"dispute_lines":[{"id":"cfe804ef-b6f0-48f8-ada0-67740a836762","dispute_id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","entry_id":"9392a05d-e38d-437b-967e-b25899c93575","line_id":"46974ec0-91a6-4e88-9c0d-897f116079e0","ro_number":"39104","code":"CV-AXLE","description":"Front CV axle","work_date":"2026-01-15","flagged_hours":4,"paid_hours":1,"claimed_hours":3,"claimed_dollars":96,"recovered_hours":3,"recovered_dollars":96,"had_photo":false,"position":0,"created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"},{"id":"cf9926f4-2043-46cf-b0ba-41bd22d802a5","dispute_id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","entry_id":null,"line_id":null,"ro_number":"00000","code":"GONE","description":"RO since deleted","work_date":null,"flagged_hours":1,"paid_hours":null,"claimed_hours":1,"claimed_dollars":null,"recovered_hours":0,"recovered_dollars":null,"had_photo":false,"position":1,"created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"}],"unpaid_time":[{"id":"7847c308-a802-4402-9e50-6854f26e23f3","date":"2026-02-01","hours":0.9,"kind":"comeback_own","entry_id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","original_entry_id":"9392a05d-e38d-437b-967e-b25899c93575","source":"timer","note":"redo","created_at":"2026-02-01T00:00:00Z","updated_at":"2026-02-01T00:00:00Z"}]}$json$::jsonb - 'disputes' - 'dispute_lines' - 'unpaid_time' - 'labor_rates';
  perform import_replace_account(v1);
end $v1$;
select chk('V1 restore leaves the target dispute ledger alone', (select count(*) from disputes) = 1);
select chk('V1 restore imports no pay rates', (select count(*) from labor_rates) = 0);

-- SECURITY: a payload claiming the SOURCE user must still land on the caller
do $sec$
declare spoofed jsonb;
begin
  spoofed := jsonb_set($json${"settings":{"split_day":20,"period_overrides":{"2026-08-P1":{"start":"2026-08-01","end":"2026-08-14"}}},"op_codes":[{"id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","code":"LOF","description":"Oil change","flag_hours":0.3,"sort_order":0,"created_at":"2026-01-01T00:00:00Z","notes":"synthetic only","tags":["Maintenance"]}],"op_code_variants":[{"id":"4d2fa648-47be-49a8-b9ba-e0b206b37edd","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","code":"LOF-SYN","description":"Full synthetic","flag_hours":0.4,"sort_order":0,"created_at":"2026-01-01T00:00:00Z"}],"entries":[{"id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","date":"2026-02-01","ro_number":"67229","vehicle_year":"2019","vehicle_make":"Nissan","vehicle_model":"Altima","vehicle_vin":"VINB","vehicle_mileage":"51000","flag_hours":0,"notes":"","comeback_of_entry_id":"9392a05d-e38d-437b-967e-b25899c93575","comeback_kind":"comeback_own","created_at":"2026-02-01T00:00:00Z","updated_at":"2026-02-01T00:00:00Z"},{"id":"9392a05d-e38d-437b-967e-b25899c93575","date":"2026-01-15","ro_number":"39104","vehicle_year":"2016","vehicle_make":"Subaru","vehicle_model":"Outback","vehicle_vin":"VINA","vehicle_mileage":"92000","flag_hours":4,"notes":"front axle","comeback_of_entry_id":null,"comeback_kind":null,"created_at":"2026-01-15T00:00:00Z","updated_at":"2026-01-15T00:00:00Z"}],"entry_op_codes":[{"id":"c4b3af77-7fb0-4712-800c-e20a102b6585","entry_id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","sub_op_code_id":null,"custom":false,"custom_code":null,"custom_description":null,"flag_hours":0,"actual_hours":0.9,"paid_hours":null,"is_comeback":true,"labor_type":"warranty","notes":"customer returned","position":0},{"id":"46974ec0-91a6-4e88-9c0d-897f116079e0","entry_id":"9392a05d-e38d-437b-967e-b25899c93575","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","sub_op_code_id":"4d2fa648-47be-49a8-b9ba-e0b206b37edd","custom":false,"custom_code":null,"custom_description":null,"flag_hours":4,"actual_hours":3.8,"paid_hours":1,"is_comeback":false,"labor_type":"customer_pay","notes":"torn boot","position":0}],"bonuses":[{"id":"a27c546a-cff8-4c93-8429-b4e48439569e","date":"2026-01-15","amount":25,"category":"spiff","source":"alignment spiff","note":null,"entry_id":"9392a05d-e38d-437b-967e-b25899c93575","created_at":"2026-01-15T00:00:00Z","updated_at":"2026-01-15T00:00:00Z"}],"daily_clock_hours":[{"date":"2026-01-15","hours":8}],"paid_period_hours":[{"period_key":"2026-01-P1","paid_flag_hours":18}],"labor_rates":[{"id":"f974a652-83b2-4e96-93bf-d090345e5bdf","labor_type":"customer_pay","hourly_rate":32,"created_at":"2026-08-05T12:00:00Z","updated_at":"2026-08-05T12:00:00Z"},{"id":"c17bcef4-3b29-401f-bef5-42abcab2c56b","labor_type":"warranty","hourly_rate":28,"created_at":"2026-08-05T12:00:00Z","updated_at":"2026-08-05T12:00:00Z"}],"disputes":[{"id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","period_key":"2026-01-P1","period_label":"Jan 1-15","scope":"lines","status":"resolved","claimed_hours":3,"claimed_dollars":96,"recovered_hours":3,"recovered_dollars":96,"generated_at":"2026-01-20T00:00:00Z","submitted_at":"2026-01-21T00:00:00Z","answered_at":"2026-01-22T00:00:00Z","resolved_at":"2026-01-23T00:00:00Z","note":"paid in full","created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"}],"dispute_lines":[{"id":"cfe804ef-b6f0-48f8-ada0-67740a836762","dispute_id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","entry_id":"9392a05d-e38d-437b-967e-b25899c93575","line_id":"46974ec0-91a6-4e88-9c0d-897f116079e0","ro_number":"39104","code":"CV-AXLE","description":"Front CV axle","work_date":"2026-01-15","flagged_hours":4,"paid_hours":1,"claimed_hours":3,"claimed_dollars":96,"recovered_hours":3,"recovered_dollars":96,"had_photo":false,"position":0,"created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"},{"id":"cf9926f4-2043-46cf-b0ba-41bd22d802a5","dispute_id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","entry_id":null,"line_id":null,"ro_number":"00000","code":"GONE","description":"RO since deleted","work_date":null,"flagged_hours":1,"paid_hours":null,"claimed_hours":1,"claimed_dollars":null,"recovered_hours":0,"recovered_dollars":null,"had_photo":false,"position":1,"created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"}],"unpaid_time":[{"id":"7847c308-a802-4402-9e50-6854f26e23f3","date":"2026-02-01","hours":0.9,"kind":"comeback_own","entry_id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","original_entry_id":"9392a05d-e38d-437b-967e-b25899c93575","source":"timer","note":"redo","created_at":"2026-02-01T00:00:00Z","updated_at":"2026-02-01T00:00:00Z"}]}$json$::jsonb, '{entries,0,user_id}', '"11111111-1111-4111-8111-111111111111"');
  perform import_replace_account(spoofed);
end $sec$;
select chk('SECURITY spoofed user_id ignored, rows land on the caller',
           (select count(*) from entries where user_id='22222222-2222-4222-8222-222222222222') = 2);

-- THE REAL IMPORT
select import_replace_account($json${"settings":{"split_day":20,"period_overrides":{"2026-08-P1":{"start":"2026-08-01","end":"2026-08-14"}}},"op_codes":[{"id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","code":"LOF","description":"Oil change","flag_hours":0.3,"sort_order":0,"created_at":"2026-01-01T00:00:00Z","notes":"synthetic only","tags":["Maintenance"]}],"op_code_variants":[{"id":"4d2fa648-47be-49a8-b9ba-e0b206b37edd","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","code":"LOF-SYN","description":"Full synthetic","flag_hours":0.4,"sort_order":0,"created_at":"2026-01-01T00:00:00Z"}],"entries":[{"id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","date":"2026-02-01","ro_number":"67229","vehicle_year":"2019","vehicle_make":"Nissan","vehicle_model":"Altima","vehicle_vin":"VINB","vehicle_mileage":"51000","flag_hours":0,"notes":"","comeback_of_entry_id":"9392a05d-e38d-437b-967e-b25899c93575","comeback_kind":"comeback_own","created_at":"2026-02-01T00:00:00Z","updated_at":"2026-02-01T00:00:00Z"},{"id":"9392a05d-e38d-437b-967e-b25899c93575","date":"2026-01-15","ro_number":"39104","vehicle_year":"2016","vehicle_make":"Subaru","vehicle_model":"Outback","vehicle_vin":"VINA","vehicle_mileage":"92000","flag_hours":4,"notes":"front axle","comeback_of_entry_id":null,"comeback_kind":null,"created_at":"2026-01-15T00:00:00Z","updated_at":"2026-01-15T00:00:00Z"}],"entry_op_codes":[{"id":"c4b3af77-7fb0-4712-800c-e20a102b6585","entry_id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","sub_op_code_id":null,"custom":false,"custom_code":null,"custom_description":null,"flag_hours":0,"actual_hours":0.9,"paid_hours":null,"is_comeback":true,"labor_type":"warranty","notes":"customer returned","position":0},{"id":"46974ec0-91a6-4e88-9c0d-897f116079e0","entry_id":"9392a05d-e38d-437b-967e-b25899c93575","op_code_id":"2d02fddc-c469-45b3-b2a2-1a3542bc05a0","sub_op_code_id":"4d2fa648-47be-49a8-b9ba-e0b206b37edd","custom":false,"custom_code":null,"custom_description":null,"flag_hours":4,"actual_hours":3.8,"paid_hours":1,"is_comeback":false,"labor_type":"customer_pay","notes":"torn boot","position":0}],"bonuses":[{"id":"a27c546a-cff8-4c93-8429-b4e48439569e","date":"2026-01-15","amount":25,"category":"spiff","source":"alignment spiff","note":null,"entry_id":"9392a05d-e38d-437b-967e-b25899c93575","created_at":"2026-01-15T00:00:00Z","updated_at":"2026-01-15T00:00:00Z"}],"daily_clock_hours":[{"date":"2026-01-15","hours":8}],"paid_period_hours":[{"period_key":"2026-01-P1","paid_flag_hours":18}],"labor_rates":[{"id":"f974a652-83b2-4e96-93bf-d090345e5bdf","labor_type":"customer_pay","hourly_rate":32,"created_at":"2026-08-05T12:00:00Z","updated_at":"2026-08-05T12:00:00Z"},{"id":"c17bcef4-3b29-401f-bef5-42abcab2c56b","labor_type":"warranty","hourly_rate":28,"created_at":"2026-08-05T12:00:00Z","updated_at":"2026-08-05T12:00:00Z"}],"disputes":[{"id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","period_key":"2026-01-P1","period_label":"Jan 1-15","scope":"lines","status":"resolved","claimed_hours":3,"claimed_dollars":96,"recovered_hours":3,"recovered_dollars":96,"generated_at":"2026-01-20T00:00:00Z","submitted_at":"2026-01-21T00:00:00Z","answered_at":"2026-01-22T00:00:00Z","resolved_at":"2026-01-23T00:00:00Z","note":"paid in full","created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"}],"dispute_lines":[{"id":"cfe804ef-b6f0-48f8-ada0-67740a836762","dispute_id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","entry_id":"9392a05d-e38d-437b-967e-b25899c93575","line_id":"46974ec0-91a6-4e88-9c0d-897f116079e0","ro_number":"39104","code":"CV-AXLE","description":"Front CV axle","work_date":"2026-01-15","flagged_hours":4,"paid_hours":1,"claimed_hours":3,"claimed_dollars":96,"recovered_hours":3,"recovered_dollars":96,"had_photo":false,"position":0,"created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"},{"id":"cf9926f4-2043-46cf-b0ba-41bd22d802a5","dispute_id":"a235982d-76d8-4143-bfe9-7e0d280a53a9","entry_id":null,"line_id":null,"ro_number":"00000","code":"GONE","description":"RO since deleted","work_date":null,"flagged_hours":1,"paid_hours":null,"claimed_hours":1,"claimed_dollars":null,"recovered_hours":0,"recovered_dollars":null,"had_photo":false,"position":1,"created_at":"2026-01-20T00:00:00Z","updated_at":"2026-01-23T00:00:00Z"}],"unpaid_time":[{"id":"7847c308-a802-4402-9e50-6854f26e23f3","date":"2026-02-01","hours":0.9,"kind":"comeback_own","entry_id":"b3d79c3b-95ff-4f89-814a-2e75ed79d0e7","original_entry_id":"9392a05d-e38d-437b-967e-b25899c93575","source":"timer","note":"redo","created_at":"2026-02-01T00:00:00Z","updated_at":"2026-02-01T00:00:00Z"}]}$json$::jsonb);
reset role;
reset request.jwt.claims;

\echo
\echo '================= RESULTS ================='
select chk('IMPORT succeeded into a second account on the same database',
           (select count(*) from entries where user_id='22222222-2222-4222-8222-222222222222') = 2);
select chk('SOURCE account untouched (op codes, ROs, lines all unchanged)',
           (select oc from src_before) = (select count(*) from op_codes where user_id='11111111-1111-4111-8111-111111111111')
       and (select e  from src_before) = (select count(*) from entries where user_id='11111111-1111-4111-8111-111111111111')
       and (select l  from src_before) = (select count(*) from entry_op_codes l
                                            join entries x on x.id=l.entry_id where x.user_id='11111111-1111-4111-8111-111111111111'));
select chk('SOURCE account kept its own op code row verbatim',
           (select code||'/'||notes from op_codes where id='aaaaaaaa-0000-4000-8000-000000000001' and user_id='11111111-1111-4111-8111-111111111111') = 'LOF/synthetic only');
select chk('SOURCE account kept its reconciliation state',
           (select paid_hours from entry_op_codes where id='aaaaaaaa-0000-4000-8000-000000000021') = 1);
select chk('target pre-existing data replaced, not merged',
           (select count(*) from op_codes where user_id='22222222-2222-4222-8222-222222222222' and code='PREEXISTING') = 0);
select chk('v2 import DID replace the stale dispute',
           (select count(*) from disputes where user_id='22222222-2222-4222-8222-222222222222' and period_key='2026-07-P1') = 0);

select chk('paid_hours survived (reconciliation history)',
           (select l.paid_hours from entry_op_codes l join entries e on e.id=l.entry_id
             where e.user_id='22222222-2222-4222-8222-222222222222' and e.ro_number='39104') = 1);
select chk('is_comeback survived (unpaid rework)',
           (select l.is_comeback from entry_op_codes l join entries e on e.id=l.entry_id
             where e.user_id='22222222-2222-4222-8222-222222222222' and e.ro_number='67229') = true);
select chk('labor_type survived (prices every dollar figure)',
           (select l.labor_type from entry_op_codes l join entries e on e.id=l.entry_id
             where e.user_id='22222222-2222-4222-8222-222222222222' and e.ro_number='39104') = 'customer_pay');
select chk('line notes survived',
           (select l.notes from entry_op_codes l join entries e on e.id=l.entry_id
             where e.user_id='22222222-2222-4222-8222-222222222222' and e.ro_number='39104') = 'torn boot');
select chk('VIN + mileage survived',
           (select e.vehicle_vin||'/'||e.vehicle_mileage from entries e
             where e.user_id='22222222-2222-4222-8222-222222222222' and e.ro_number='39104') = 'VINA/92000');
select chk('op code notes + tags survived',
           (select o.notes||'/'||array_to_string(o.tags,',') from op_codes o where o.user_id='22222222-2222-4222-8222-222222222222') = 'synthetic only/Maintenance');
select chk('sub op code (variant) imported', (select count(*) from op_code_variants where user_id='22222222-2222-4222-8222-222222222222') = 1);
select chk('line re-pointed at the new variant id',
           (select v.code from entry_op_codes l join op_code_variants v on v.id=l.sub_op_code_id
             join entries e on e.id=l.entry_id where e.user_id='22222222-2222-4222-8222-222222222222') = 'LOF-SYN');
select chk('comeback_of_entry_id resolved (self-FK inside one INSERT)',
           (select o.ro_number from entries c join entries o on o.id=c.comeback_of_entry_id
             where c.user_id='22222222-2222-4222-8222-222222222222' and c.ro_number='67229') = '39104');
select chk('comeback_kind survived',
           (select e.comeback_kind from entries e where e.user_id='22222222-2222-4222-8222-222222222222' and e.ro_number='67229') = 'comeback_own');
select chk('entries.flag_hours recomputed by trigger',
           (select e.flag_hours from entries e where e.user_id='22222222-2222-4222-8222-222222222222' and e.ro_number='39104') = 4);
select chk('pay rates imported (no more $0 account)',
           (select count(*) from labor_rates where user_id='22222222-2222-4222-8222-222222222222') = 2);
select chk('dispute imported with figures intact',
           (select d.claimed_hours||'/'||d.recovered_dollars from disputes d where d.user_id='22222222-2222-4222-8222-222222222222') = '3.00/96.00');
select chk('dispute line re-pointed at the new RO',
           (select e.ro_number from dispute_lines dl join entries e on e.id=dl.entry_id
             where dl.user_id='22222222-2222-4222-8222-222222222222' and dl.code='CV-AXLE') = '39104');
select chk('frozen dispute line for a DELETED RO still imported, link nulled',
           (select count(*) from dispute_lines where user_id='22222222-2222-4222-8222-222222222222' and code='GONE' and entry_id is null) = 1);
select chk('unpaid time re-pointed at both ROs',
           (select o.ro_number from unpaid_time u join entries o on o.id=u.original_entry_id
             where u.user_id='22222222-2222-4222-8222-222222222222') = '39104');
select chk('bonus re-pointed at the new RO',
           (select e.ro_number from bonuses b join entries e on e.id=b.entry_id where b.user_id='22222222-2222-4222-8222-222222222222') = '39104');
select chk('settings applied', (select split_day from user_settings where user_id='22222222-2222-4222-8222-222222222222') = 20);
select chk('composite-keyed rows imported',
           (select count(*) from daily_clock_hours where user_id='22222222-2222-4222-8222-222222222222') = 1
       and (select count(*) from paid_period_hours where user_id='22222222-2222-4222-8222-222222222222') = 1);
