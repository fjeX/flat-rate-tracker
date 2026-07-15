-- Gamification Phase 1: work-day streak, career odometer milestones, portfolio
-- snapshots (docs/gamification.md). Three small tables; streak itself is always
-- derived from entries at read time and needs no table.
--
-- Written idempotent (if not exists / drop-then-create policies) because this
-- migration may be applied ahead of the code deploy and re-run by the normal
-- post-pull migrate flow.

-- =========================================================================
-- days_off — explicit "don't expect me to log" ranges (vacation, injury).
-- The streak treats these dates as frozen, never broken.
-- =========================================================================
create table if not exists public.days_off (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists days_off_user_idx on public.days_off(user_id, start_date);

alter table public.days_off enable row level security;
drop policy if exists "own_days_off" on public.days_off;
create policy "own_days_off" on public.days_off
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- career_milestones — earned-once markers (100/500/1000/5000/10000 lifetime
-- flag hours). Never deleted by RO edits: once crossed, it stays crossed,
-- even if a later correction drops the derived total back under the line.
-- =========================================================================
create table if not exists public.career_milestones (
  user_id uuid not null references auth.users on delete cascade,
  threshold int not null,
  achieved_at timestamptz not null default now(),
  primary key (user_id, threshold)
);

alter table public.career_milestones enable row level security;
drop policy if exists "own_career_milestones" on public.career_milestones;
create policy "own_career_milestones" on public.career_milestones
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- portfolio_snapshots — immutable, dated records generated when the lifetime
-- RO count crosses a threshold (10, 25, 50, 100, then every 100). stats jsonb
-- is frozen at generation time — that's the product: a dated record, never
-- regenerated, never revoked by later deletions.
-- =========================================================================
create table if not exists public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  seq int not null,            -- 1, 2, 3, … display number
  ro_threshold int not null,   -- the RO-count line this snapshot marks
  stats jsonb not null,        -- frozen SnapshotStats (see src/lib/snapshots.ts)
  created_at timestamptz not null default now(),
  unique (user_id, seq),
  unique (user_id, ro_threshold)
);
create index if not exists portfolio_snapshots_user_idx
  on public.portfolio_snapshots(user_id, seq desc);

alter table public.portfolio_snapshots enable row level security;
drop policy if exists "own_portfolio_snapshots" on public.portfolio_snapshots;
create policy "own_portfolio_snapshots" on public.portfolio_snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
