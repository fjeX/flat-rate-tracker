-- Add vehicle mileage to repair orders and per-line notes to op code entries.
alter table public.entries
  add column vehicle_mileage text not null default '';

alter table public.entry_op_codes
  add column notes text not null default '';
