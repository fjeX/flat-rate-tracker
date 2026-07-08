-- Evidence Locker: photographic records attached to repair-order entries.
-- A stored photo + contemporaneous log entry is the tech's proof against a
-- service writer changing flagged hours or reclassifying lines after the fact.
-- (See docs/plans 03.)

-- =========================================================================
-- entry_photos — zero-or-more photos per entry (RO front + back, etc.)
-- =========================================================================
create table public.entry_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  entry_id uuid not null references public.entries on delete cascade,
  storage_path text not null,
  -- captured_at is the integrity anchor: set server-side to now() and NEVER
  -- editable. It's what "Photographed <date> · <time>" renders from.
  captured_at timestamptz not null default now(),
  byte_size int not null default 0,
  created_at timestamptz not null default now()
);
create index entry_photos_entry_idx on public.entry_photos(entry_id);
create index entry_photos_user_idx on public.entry_photos(user_id);

alter table public.entry_photos enable row level security;
-- RLS mirrors op_codes / labor_rates: a user owns their own rows, full stop.
create policy "own_entry_photos" on public.entry_photos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- ro-photos storage bucket — private, per-user-folder RLS
-- =========================================================================
-- Mirrors the ro-templates bucket policy exactly (see 20260425000000_ro_template.sql).
-- 2 MB per-file ceiling: uploads are downscaled client-side to a ~1.5 MB target,
-- so this is a hard backstop, not the expected size.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ro-photos',
  'ro-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- RLS: users can only access files in their own folder (first path segment = user_id).
-- Paths are {user_id}/{entry_id}/{uuid}.jpg, so foldername(name)[1] is the user id.
create policy "own_ro_photos"
  on storage.objects
  for all
  using (bucket_id = 'ro-photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'ro-photos' and auth.uid()::text = (storage.foldername(name))[1]);
