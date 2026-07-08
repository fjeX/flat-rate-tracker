-- client_errors — minimal error reporting sink for a solo homelab app.
--
-- Rows land here from two places (see src/lib/report-error.ts and
-- src/lib/report-error-server.ts):
--   * React error boundaries (app/error.tsx, app/(app)/error.tsx)
--   * previously-silent server catch blocks (op-code seeding, etc.)
--
-- It is insert-only for authenticated users. There is deliberately NO select
-- policy: the app never reads its own errors. Read them out-of-band on the VM:
--   docker exec supabase-db psql -U postgres -d postgres \
--     -c "select created_at, url, message from public.client_errors order by created_at desc limit 50;"
-- (psql via the service role bypasses RLS.)
--
-- RETENTION: this table has no automatic cleanup. Run a monthly prune so a
-- render-loop bug or a noisy month can't grow it without bound:
--   delete from public.client_errors where created_at < now() - interval '90 days';
-- Client-side dedupe (max 1 identical report/min) keeps the write rate sane, but
-- the 90-day prune is the backstop.

create table public.client_errors (
  id uuid primary key default gen_random_uuid(),
  -- Nullable on purpose: a crash can happen before/around auth, and the FK is
  -- set null (not cascade) so a user deletion keeps the historical error rows.
  user_id uuid references auth.users on delete set null,
  message text not null,
  stack_hash text,
  url text,
  created_at timestamptz not null default now()
);
create index client_errors_created_idx on public.client_errors(created_at desc);

alter table public.client_errors enable row level security;

-- Insert-only for authenticated users. A row must either be attributed to the
-- inserting user or be left anonymous (user_id null) — never spoofed to another
-- user's id. No update/delete/select policies: pruning happens via service role.
create policy "insert_own_client_errors" on public.client_errors
  for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);
