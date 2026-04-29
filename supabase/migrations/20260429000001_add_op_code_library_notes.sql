-- Add a notes field to the op code library so techs can attach reminders,
-- part numbers, or procedure notes to a saved op code.
alter table public.op_codes
  add column notes text not null default '';
