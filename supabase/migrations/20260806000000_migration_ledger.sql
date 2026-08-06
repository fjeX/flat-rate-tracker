-- Records which migration files have been applied to THIS database.
--
-- WHY THIS EXISTS
-- Migrations are applied by hand (docker exec psql), and the migrate skill used
-- to decide what was pending with `git diff ORIG_HEAD HEAD -- supabase/migrations/`.
-- That answers "what arrived in the LAST pull", not "what is pending against the
-- database". On 2026-08-06 the two diverged: 20260805000000_import_replace_account.sql
-- landed in an earlier pull, was never applied, and the next rebuild's ORIG_HEAD
-- diff came back empty — so the skill reported nothing to do while the app was
-- about to start calling a function the database did not have. Comparing against
-- a moving git reference cannot detect a migration that was missed earlier.
--
-- With this table the question becomes stateful and exact: pending = files on
-- disk that have no row here. A missed migration stays pending until it is
-- actually applied, no matter how many pulls happen in between.

create table if not exists public.applied_migrations (
  filename    text primary key,
  applied_at  timestamptz not null default now()
);

comment on table public.applied_migrations is
  'One row per applied file in supabase/migrations/. Maintained by the migrate skill; see 20260806000000_migration_ledger.sql for why.';

-- Not user data: no RLS, no grants. Only the postgres superuser (which is what
-- `docker exec supabase-db psql -U postgres` connects as) ever touches it, and
-- the app itself has no reason to read it.
revoke all on public.applied_migrations from public, anon, authenticated;

-- Seed every migration that exists as of this file.
--
-- Correct in both situations, which is why it needs no guard:
--   - Established DB (prod today): all 27 below are already applied — this
--     records the historical fact so they are not re-run.
--   - Fresh DB: migrations run oldest-first, so by the time this file executes
--     all 27 have just been applied. Same claim, equally true.
--
-- This list is a point-in-time snapshot, not a living mirror of the directory.
-- It is never edited again — every later migration inserts its own row via the
-- migrate skill. Do not add new filenames here.
insert into public.applied_migrations (filename) values
  ('20260422005715_initial_schema.sql'),
  ('20260424000000_add_vehicle_vin.sql'),
  ('20260425000000_ro_template.sql'),
  ('20260429000000_add_mileage_and_op_code_notes.sql'),
  ('20260429000001_add_op_code_library_notes.sql'),
  ('20260603000000_sub_op_codes.sql'),
  ('20260610000000_goal_hours.sql'),
  ('20260610000001_reorder_op_codes_rpc.sql'),
  ('20260613000000_add_op_code_tags.sql'),
  ('20260615000000_drop_ro_unique.sql'),
  ('20260707000000_client_errors.sql'),
  ('20260707000001_labor_rates.sql'),
  ('20260707000002_line_paid_hours.sql'),
  ('20260707000003_entry_photos.sql'),
  ('20260707000004_bonuses.sql'),
  ('20260707000005_reference_rate.sql'),
  ('20260714000000_gamification.sql'),
  ('20260715000000_work_schedules.sql'),
  ('20260715120000_untyped_labor_type.sql'),
  ('20260716000000_tag_colors.sql'),
  ('20260717000000_throttle_client_errors.sql'),
  ('20260723000000_bug_reports.sql'),
  ('20260724000000_active_timers_and_unpaid_time.sql'),
  ('20260727000000_comeback_marking.sql'),
  ('20260729000000_dispute_ledger.sql'),
  ('20260729010000_true_time_collection.sql'),
  ('20260730000000_true_time_plain_unique_line.sql'),
  ('20260805000000_import_replace_account.sql'),
  ('20260806000000_migration_ledger.sql')
on conflict (filename) do nothing;
