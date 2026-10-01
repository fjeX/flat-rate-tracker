-- Appearance: per-account theme + accent (FRT visual overhaul, phase 3).
--
-- Until now the theme lived only in localStorage, so a tech who picked a look
-- on the shop PC got the default again on the phone. These two columns make the
-- account the source of truth; the browser copy stays as a paint-before-hydrate
-- cache that the head script reads (src/lib/theme.ts).
--
-- The CHECK lists must match THEMES / ACCENTS in src/lib/theme.ts. The app
-- parses with parseTheme/parseAccent so an unknown value reads as the default
-- rather than crashing, but the constraint keeps a bad value out of the row.
--
-- Defaults are the app's own defaults ('dark' / 'blue'), so every existing row
-- backfills to the look nobody has changed yet. Additive and idempotent: safe
-- to deploy the app before or after it (getSettings degrades on a missing
-- column; saveAppearance returns { error } until the column exists).
alter table public.user_settings
  add column if not exists theme text not null default 'dark'
    check (theme in ('light','dark','dark-graphite','dark-pitch')),
  add column if not exists accent text not null default 'blue'
    check (accent in ('blue','orange','teal','red','ink'));

-- REQUIRED — see 20260812010000_lock_is_admin.sql. user_settings has no
-- table-level UPDATE for `authenticated`, only a per-column list, and a column
-- added later inherits nothing. Without this, saveAppearance fails in
-- production with "permission denied for column theme".
grant update (theme, accent) on public.user_settings to authenticated;

-- Re-run the lock_is_admin tripwire: that check ran once when THAT migration
-- was applied and cannot see columns added since.
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
      'appearance: user_settings column(s) % have no UPDATE grant for '
      'authenticated. Add them to a GRANT UPDATE, or exclude them deliberately '
      'like is_admin.', ungranted;
  end if;
end
$grant_check$;
