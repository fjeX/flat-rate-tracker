-- Add per-user pay period goal hours.
-- Default 88 matches the previously hardcoded constant.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS goal_hours integer NOT NULL DEFAULT 88;
