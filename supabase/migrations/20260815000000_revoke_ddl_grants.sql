-- Take TRUNCATE, REFERENCES and TRIGGER away from anon and authenticated.
--
-- WHY TRUNCATE IS THE ONE THAT MATTERS
-- Every other table privilege these roles hold is filtered by RLS: a SELECT,
-- INSERT, UPDATE or DELETE can only ever touch rows the policy admits.
-- TRUNCATE is not. It is not row-scoped at all — Postgres does not consult
-- policies for it — so the grant is a hole of a different kind from everything
-- the 2026-08-14 audit checked. Verified on prod during that audit:
--
--   SET ROLE authenticated;  TRUNCATE public.client_errors;   -- TRUNCATE TABLE
--
-- succeeded, on a table whose RLS is airtight for every other verb.
--
-- WHY THIS IS HARDENING AND NOT AN INCIDENT
-- Nothing can reach it today. PostgREST only ever emits SELECT/INSERT/UPDATE/
-- DELETE, so there is no request shape that produces a TRUNCATE, and both roles
-- are NOLOGIN — they are only reachable through PostgREST's SET ROLE. Getting
-- to this privilege needs a direct Postgres connection, which needs credentials,
-- which is already a full compromise. This closes it anyway because the revoke
-- costs nothing and the reasoning above is exactly the kind that stops being
-- true quietly: the pooler already publishes 5432 on 0.0.0.0.
--
-- REFERENCES and TRIGGER go too. Neither is reachable either (both are DDL, and
-- neither role has CREATE on the schema), and PostgREST never needs them — a
-- REST client needs exactly the four row verbs. TRIGGER is the more interesting
-- of the pair: it would let a caller attach an existing SECURITY DEFINER
-- function to a table as a trigger, which is a privilege-escalation shape worth
-- removing on principle rather than arguing about reachability.
--
-- THE DEFAULT PRIVILEGES ARE THE ACTUAL FIX
-- Supabase ships `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated`, which is where the `D` in `arwdDxt` comes from. Revoking on
-- today's tables alone would be undone by the next migration that adds one, so
-- the default is changed as well. Only the `postgres` grantor is adjusted:
-- migrations are applied as `postgres` (docker exec psql -U postgres), so every
-- table this project will ever create inherits from that one. The parallel
-- `supabase_admin` default cannot be altered from here ("must be member of role
-- supabase_admin") and is left alone — it governs platform-owned tables, not
-- ours.

-- 1. Existing tables.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- 2. Future tables created by postgres — i.e. every future migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

-- 3. Prove it. A silent no-op here would look identical to success, and the
--    whole point of the migration is a privilege NOT being present.
DO $revoke_check$
DECLARE
  leftovers text;
BEGIN
  SELECT string_agg(DISTINCT table_name || '.' || privilege_type || '→' || grantee, ', ')
    INTO leftovers
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER');

  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION
      'revoke_ddl_grants: these DDL-adjacent grants survived the revoke: %. '
      'The REVOKE above did not cover them — check for a table owned by a role '
      'other than postgres.', leftovers;
  END IF;
END
$revoke_check$;

-- 4. And prove the app still has what it actually needs, so a future widening
--    of the REVOKE list cannot quietly break every write in production.
--
--    has_any_column_privilege, NOT has_table_privilege, for the three verbs
--    that can be granted per column. user_settings deliberately has NO
--    table-level INSERT or UPDATE — 20260812010000_lock_is_admin.sql revoked
--    them and handed back a named column list instead, so that is_admin cannot
--    be written. A table-level check reads that correct state as a missing
--    privilege; this check caught exactly that on the first dry run. DELETE has
--    no column-level form, so it stays a table check.
--    The OID goes to has_*_privilege directly rather than a formatted name.
--    Building 'public.' || tablename and letting Postgres resolve it looks
--    equivalent and is not: the planner is free to evaluate the privilege call
--    BEFORE the schemaname filter, so it resolved 'public.schema_migrations'
--    for a row that only exists in the auth and realtime schemas and blew up
--    with "relation does not exist". An OID from the catalog join is always a
--    real relation no matter what order the predicates run in.
DO $crud_check$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname || '.' || v.verb, ', ')
    INTO missing
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) AS v(verb)
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     -- Deliberately grant-less; see 20260806000000_migration_ledger.sql.
     AND c.relname <> 'applied_migrations'
     AND NOT has_any_column_privilege('authenticated', c.oid, v.verb);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'revoke_ddl_grants: authenticated LOST a privilege the app needs: %.', missing;
  END IF;

  SELECT string_agg(c.relname || '.DELETE', ', ')
    INTO missing
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname <> 'applied_migrations'
     AND NOT has_table_privilege('authenticated', c.oid, 'DELETE');

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'revoke_ddl_grants: authenticated LOST DELETE the app needs: %.', missing;
  END IF;
END
$crud_check$;
