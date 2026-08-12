-- Stop a signed-in user from granting themselves admin.
--
-- THE HOLE
-- user_settings' only policy is:
--   create policy "own_settings" on public.user_settings
--     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
--
-- "for all" means the whole ROW, and there were no column-level grants, so every
-- column was writable by its owner — including is_admin, added 2026-07-23 for the
-- bug-report inbox. One PostgREST call was enough:
--
--   PATCH /rest/v1/user_settings?user_id=eq.<self>   {"is_admin": true}
--
-- and that account could then read and write every user's bug_reports and
-- bug_report_photos (their policies test `s.is_admin` on the caller's own
-- settings row). Reproduced against a clone of the production schema on
-- 2026-08-12: the UPDATE returned `UPDATE 1` under the `authenticated` role.
--
-- RLS was never the wrong tool here — the policy is about WHICH ROW you may
-- touch. Which COLUMNS of your own row you may touch is a grant, and nobody had
-- written one, so the table-level default (all of them) applied.
--
-- WHY INSERT IS RESTRICTED TOO, NOT JUST UPDATE
-- The policy is `for all`, so a user can DELETE their own settings row. Locking
-- UPDATE alone would leave DELETE-then-INSERT as an identical bypass. INSERT is
-- therefore narrowed to user_id, which is all import_replace_account() needs for
-- its ensure-the-row-exists step (it runs SECURITY INVOKER, as the caller).
--
-- WHAT THIS COSTS: THIS LIST FAILS CLOSED
-- A column added to user_settings later inherits NO privilege from a table whose
-- table-level UPDATE has been revoked, so the app cannot write it until someone
-- adds it to the GRANT below — a permission error in production, not a silent
-- one. That is deliberate and it is the same bargain src/lib/backup-manifest.ts
-- makes: a new column has to be ruled on rather than sliding in by default. Both
-- lists are named in that file's user_settings comment so the next person finds
-- them together.
--
-- service_role and the table owner are untouched — admins are still provisioned
-- by hand, and nothing in the app writes is_admin at all (it is read in exactly
-- one place, isCurrentUserAdmin()).

-- Drop the blanket table-level privileges these roles inherited from Supabase's
-- default grants. SELECT is left alone: reading your own is_admin is how the UI
-- knows whether to show the inbox, and RLS still confines it to your own row.
REVOKE INSERT, UPDATE ON public.user_settings FROM authenticated;
REVOKE INSERT, UPDATE ON public.user_settings FROM anon;

-- The ensure-row insert in import_replace_account(). Every other column takes
-- its declared default, which is the correct starting state for a fresh account
-- and — critically — means is_admin starts false and cannot be set at insert.
GRANT INSERT (user_id) ON public.user_settings TO authenticated;

-- Exactly the columns src/lib/db/settings.ts writes in updateSettings(), plus
-- the two the import RPC sets. is_admin is absent, and user_id is absent because
-- nothing has ever needed to move a settings row to another account.
GRANT UPDATE (
  split_day,
  period_overrides,
  goal_hours,
  tag_colors,
  reference_hourly_rate,
  ro_template,
  default_labor_type,
  share_labor_times,
  updated_at
) ON public.user_settings TO authenticated;

-- Fail loudly at migrate time if user_settings has grown a column that nobody
-- has ruled on. Without this the migration would apply cleanly and the app would
-- start throwing "permission denied for column …" in production instead.
DO $$
DECLARE
  ungranted text[];
BEGIN
  SELECT array_agg(c.column_name ORDER BY c.column_name) INTO ungranted
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'user_settings'
     AND c.column_name NOT IN ('user_id', 'is_admin')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.column_privileges p
        WHERE p.table_schema = 'public'
          AND p.table_name = 'user_settings'
          AND p.column_name = c.column_name
          AND p.grantee = 'authenticated'
          AND p.privilege_type = 'UPDATE');

  IF ungranted IS NOT NULL THEN
    RAISE EXCEPTION
      'lock_is_admin: user_settings column(s) % have no UPDATE grant for authenticated. '
      'Decide whether the app should be able to write them: add them to the GRANT '
      'UPDATE list in this migration, or leave them out deliberately and add them to '
      'the exclusion list in this check.', ungranted;
  END IF;
END $$;
