-- Per-line pay reconciliation: the flag hours the shop ACTUALLY paid for a job.
--
-- Nullable on purpose: null = "not yet reconciled". Status (pending/paid/short/
-- over) is DERIVED from (flag_hours, paid_hours) in src/lib/reconcile.ts, never
-- stored — so a rate change or an edit can never leave a stale status behind.
--
-- Dollars are computed from the user's per-labor-type rates (labor_rates table,
-- added in 20260707000001) via src/lib/earnings.ts — there is intentionally NO
-- single hourly_rate column here (that approach was superseded by per-type rates).
alter table public.entry_op_codes
  add column if not exists paid_hours numeric(5,2);
