-- Allow an explicit 'untyped' labor type on RO lines.
--
-- null  = implicitly untyped (predates the labor-type feature) — earnings
--         fall back to the customer_pay rate, unchanged.
-- 'untyped' = the user deliberately chose Untyped in the log form — the line
--         is unpriced and the UI shows no dollars for it.
--
-- Fixes the untyped-earnings-display escalation (2026-07-15): an explicitly
-- Untyped line was indistinguishable from a legacy null and silently priced
-- at the customer-pay rate.

alter table entry_op_codes
  drop constraint entry_op_codes_labor_type_check;

alter table entry_op_codes
  add constraint entry_op_codes_labor_type_check check (
    labor_type is null
    or labor_type in ('customer_pay', 'warranty', 'internal', 'used_car', 'other', 'untyped')
  );
