---
name: migrate
description: "Apply pending Supabase database migrations for the Flat Rate Tracker. VM-only, run from ~/docker/flat-rate-tracker — NEVER run during local dev on the PC or laptop, because local dev points at prod Supabase (api.slimelab.cc). Invoked unconditionally by the rebuild skill on every rebuild; also use when Liem says 'run the migrations' or 'apply the migration' while on the VM."
---

# Migrate — Apply Pending FRT Database Migrations

Apply every migration file that the database has not recorded yet. Uses `docker exec` directly — no Supabase SQL editor needed.

Run the following steps using the Bash tool from `~/docker/flat-rate-tracker`.

## What "pending" means — read this before changing anything

Pending is **files on disk that have no row in `public.applied_migrations`**. It is a comparison against database state, not against git.

This skill used to ask git instead:

```bash
git diff --name-only ORIG_HEAD HEAD -- supabase/migrations/   # DO NOT REINTRODUCE
```

That answers *"what arrived in the last pull"*, which is a different question. On 2026-08-06 the two diverged: `20260805000000_import_replace_account.sql` had landed in an **earlier** pull and was never applied, so the next rebuild's `ORIG_HEAD` diff was empty and the skill reported nothing to do — while the app was about to start calling a function the database did not have. Any migration missed once became permanently invisible, because every later pull moved `ORIG_HEAD` past it.

**Never gate this skill on a git diff, and never let the caller gate it either.** Running it when nothing is pending is nearly free (one query) and safe.

## Steps

1. **List pending migrations**

   ```bash
   docker exec supabase-db psql -U postgres -d postgres -tAc \
     "select filename from public.applied_migrations order by filename;" > /tmp/applied.txt
   ls supabase/migrations/*.sql | xargs -n1 basename | sort > /tmp/ondisk.txt
   comm -23 /tmp/ondisk.txt <(sort /tmp/applied.txt)
   ```

   - **Empty output** → nothing pending; stop here and report "no pending migrations"
   - **Filenames** → apply each in the order printed (filename order = timestamp order = dependency order)
   - **`relation "public.applied_migrations" does not exist`** → the ledger itself is the pending migration. Apply `supabase/migrations/20260806000000_migration_ledger.sql` first using step 2, then re-run step 1. Its seed marks the pre-ledger history as applied, so this self-heals exactly once.

2. **Apply each pending migration**

   For each filename from step 1, oldest first, one at a time:

   ```bash
   docker cp supabase/migrations/<file> supabase-db:/tmp/current_migration.sql
   docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/current_migration.sql
   ```

   `ON_ERROR_STOP=1` matters: without it psql reports failure but keeps executing the rest of the file, which half-applies a migration and still exits 0.

3. **Record it — only after it succeeded**

   ```bash
   docker exec supabase-db psql -U postgres -d postgres -c \
     "insert into public.applied_migrations (filename) values ('<file>') on conflict do nothing;"
   ```

   Record immediately after each file, not in a batch at the end. If file 3 of 5 fails, files 1–2 must stay recorded as applied so the retry does not re-run them.

   **Never record a migration you did not actually run.** A false row here is worse than no ledger at all — it makes a missing object permanently invisible, which is the exact failure this ledger exists to prevent.

4. **Verify**

   ```bash
   # nothing left pending
   comm -23 /tmp/ondisk.txt <(docker exec supabase-db psql -U postgres -d postgres -tAc \
     "select filename from public.applied_migrations order by filename;" | sort)
   ```

   Then confirm the objects actually exist — the ledger records intent, the catalog is the truth:

   ```bash
   docker exec supabase-db psql -U postgres -d postgres -c "\dt public.*"      # new tables
   docker exec supabase-db psql -U postgres -d postgres -c "\d public.<table>" # new columns
   docker exec supabase-db psql -U postgres -d postgres -c "\df public.<fn>"   # new functions
   ```

5. **Check the generated types still describe the database — always, even when nothing was pending**

   ```bash
   docker exec supabase-db psql -U postgres -d postgres -tAc \
     "select table_name||chr(46)||column_name from information_schema.columns \
      where table_schema=chr(112)||chr(117)||chr(98)||chr(108)||chr(105)||chr(99) order by 1;" \
     | node scripts/check-types-fresh.mjs
   ```

   (`chr(...)` spells `public` and `.` without quotes, which do not survive the
   nested quoting when this runs over ssh.)

   **Exit 0** → types match the catalog, continue.
   **Exit 1** → report it and treat the deploy as suspect. Do **not** fix it here:
   `database.types.ts` is source, and source changes belong on a dev machine.

   Why this is part of migrating rather than a nice-to-have: backup/import
   coverage is enforced by a mapped type over `database.types.ts`
   (`src/lib/backup-manifest.ts`), so a new column cannot compile until someone
   declares whether a backup carries it. That guard is only as current as the
   generated file. Skip the regen and the types still describe yesterday's
   schema — the check stays exhaustive over a schema that no longer exists, and
   a new column silently drops out of every backup while everything stays green.
   Six tables and eight `user_settings` columns went missing exactly that way.

## Report back

State which migrations were applied (or that none were pending), the verification
result, and the type-freshness result. If nothing was pending, say so explicitly —
silence reads like the check was skipped.

## If a migration fails

- Read the psql error — it names the failing statement
- **Do not insert a ledger row.** It stays pending, which is correct
- Fix the underlying issue and re-run; do not skip past it to later migrations
- If it partially applied, clean up manually before retrying — most FRT migrations use `if not exists` / `create or replace` and are safely re-runnable, but confirm rather than assume
