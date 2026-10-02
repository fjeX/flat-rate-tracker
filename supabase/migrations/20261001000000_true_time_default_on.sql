-- True Time: contribute by default for NEW accounts (decision 2026-10-01).
--
-- 20260729010000_true_time_collection.sql shipped share_labor_times as opt-in
-- (default false). Liem flipped that: the pool only becomes useful once it has
-- contributors, and every safeguard that made opt-in defensible is unchanged —
-- the rollup table carries no identity, the k-anonymity floor of 5 is enforced
-- in both the refresh function and the read policy, and turning the switch OFF
-- still purges the user's raw observations (setShareLaborTimesAction).
--
-- Scope is deliberately NEW ROWS ONLY. A column default applies to inserts, and
-- the signup trigger (handle_new_user) inserts with defaults, so every account
-- created after this migration starts ON. Existing rows are NOT touched: an
-- account that was created under opt-in and never flipped the switch keeps its
-- false, because silently changing a consent answer someone already has is a
-- different act from choosing the default for someone who hasn't answered yet.
--
-- No GRANT changes: the column already exists and already has its UPDATE grant
-- (see 20260812010000_lock_is_admin.sql). Additive and idempotent.
alter table public.user_settings
  alter column share_labor_times set default true;

comment on column public.user_settings.share_labor_times is
  'Contribute anonymized flag-vs-actual observations to True Time. '
  'Default true for accounts created on/after 2026-10-01 (was false before). '
  'Turning it off stops future aggregation of this user''s rows and purges their observations.';
