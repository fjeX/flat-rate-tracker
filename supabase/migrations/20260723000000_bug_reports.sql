-- Report a Bug: self-serve bug intake. A signed-in user describes an issue and
-- optionally attaches screenshots; the report lands in an admin-only inbox where
-- it gets triaged (severity / category / status) and worked into a fix.
--
-- Two-layer protection, same as the rest of FRT: the /admin route guards the UI,
-- and RLS here guards the data. A user can only ever see/insert their OWN reports;
-- only a user flagged is_admin can read every report.

-- =========================================================================
-- is_admin — one boolean on the existing per-user settings row.
-- No roles table: there's exactly one admin (Liem). Extensible later.
-- user_settings is auto-seeded per user by handle_new_user(), so every
-- account already has a row to flip.
-- =========================================================================
alter table public.user_settings
  add column if not exists is_admin boolean not null default false;

-- =========================================================================
-- bug_reports — the inbox. One row per submitted report.
-- =========================================================================
create table public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  description text not null,
  -- Silently auto-captured client context. The reporter never types these;
  -- they're what lets triage reproduce without a back-and-forth.
  page_url text,
  user_agent text,
  viewport text,
  app_build text,
  -- Triage fields — set by the admin (or the instant-triage automation), never
  -- by the reporter. Three clean axes instead of one muddled tag list.
  severity text,   -- Critical | High | Low
  category text,   -- Visual | Functional | Data | Performance
  status text not null default 'New',
    -- New → Triaged → Verify → Investigating → Fix Proposed → Resolved | Won't Fix | Needs Info
  triage_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bug_reports_user_idx on public.bug_reports(user_id);
create index bug_reports_status_idx on public.bug_reports(status);

alter table public.bug_reports enable row level security;

-- Users insert their own reports and can read them back (needed so the insert
-- can .select() the new id, and sets up a future "my reports" view / fix notice).
create policy "insert_own_bug_reports" on public.bug_reports
  for insert to authenticated
  with check (user_id = auth.uid());
create policy "own_read_bug_reports" on public.bug_reports
  for select to authenticated
  using (user_id = auth.uid());
-- Admins can read and triage everything.
create policy "admin_all_bug_reports" on public.bug_reports
  for all to authenticated
  using (exists (select 1 from public.user_settings s
                 where s.user_id = auth.uid() and s.is_admin))
  with check (exists (select 1 from public.user_settings s
                      where s.user_id = auth.uid() and s.is_admin));

-- =========================================================================
-- bug_report_photos — zero-to-three screenshots per report.
-- Mirrors entry_photos exactly (storage path {user_id}/{report_id}/{uuid}.jpg).
-- =========================================================================
create table public.bug_report_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  report_id uuid not null references public.bug_reports on delete cascade,
  storage_path text not null,
  byte_size int not null default 0,
  created_at timestamptz not null default now()
);
create index bug_report_photos_report_idx on public.bug_report_photos(report_id);

alter table public.bug_report_photos enable row level security;

create policy "insert_own_bug_report_photos" on public.bug_report_photos
  for insert to authenticated
  with check (user_id = auth.uid());
create policy "own_read_bug_report_photos" on public.bug_report_photos
  for select to authenticated
  using (user_id = auth.uid());
create policy "admin_all_bug_report_photos" on public.bug_report_photos
  for all to authenticated
  using (exists (select 1 from public.user_settings s
                 where s.user_id = auth.uid() and s.is_admin))
  with check (exists (select 1 from public.user_settings s
                      where s.user_id = auth.uid() and s.is_admin));

-- =========================================================================
-- bug-photos storage bucket — private, 5 MB ceiling, images only.
-- Client downscales before upload; 5 MB is a hard backstop, not the target.
-- =========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bug-photos',
  'bug-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Users can only touch files in their own folder (first path segment = user_id).
create policy "own_bug_photos"
  on storage.objects
  for all
  using (bucket_id = 'bug-photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'bug-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- Admins can read every screenshot (needed to view another user's attachment in
-- the inbox — the per-folder policy above would otherwise block cross-user reads).
create policy "admin_read_bug_photos"
  on storage.objects
  for select
  using (bucket_id = 'bug-photos'
    and exists (select 1 from public.user_settings s
                where s.user_id = auth.uid() and s.is_admin));
