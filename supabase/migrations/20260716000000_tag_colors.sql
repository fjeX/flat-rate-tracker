-- Per-tag colour overrides for the op code library.
-- Keyed by LOWERCASED tag; value = hue slot index (0-7) into the --tag-hue-N
-- theme tokens (globals.css). Tags without an entry keep their deterministic
-- hash colour (tagHue.ts), so this is purely additive.
alter table public.user_settings
  add column tag_colors jsonb not null default '{}'::jsonb;
