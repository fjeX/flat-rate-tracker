-- Add ro_template column to user_settings.
-- Stores the template image storage path + region coordinates as JSON.
alter table public.user_settings
  add column if not exists ro_template jsonb;

-- Private bucket for RO template images (10 MB max per file).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ro-templates',
  'ro-templates',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- RLS: users can only access files in their own folder (first path segment = user_id).
create policy "own_ro_template_images"
  on storage.objects
  for all
  using (bucket_id = 'ro-templates' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'ro-templates' and auth.uid()::text = (storage.foldername(name))[1]);
