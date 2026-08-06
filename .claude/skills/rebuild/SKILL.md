---
name: rebuild
description: "Rebuild and redeploy the Flat Rate Tracker Docker container after a git pull. Use when Liem says 'rebuild', '/rebuild', 'deploy latest', or 'push the new changes to the app'."
---

# Rebuild — FRT Docker Redeploy

Pull the latest code and rebuild the Docker image so new changes go live on `tracker.slimelab.cc`.

Run the following steps using the Bash tool from this directory (`~/docker/flat-rate-tracker`).

## Steps

1. **Pull latest code**
   ```bash
   git pull origin master
   ```
   - "Already up to date" is fine — still rebuild, the Docker image may be stale

2. **Apply pending migrations — always invoke the migrate skill**

   Invoke the **migrate skill** unconditionally, on every rebuild. Do not gate it
   behind a git check, and do not apply migrations by hand or via the Supabase SQL
   editor — the skill records what it applied in `public.applied_migrations`, and a
   migration applied outside it leaves no row, so it looks pending forever.

   This step used to gate on `git log ORIG_HEAD..HEAD -- supabase/migrations/`. That
   asks "what arrived in the last pull", not "what is pending against the database".
   On 2026-08-06 a migration that had landed in an *earlier* pull was still unapplied,
   the check came back empty, and the container was about to come up calling a
   function the database did not have. A migration missed once stayed invisible
   forever, because each new pull moved `ORIG_HEAD` past it.

   The migrate skill detects pending work itself and is a no-op when there is none,
   so calling it every time costs one query.

   **Migrations always complete before the rebuild in step 3** — the new image
   expects the new schema. If migrate reports a failure, stop; do not rebuild.

3. **Rebuild and redeploy** — always run this, even if git said "Already up to date"
   ```bash
   docker compose down && docker compose build && docker compose up -d
   ```

4. **Verify**
   ```bash
   docker compose ps
   ```
   - `app` service should show `Up`
   - If it shows `Exit` or `Restarting`: `docker compose logs --tail=50`
