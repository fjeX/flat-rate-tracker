# Incident Log

Append-only. Document production incidents, root causes, and fixes here.

---

## 2026-05-06 — Production app down: Server Components render error on all RO pages

### What was broken

The production app at `tracker.slimelab.cc` was throwing a generic Next.js Server Components render error on every page load that fetches repair order data. In production builds Next.js redacts the actual error message, but the container logs revealed the real cause:

```
PGRST204: Could not find the 'vehicle_vin' column of 'entries' in the schema cache
```

This is a PostgREST error — not a Next.js error. PostgREST is the REST API layer that Supabase sits in front of Postgres. When the app's server-side code queried for entries, PostgREST looked up `vehicle_vin` in its schema cache, didn't find it in the database, and returned a hard error. That propagated up through the Supabase JS client and crashed the Next.js Server Component render.

---

### Why it happened

The self-hosted Supabase database was 3 migrations behind the app code running in the Docker container:

| Migration | Should be applied | Was applied |
|---|---|---|
| `20260422005715_initial_schema.sql` | ✅ | ✅ |
| `20260424000000_add_vehicle_vin.sql` | ✅ | ❌ |
| `20260425000000_ro_template.sql` | ✅ | ❌ |
| `20260429000000_add_mileage_and_op_code_notes.sql` | ✅ | ❌ |
| `20260429000001_add_op_code_library_notes.sql` | ✅ | ❌ |

The self-hosted Supabase instance was set up manually via Docker Compose, not via `supabase db push`. That means migrations don't apply automatically — every migration file added after initial setup must be run manually against the production database. All four migrations written after April 22 had never been executed.

`vehicle_vin` was the immediate crash cause because the app explicitly passes it in INSERT payloads and reads it back in the mapper (`row.vehicle_vin`). Without it in the DB, every read and write involving entries failed.

---

### What was fixed and in what order

**First pass** (before confirming the error was still happening): Applied migrations `20260429000000` and `20260429000001` — added `vehicle_mileage` on `entries`, `notes` on `entry_op_codes`, and `notes` on `op_codes`. Those went in successfully but the error persisted because `vehicle_vin` was still missing.

**Root cause diagnosis:** Checked container logs (`docker logs frt`) and found the PGRST204 error. Queried `information_schema.columns` directly on the Postgres container and confirmed `vehicle_vin` was absent from `entries`. Listing migration files showed two more (`add_vehicle_vin`, `ro_template`) that existed in the repo but had never been applied.

**Second pass (the actual fix):** Applied both missing migrations via `docker exec supabase-db psql`:
- `ALTER TABLE entries ADD COLUMN vehicle_vin text NOT NULL DEFAULT ''`
- `ALTER TABLE user_settings ADD COLUMN ro_template jsonb`
- Created the `ro-templates` storage bucket with its RLS policy (also part of the `ro_template` migration)

Supabase automatically fires `NOTIFY pgrst, 'reload schema'` when the schema changes, so PostgREST refreshed its cache within seconds — visible in the PostgREST logs. No app rebuild or container restart was required.

---

### Process gap

The self-hosted setup has no CI step running `supabase db push` on deploy. Every migration written on a dev machine must be manually applied to production. Four migrations accumulated without being applied because the rebuild runbook step (documented in `.claude/skills/rebuild/SKILL.md` step 3) was skipped.

**Going forward:** Never close a rebuild without verifying the DB matches the migration files. See the deploy checklist note added to the rebuild skill.
