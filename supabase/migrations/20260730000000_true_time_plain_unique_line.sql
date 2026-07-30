-- Fix: the one-observation-per-line index must be a PLAIN unique index, not a
-- partial one.
--
-- 20260729010000 created it as `unique (line_id) where line_id is not null`,
-- reasoning that a NULL line_id shouldn't occupy the unique slot. That reasoning
-- was unnecessary — Postgres already permits unlimited NULLs in a plain UNIQUE
-- index — and it broke the write path outright:
--
--   INSERT ... ON CONFLICT (line_id) DO UPDATE
--   ERROR: there is no unique or exclusion constraint matching the ON CONFLICT
--          specification
--
-- ON CONFLICT can only infer a PARTIAL index when the statement carries a
-- matching WHERE clause, which PostgREST's upsert does not emit. The insert
-- therefore failed for every observation, and because the sync path swallows
-- errors by design (an observation must never fail a tech's RO save), it failed
-- completely silently — zero rows written, no error surfaced anywhere.
--
-- Caught by live end-to-end verification, not by unit tests: the bug lived
-- entirely in the interaction between the index definition and the client's
-- generated SQL, which no pure-function test can see.
--
-- Safe to run against the deployed table: it is empty at this point, and the
-- rewrite is a straight index swap either way.

drop index if exists public.labor_time_obs_line_idx;

create unique index if not exists labor_time_obs_line_idx
  on public.labor_time_observations(line_id);
