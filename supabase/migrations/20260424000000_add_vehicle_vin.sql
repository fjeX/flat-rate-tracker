-- Add VIN field to repair order entries.
alter table public.entries
  add column vehicle_vin text not null default '';
