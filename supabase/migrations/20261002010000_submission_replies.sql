-- Closing the loop on Report a Bug / Request a Feature.
--
-- The admin can reply to whoever sent a report or request. The reply shows up
-- for that user as a notice in the middle of the screen the next time they open
-- the app ("your bug got fixed", "your idea is in the app", or a plain note),
-- and stays until they dismiss it. Most submissions will never get a reply; the
-- ones that do should land.
--
-- Two pieces:
--   1. submission_replies — one row per reply, addressed to the submitter.
--   2. admin_submitter_profiles() — lets an admin see WHO sent a submission.
--      Names and emails live in auth.users, which no app role can read, so this
--      is a SECURITY DEFINER function that refuses anyone who isn't is_admin.

-- =========================================================================
-- submission_replies
-- =========================================================================
create table if not exists public.submission_replies (
  id uuid primary key default gen_random_uuid(),
  -- The recipient: always the submitter of the linked row (enforced by the
  -- insert policy below, so a reply can't be misaddressed to someone else).
  user_id uuid not null references auth.users on delete cascade,
  bug_report_id uuid references public.bug_reports on delete cascade,
  feature_request_id uuid references public.feature_requests on delete cascade,
  -- fixed   = bug resolved, thank-you
  -- shipped = feature request built
  -- note    = anything else
  kind text not null
    constraint submission_replies_kind_valid check (kind in ('fixed', 'shipped', 'note')),
  message text not null
    constraint submission_replies_message_len check (char_length(message) between 1 and 4000),
  created_at timestamptz not null default now(),
  -- Set by the recipient when they dismiss the notice. Null = still showing.
  seen_at timestamptz,
  constraint submission_replies_one_source check (
    (bug_report_id is not null)::int + (feature_request_id is not null)::int = 1
  )
);
create index if not exists submission_replies_unseen_idx
  on public.submission_replies(user_id) where seen_at is null;
create index if not exists submission_replies_bug_idx on public.submission_replies(bug_report_id);
create index if not exists submission_replies_feature_idx on public.submission_replies(feature_request_id);

alter table public.submission_replies enable row level security;

-- Admins write replies, and only to the person who actually sent the linked
-- submission.
drop policy if exists "admin_insert_submission_replies" on public.submission_replies;
create policy "admin_insert_submission_replies" on public.submission_replies
  for insert to authenticated
  with check (
    exists (select 1 from public.user_settings s
            where s.user_id = auth.uid() and s.is_admin)
    and (
      exists (select 1 from public.bug_reports b
              where b.id = bug_report_id and b.user_id = submission_replies.user_id)
      or exists (select 1 from public.feature_requests f
                 where f.id = feature_request_id and f.user_id = submission_replies.user_id)
    )
  );

-- Recipients read their own; admins read all (to show sent/seen in the inbox).
drop policy if exists "read_submission_replies" on public.submission_replies;
create policy "read_submission_replies" on public.submission_replies
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.user_settings s
               where s.user_id = auth.uid() and s.is_admin)
  );

-- Recipients may update their own rows — and the grant below narrows that to
-- the seen_at column alone, so "dismiss" is the only edit there is.
drop policy if exists "own_update_submission_replies" on public.submission_replies;
create policy "own_update_submission_replies" on public.submission_replies
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No delete policy: replies are history.

-- Column lock (same bargain as 20260812010000_lock_is_admin.sql): RLS picks
-- WHICH rows; the grant picks WHICH columns. Without this a recipient could
-- rewrite the message they were sent.
revoke update on public.submission_replies from authenticated;
revoke update on public.submission_replies from anon;
revoke insert, delete on public.submission_replies from anon;
grant update (seen_at) on public.submission_replies to authenticated;

do $submission_replies_crud$
declare
  missing text;
begin
  select string_agg(v.verb, ', ')
    into missing
    from (values ('SELECT'), ('INSERT')) as v(verb)
   where not has_table_privilege('authenticated', 'public.submission_replies'::regclass, v.verb);
  if missing is not null then
    raise exception 'submission_replies: authenticated has no % — grant it explicitly.', missing;
  end if;
  if not has_column_privilege('authenticated', 'public.submission_replies'::regclass, 'seen_at', 'UPDATE') then
    raise exception 'submission_replies: authenticated cannot update seen_at.';
  end if;
  if has_column_privilege('authenticated', 'public.submission_replies'::regclass, 'message', 'UPDATE') then
    raise exception 'submission_replies: authenticated can still update message — the column lock did not take.';
  end if;
end
$submission_replies_crud$;

-- =========================================================================
-- admin_submitter_profiles(user_ids) — who sent these?
-- =========================================================================
-- SECURITY DEFINER so it can read auth.users; the is_admin check is the whole
-- gate, so it raises (not returns empty) for anyone else. search_path pinned
-- against hijacking, as with refresh_labor_time_aggregates().
create or replace function public.admin_submitter_profiles(p_user_ids uuid[])
returns table (user_id uuid, email text, first_name text, last_name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.user_settings s
                 where s.user_id = auth.uid() and s.is_admin) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select u.id,
           u.email::text,
           nullif(u.raw_user_meta_data ->> 'first_name', ''),
           nullif(u.raw_user_meta_data ->> 'last_name', '')
      from auth.users u
     where u.id = any(p_user_ids);
end;
$$;

revoke all on function public.admin_submitter_profiles(uuid[]) from public;
revoke all on function public.admin_submitter_profiles(uuid[]) from anon;
grant execute on function public.admin_submitter_profiles(uuid[]) to authenticated;
