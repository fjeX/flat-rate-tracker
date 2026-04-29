-- Add vehicle mileage to entries and per-line notes to entry_op_codes
alter table public.entries add column vehicle_mileage text not null default '';
alter table public.entry_op_codes add column notes text not null default '';
