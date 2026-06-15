-- RO numbers are not unique. Shops recycle 5-digit RO numbers over time, so the
-- same number legitimately points to different repair orders months/years apart.
-- The entry's identity is its uuid `id` (and op code lines reference entries by
-- that id) — RO number is just a searchable attribute. Drop the false uniqueness
-- guard so repeat RO numbers can be logged as separate entries.
drop index if exists public.entries_user_ro_unique;
