-- Atomic, id-remapping account import.
--
-- Import used to run as a loose sequence of PostgREST calls — delete the user's
-- rows, then insert the backup's. Three defects fell out of that shape:
--
-- 1) IT COULD NEVER SUCCEED ACROSS ACCOUNTS. The inserts reused the backup's
--    ORIGINAL primary keys, but op_codes.id / entries.id / entry_op_codes.id /
--    bonuses.id are database-wide, not per-user. The delete was scoped
--    `user_id = <importer>`, so on a shared database the SOURCE account's rows
--    still held those ids and the insert died on 23505 (op_codes_pkey). Fresh
--    ids are now minted before the call and every internal reference re-pointed
--    at them — see src/lib/import-remap.ts.
--
-- 2) A FAILED IMPORT DESTROYED THE TARGET ACCOUNT. The deletes and inserts were
--    separate statements with no transaction, so the wipe committed and the
--    restore did not. Anyone importing into an account that already held ROs
--    lost them with no rollback. A plpgsql function body runs inside a single
--    implicit transaction: every exception below takes the deletes back with it.
--
-- 3) IT IMPORTED ONLY A FRACTION OF WHAT THE BACKUP HELD. paid_hours (the whole
--    reconciliation history), is_comeback (the unpaid-rework feature),
--    labor_type (which rate prices the line), line notes, sub op codes, VIN and
--    mileage were all present in the JSON and silently dropped on the way in.
--    The payload now carries every column of every table it writes.
--
-- REPLACE ONLY WHAT THE BACKUP DESCRIBES
-- A table is cleared only when the payload carries its key. A version-1 backup
-- has no `disputes` / `unpaid_time` / `labor_rates` key, so restoring one leaves
-- those records alone rather than deleting history the file never contained.
-- active_timers is the exception — see below.
--
-- SECURITY INVOKER (the default) keeps every statement under RLS, and user_id is
-- stamped from auth.uid() instead of read from the payload, so a crafted request
-- cannot write into another account.

CREATE OR REPLACE FUNCTION import_replace_account(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  data jsonb;
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

  -- Bonuses before entries: the entry_id FK is ON DELETE SET NULL, so dropping
  -- entries first would keep the bonus rows with the link nulled instead of
  -- removing them.
  DELETE FROM bonuses WHERE user_id = uid;
  -- Cascades entry_op_codes, entry_photos and labor_time_observations. The photo
  -- BINARIES in storage are purged by the caller only after this transaction
  -- commits, so a rollback leaves both the rows and the files intact.
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
  INSERT INTO entry_op_codes
  SELECT * FROM jsonb_populate_recordset(null::entry_op_codes, data->'entry_op_codes');

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

  -- Upsert, not update: a brand-new account being imported into may have no
  -- settings row yet, and the import must not depend on one existing.
  INSERT INTO user_settings (user_id, split_day, period_overrides)
  VALUES (
    uid,
    coalesce((data->'settings'->>'split_day')::int, 15),
    coalesce(data->'settings'->'period_overrides', '{}'::jsonb)
  )
  ON CONFLICT (user_id) DO UPDATE
    SET split_day = EXCLUDED.split_day,
        period_overrides = EXCLUDED.period_overrides,
        updated_at = now();
END;
$$;

-- Functions are executable by PUBLIC by default; this one replaces an entire
-- account, so narrow it to signed-in callers explicitly.
REVOKE ALL ON FUNCTION import_replace_account(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION import_replace_account(jsonb) TO authenticated;
