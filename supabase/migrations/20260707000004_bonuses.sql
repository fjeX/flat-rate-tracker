-- Spiff / Bonus ledger: the money that isn't flag hours.
-- Menu-sale spiffs, tire spiffs, alignment bonuses, monthly CSI bonuses, holiday
-- pay — date, amount, category/source, note, optional link to an RO. Rolled into
-- pay-period DOLLAR totals only; never into hours reconciliation (see docs/plans 05).
--
-- Spiffs are dollar-denominated natively, so this table needs no rates to be
-- useful — it works even for a user who has never priced a labor rate.

-- =========================================================================
-- bonuses — zero-or-more per user, filtered by date like entries
-- =========================================================================
create table public.bonuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  amount numeric(8,2) not null default 0,
  -- 4 fixed categories. Free-text `source` covers the long tail ("tire spiff",
  -- "CSI") so there's deliberately no category manager.
  category text not null check (
    category in ('spiff', 'bonus', 'holiday', 'other')
  ),
  source text,
  note text,
  -- Optional RO link. ON DELETE SET NULL: deleting an RO must NOT delete the
  -- spiff — the money was still paid; only the association goes away.
  entry_id uuid references public.entries on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Period queries filter by (user, date range) exactly like entries.
create index bonuses_user_date_idx on public.bonuses(user_id, date);

alter table public.bonuses enable row level security;
-- RLS mirrors op_codes / labor_rates: a user owns their own rows, full stop.
create policy "own_bonuses" on public.bonuses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
