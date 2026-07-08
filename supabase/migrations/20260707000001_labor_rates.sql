-- Pay rates keyed by labor type, plus a labor type on each RO line.
-- Adds the first dollar figures to the schema (see docs/plans 02).
--
-- V1 stores only the CURRENT rate per type. Historical accuracy — the rate that
-- was in effect on the day an RO was flagged — would need an `effective_from`
-- column (one row per rate change, resolve by date). Deliberately NOT built yet;
-- raises are rare enough that current-rate-only is acceptable for v1.

-- =========================================================================
-- labor_rates — one optional rate per (user, labor_type)
-- =========================================================================
create table public.labor_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  labor_type text not null check (
    labor_type in ('customer_pay', 'warranty', 'internal', 'used_car', 'other')
  ),
  hourly_rate numeric(6,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, labor_type)
);
create index labor_rates_user_idx on public.labor_rates(user_id);

alter table public.labor_rates enable row level security;
-- RLS mirrors op_codes: a user owns their own rows, full stop.
create policy "own_labor_rates" on public.labor_rates
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- entry_op_codes.labor_type — the pay category for a single RO line
-- =========================================================================
-- Nullable on purpose: lines logged before this feature have no type and render
-- as "untyped". Earnings for an untyped line fall back to the customer_pay rate.
alter table public.entry_op_codes
  add column labor_type text check (
    labor_type is null
    or labor_type in ('customer_pay', 'warranty', 'internal', 'used_car', 'other')
  );

-- =========================================================================
-- user_settings.default_labor_type — seeds the per-line selector
-- =========================================================================
-- Most techs' lines are all one type, so a per-user default keeps logging fast.
alter table public.user_settings
  add column default_labor_type text check (
    default_labor_type is null
    or default_labor_type in ('customer_pay', 'warranty', 'internal', 'used_car', 'other')
  );
