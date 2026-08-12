-- import_replace_account v3 — carry the Schedule and Career tables, and every
-- user_settings column.
--
-- WHAT WAS MISSING
-- The v2 function replaced twelve tables and exactly two settings columns. Six
-- whole tables (work_schedules, days_off, work_shift_overrides,
-- confirmed_zero_days, portfolio_snapshots, career_milestones) and six
-- user_settings columns were in no backup at all, so "move my account to a new
-- one" silently left them behind. work_schedules is the worst of them: it is the
-- denominator the efficiency engine divides by, so an account restored without
-- it doesn't show blanks — it shows DIFFERENT numbers, which is the failure a
-- tech is least likely to catch.
--
-- src/lib/backup-manifest.ts is the written record of what travels and why, and
-- it fails `tsc` when a migration adds a table or column that nobody has ruled
-- on. This function is the other end of that contract.
--
-- THE THREE RULES THIS FILE ADDS
--
-- 1. A MISSING SETTINGS KEY MEANS "KEEP THE DESTINATION'S VALUE".
--    v2 wrote `coalesce(payload_value, <default>)`, so restoring a file that
--    predates a column reset that column to its default on the account being
--    restored into — trading one silent loss for another. Restoring a v1 backup
--    would have knocked a user's goal hours back to 88 and blanked their tag
--    colours. Each column is now applied only if the payload actually names it.
--
--    Absent and null are deliberately different. For a NULLABLE column an
--    explicit null is a real value ("this account has no reference rate") and is
--    written through. For a NOT NULL column a null can only be corruption, so it
--    is treated as absent rather than aborting the whole import.
--
-- 2. is_admin IS NEVER READ FROM THE PAYLOAD.
--    A backup is a JSON file the user can open in a text editor. It is not
--    filtered out of the payload — it is simply never named in the SET list
--    below, so no shape of input can reach the column. That is structural, not a
--    check someone can forget to keep in sync.
--
-- 3. NO 'settings' KEY MEANS user_settings IS NOT TOUCHED AT ALL.
--    v2 ran its upsert unconditionally, so a payload with no settings object
--    wrote split_day = 15 over whatever the account had.
--
-- Everything v2 established still holds: SECURITY INVOKER keeps every statement
-- under RLS, user_id is stamped from auth.uid() rather than read from the file,
-- the whole body is one implicit transaction so a failure takes the deletes back
-- with it, and a table is cleared ONLY when the payload carries its key.

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
