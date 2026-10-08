-- recompute_entry_flag_hours runs as its OWNER, so deleting a user works.
--
-- THE BUG (found 2026-10-07 seeding the staging project; same on prod):
-- Deleting any user who has RO lines failed with
--   ERROR: permission denied for table entries (SQLSTATE 42501)
-- GoTrue deletes users as `supabase_auth_admin`. The delete cascades
-- auth.users → entries → entry_op_codes, and the AFTER DELETE trigger on
-- entry_op_codes fires this function. It was SECURITY INVOKER, so it ran as
-- supabase_auth_admin — which has no grant on public.entries — and its UPDATE
-- aborted the whole delete. The FK cascades themselves run as the table owner;
-- the trigger function is what ran as the caller.
--
-- Nothing user-facing broke (the app has no delete-account action yet), but it
-- blocked deleting any account from Studio or the admin API — account deletion
-- for the launch, and cleaning up tester accounts.
--
-- WHY SECURITY DEFINER IS SAFE HERE
-- The function only ever sets entries.flag_hours = sum of that entry's own lines,
-- for the entry the triggering line belongs to. It returns nothing to the caller.
-- Which lines a user can touch is still decided by the own_entry_op_codes policy
-- (USING and WITH CHECK both require the parent entry be theirs), so the only
-- entries it can recompute for a signed-in user are their own — the same set as
-- before, with the same result. The one real difference: its UPDATE on entries
-- now runs as the owner and skips the own_entries policy; it stays confined to
-- the parent of the line RLS already allowed. (Reviewed by frt-postgres-guard
-- 2026-10-07: cross-user UPDATE of entry_id is rejected by WITH CHECK.)
--
-- search_path = '' (every name below is schema-qualified; pg_catalog is always
-- searched) also clears the advisor's "function search path mutable" warning.
--
-- EXECUTE is revoked from the API roles: it's a trigger function, only ever
-- invoked by the trigger (trigger firing does not check EXECUTE), and as a
-- SECURITY DEFINER function it should not be exposed under /rest/v1/rpc.
--
-- Body unchanged. Idempotent (create or replace + revoke). Safe to deploy the app
-- before or after it.

create or replace function public.recompute_entry_flag_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry_id uuid;
begin
  target_entry_id := coalesce(new.entry_id, old.entry_id);
  update public.entries
    set flag_hours = coalesce((
      select sum(flag_hours) from public.entry_op_codes where entry_id = target_entry_id
    ), 0),
    updated_at = now()
    where id = target_entry_id;
  return null;
end;
$$;

revoke execute on function public.recompute_entry_flag_hours() from public, anon, authenticated;
