-- Request a Feature: the other half of the footer's "tell me" pair.
--
-- The About page makes a promise: "If it's in the app, it's because a tech
-- needed it." Report a Bug covers "it's broken". This covers "I wish it did X".
-- A signed-in user writes what they want; it lands in an admin-only inbox
-- (/admin/requests) where it gets a status and notes.
--
-- Deliberately smaller than bug_reports: no screenshots, no automation webhook.
-- A request is an idea to read, not a fault to reproduce, so the only context
-- captured is the page they were on and the build they were running.
--
-- Same two-layer protection as bug_reports: the /admin layout guards the UI,
-- RLS guards the data.

create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  description text not null,
  -- Silently captured: where they were when the idea hit, and which build.
  page_url text,
  app_build text,
  -- Admin-set. The requester never sees or sets these.
  status text not null default 'New'
    constraint feature_requests_status_valid
      check (status in ('New', 'Reviewing', 'Planned', 'In Progress', 'Shipped', 'Not Planned')),
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feature_requests_user_idx on public.feature_requests(user_id);
create index if not exists feature_requests_status_idx on public.feature_requests(status);

alter table public.feature_requests enable row level security;

-- Users insert their own requests and can read them back (the insert needs to
-- .select() the new row). The insert check also pins the admin-owned fields to
-- their starting state, so a requester can't file one pre-marked "Shipped".
drop policy if exists "insert_own_feature_requests" on public.feature_requests;
create policy "insert_own_feature_requests" on public.feature_requests
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'New' and admin_notes is null);

drop policy if exists "own_read_feature_requests" on public.feature_requests;
create policy "own_read_feature_requests" on public.feature_requests
  for select to authenticated
  using (user_id = auth.uid());

-- Admins read and update everything. is_admin can't be self-granted (see
-- 20260812010000_lock_is_admin.sql), which is what makes this policy safe.
drop policy if exists "admin_all_feature_requests" on public.feature_requests;
create policy "admin_all_feature_requests" on public.feature_requests
  for all to authenticated
  using (exists (select 1 from public.user_settings s
                 where s.user_id = auth.uid() and s.is_admin))
  with check (exists (select 1 from public.user_settings s
                      where s.user_id = auth.uid() and s.is_admin));

-- Prove the app can reach the new table (same check as 20260912000000's
-- ro_events: the revoked default privileges must not have taken the row verbs).
do $feature_requests_crud$
declare
  missing text;
begin
  select string_agg(v.verb, ', ')
    into missing
    from (values ('SELECT'), ('INSERT'), ('UPDATE')) as v(verb)
   where not has_table_privilege('authenticated', 'public.feature_requests'::regclass, v.verb);

  if missing is not null then
    raise exception
      'feature_requests: authenticated has no % on feature_requests. The default '
      'privileges did not carry over — grant them explicitly.', missing;
  end if;
end
$feature_requests_crud$;
