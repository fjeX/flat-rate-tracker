-- Add freeform tags to the op code library so techs can group repairs
-- (e.g. "Brakes", "Warranty", "Quick") and filter/sort by them.
-- Stored as a text array — a simple list per op code, no separate table needed.
alter table public.op_codes
  add column tags text[] not null default '{}';

-- GIN index so "show me everything tagged X" stays fast as the library grows.
create index op_codes_tags_idx on public.op_codes using gin (tags);
