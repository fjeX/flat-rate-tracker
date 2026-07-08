-- Per-user reference hourly rate for the Pay Check-Up on the pay-period page.
--
-- This is a number the USER enters (e.g. their local minimum wage) to compare
-- their effective hourly pay against. It is deliberately NOT seeded with any
-- statutory figure: minimum wage changes yearly and varies by city vs. county vs.
-- state, so hardcoding a legal number would go stale and mislead. NULL = unset,
-- and the comparison row simply doesn't render until the user fills it in.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS reference_hourly_rate numeric(6,2) NULL;
