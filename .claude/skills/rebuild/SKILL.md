---
name: rebuild
description: "Rebuild and redeploy the Flat Rate Tracker Docker container after a git pull, gated by a write-smoke against the live site with automatic rollback. Use when Liem says 'rebuild', '/rebuild', 'deploy latest', or 'push the new changes to the app'."
---

# Rebuild — FRT Docker Redeploy

Pull the latest code, apply migrations, then hand the deploy to `scripts/deploy.sh`,
which builds, deploys, smoke-tests the live site, and **rolls back automatically if
the smoke fails**.

Run from `~/docker/flat-rate-tracker`.

## Steps

1. **Pull latest code**
   ```bash
   git pull origin master
   ```
   - "Already up to date" is fine — still deploy, the Docker image may be stale

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

   **Migrations always complete before the deploy in step 3** — the new image
   expects the new schema. If migrate reports a failure, stop; do not deploy.

3. **Deploy — one command, and it is not optional**
   ```bash
   ./scripts/deploy.sh
   ```

   The script does all of this, in order, and fails closed at every step:

   | | step | on failure |
   |---|---|---|
   | 1 | check smoke credentials **before** building | abort, nothing touched |
   | 2 | tag the running image `frt-rollback:prev` | warn (first deploy has no rollback) |
   | 3 | `docker compose build` (`next build` type-checks here) | abort, old container still serving |
   | 4 | `docker compose up -d` | — |
   | 5 | wait for the site to return 200 | **roll back** |
   | 6 | **write-smoke against the live site** | **roll back** |

   Do not substitute `docker compose down && build && up -d` for this. That sequence
   was the old step 3 and it has no gate and no rollback.

4. **Report what the script said**

   Paste its result. `Deploy accepted` is a pass. Anything else means the previous
   image is live again and the new code is *not* deployed — say so plainly rather
   than reporting the rebuild as done.

   If the container itself is sick: `docker compose logs --tail=50`.

## What the smoke actually checks

`playwright.smoke.config.ts` → `tests/smoke/`, run against `tracker.slimelab.cc` as
the bot account:

- **`health.smoke.ts`** — every route in `tests/e2e/routes.ts` renders: HTTP < 400,
  no error boundary, non-empty `<main>`, no `ReferenceError` / Server-Components
  render error / hydration mismatch in the console, no 5xx, and no authed route
  bouncing to `/signin`.
- **`write.smoke.ts`** — saves a real RO, asserts it appears **without a reload**,
  finds it again after a fresh navigation, deletes it, asserts it leaves the list
  **without a reload**. Then sweeps any leftovers from crashed runs.

Test ROs use the reserved `9099xxxxx` band and are deleted by the test.

## Why this exists

Read `~/frt-ops/incident-log.md` and the pattern is unmistakable: **every app bug in
it is a write bug or a render failure**, and the 343-test UI suite never touched
either — it navigates to routes and asserts layout and pixels, and not one of its
tests writes anything.

The old verification was `docker compose ps` showing `Up`. On 2026-08-05 a
`"use server"` re-export threw a `ReferenceError` on the first render of every page
importing that module — saving an RO included. The container reported `Up`. `/`
returned 200, because the public landing page never imports it. Every authenticated
page was dead, and Liem found it by trying to save an RO.

Four separate incidents (`delete-list-refresh`, `spiff-card-stale-refresh`,
`silent-save-fail`, the 08-05 stale dashboard) share one shape: **the write
succeeded and the UI didn't move.** That is why the smoke asserts "without a
reload" — a reload hides exactly the bug we keep shipping.

## Escape hatch

`./scripts/deploy.sh --skip-smoke` deploys ungated. It prints a loud warning and
the deploy is then only as verified as `docker compose ps` — which is to say, not.
Use it when the smoke itself is broken, never to get past a smoke failure.

`./scripts/deploy.sh --smoke-only` gates whatever is already live without
building or deploying anything. Good for confirming a suspicion.
