-- Flat Rate Tracker — initial schema
-- Tables: user_settings, op_codes, entries, entry_op_codes, daily_clock_hours, paid_period_hours
-- All tables have RLS enabled with user_id = auth.uid()
-- A trigger seeds user_settings + default op codes on signup

-- =========================================================================
-- user_settings
-- =========================================================================
create table public.user_settings (
  user_id uuid primary key references auth.users on delete cascade,
  split_day int not null default 15 check (split_day between 1 and 30),
  period_overrides jsonb not null default '{}'::jsonb,
  timer_ro_id uuid,
  timer_start_time bigint,
  timer_accumulated bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
create policy "own_settings" on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- op_codes (library)
-- =========================================================================
create table public.op_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  code text not null,
  description text not null default '',
  flag_hours numeric(5,2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index op_codes_user_sort_idx on public.op_codes(user_id, sort_order);

alter table public.op_codes enable row level security;
create policy "own_op_codes" on public.op_codes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- entries (repair orders)
-- =========================================================================
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  ro_number text not null,
  vehicle_year text not null default '',
  vehicle_make text not null default '',
  vehicle_model text not null default '',
  flag_hours numeric(6,2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index entries_user_ro_unique on public.entries(user_id, lower(ro_number));
create index entries_user_date_idx on public.entries(user_id, date desc);

alter table public.entries enable row level security;
create policy "own_entries" on public.entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- entry_op_codes (lines on each RO)
-- =========================================================================
create table public.entry_op_codes (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries on delete cascade,
  op_code_id uuid references public.op_codes on delete set null,
  custom boolean not null default false,
  custom_code text,
  custom_description text,
  flag_hours numeric(5,2) not null default 0,
  actual_hours numeric(5,2),
  position int not null default 0
);
create index entry_op_codes_entry_idx on public.entry_op_codes(entry_id);

alter table public.entry_op_codes enable row level security;
create policy "own_entry_op_codes" on public.entry_op_codes
  for all
  using (
    exists (
      select 1 from public.entries e
      where e.id = entry_op_codes.entry_id and e.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.entries e
      where e.id = entry_op_codes.entry_id and e.user_id = auth.uid()
    )
  );

-- =========================================================================
-- daily_clock_hours
-- =========================================================================
create table public.daily_clock_hours (
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  hours numeric(4,2) not null default 0,
  primary key (user_id, date)
);

alter table public.daily_clock_hours enable row level security;
create policy "own_daily_clock_hours" on public.daily_clock_hours
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- paid_period_hours
-- =========================================================================
create table public.paid_period_hours (
  user_id uuid not null references auth.users on delete cascade,
  period_key text not null,
  paid_flag_hours numeric(6,2) not null default 0,
  primary key (user_id, period_key)
);

alter table public.paid_period_hours enable row level security;
create policy "own_paid_period_hours" on public.paid_period_hours
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- New user trigger — seed user_settings + default op codes
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_settings (user_id) values (new.id);

  insert into public.op_codes (user_id, code, description, flag_hours, sort_order) values
    (new.id, 'LOF',   'Lube, Oil, Filter',              0.3, 0),
    (new.id, 'TR4',   'Tire Rotation - 4 Wheel',        0.3, 1),
    (new.id, 'BRK-F', 'Front Brake Pads & Rotors',      1.5, 2),
    (new.id, 'BRK-R', 'Rear Brake Pads & Rotors',       1.3, 3),
    (new.id, 'BATT',  'Battery Replacement',            0.5, 4),
    (new.id, 'ALIGN', '4-Wheel Alignment',              1.0, 5);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- Keep entries.flag_hours in sync with sum(entry_op_codes.flag_hours)
-- =========================================================================
create or replace function public.recompute_entry_flag_hours()
returns trigger
language plpgsql
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

create trigger entry_op_codes_recompute_aiud
  after insert or update or delete on public.entry_op_codes
  for each row execute function public.recompute_entry_flag_hours();
