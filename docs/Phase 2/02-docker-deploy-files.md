# Session Handoff — Phase 2 Track A: Docker deploy files committed

## Where it started

User asked to plan and begin phase 2 of the Flat Rate Tracker — self-hosted homelab deployment. Phase 1 (all 7 screens) was already 100% complete and committed. This session was scoped to planning the full phase 2 strategy and executing the codebase side (Track A) before the user goes to set up the VM infrastructure (Track B).

## Decisions locked + what shipped

- **Domain**: `tracker.slimelab.cc` — Next.js app. `api.slimelab.cc` — Supabase Kong API gateway (to be configured on VM).
- **No email confirmation for beta testers** — GoTrue `ENABLE_EMAIL_AUTOCONFIRM=true` when setting up self-hosted Supabase.
- **Fresh start** — no migration of local dev data to self-hosted instance; testers create real accounts.
- **Traefik network**: `proxy` (external Docker network on the Ubuntu VM).
- **Certresolver**: `cloudflare` (DNS challenge via Cloudflare, Let's Encrypt ACME).
- **`output: "standalone"`** added to `next.config.ts` — enables minimal Docker image with a self-contained `server.js`. Build verified clean at commit `3d6d426`.
- **`Dockerfile`** — 3-stage build: `deps` (npm ci) → `builder` (bakes `NEXT_PUBLIC_*` vars as build args so they're inlined into the client bundle) → `runner` (non-root `nextjs` user, copies standalone output only). Lives at `/home/slime/Projects/flat_rate_tracker/Dockerfile`.
- **`.dockerignore`** — excludes `.git`, `node_modules`, `.next`, `.env*`, `.claude/`, `docs/`. Lives at `/home/slime/Projects/flat_rate_tracker/.dockerignore`.
- **`docker-compose.yml`** — app service with Traefik labels (`tracker.slimelab.cc`, `websecure` entrypoint, `cloudflare` certresolver, `proxy` external network). Build args pass `NEXT_PUBLIC_*` from the `.env` file at build time. Lives at `/home/slime/Projects/flat_rate_tracker/docker-compose.yml`.
- **`.env.example`** — updated with phase 2 comments documenting `api.slimelab.cc` values. Lives at `/home/slime/Projects/flat_rate_tracker/.env.example`.

## Key files for next session

- Plan file: `/home/slime/.claude/plans/i-want-to-continue-stateful-iverson.md` — read this first; Track B (VM work) is the remainder
- `/home/slime/Projects/flat_rate_tracker/Dockerfile` — what the VM will build
- `/home/slime/Projects/flat_rate_tracker/docker-compose.yml` — Traefik labels, network, build args
- `/home/slime/Projects/flat_rate_tracker/supabase/migrations/20260422005715_initial_schema.sql` — this file must be piped into the self-hosted Postgres container during VM setup
- `/home/slime/Projects/flat_rate_tracker/.env.example` — template for the `.env` the user creates on the VM
- Memory files touched: none this session

## Running state

- Background processes: none
- Dev servers / ports: none (build was run and killed; `npm run dev` was not started)
- Open worktrees / branches: none — branch is `main`, up to date with origin

## Verification — how to confirm things still work

- `npm run build` from `/home/slime/Projects/flat_rate_tracker` — should exit 0, last verified at commit `3d6d426`
- `ls /home/slime/Projects/flat_rate_tracker/.next/standalone/` — should show `node_modules  package.json  server.js`
- `npx supabase status` — confirms local Docker Supabase stack is still running for local dev

## Deferred + open questions

- Deferred: Track B VM infrastructure — self-hosted Supabase setup, `api.slimelab.cc` Traefik route for Kong port 8000, clone repo on VM, create `.env` with `NEXT_PUBLIC_SUPABASE_URL=https://api.slimelab.cc` + `ANON_KEY`, `docker compose build && docker compose up -d`
- Deferred: Supabase `.env` JWT key generation — user needs to generate `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` using the Supabase-provided tool before starting the self-hosted stack
- Deferred: All phase 1 deferred items carry forward (atomic RPC for entry creation, non-transactional import, no delete-paid-period UI, no Realtime timer dot sync)

## Pick up here

Start Track B: SSH into the Ubuntu VM, clone the official Supabase Docker Compose repo (`git clone --depth 1 https://github.com/supabase/supabase && cd supabase/docker && cp .env.example .env`), configure the `.env` (JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, SITE_URL=`https://tracker.slimelab.cc`, ENABLE_EMAIL_AUTOCONFIRM=true), start the stack with `docker compose up -d`, then pipe the migration SQL into the Postgres container.

---

## Carry-forward context (critical gotchas and patterns)

These do not change between sessions — internalize before writing any new code.

### Next.js version quirks (Next 16.x on this project)
- `params` and `searchParams` in route segments are **Promises** — always `await` them.
- Read `node_modules/next/dist/docs/` for any API you're not certain about.

### Supabase patterns
- All DB calls go through `src/lib/db/index.ts`. Never call `supabase` directly in a server action.
- `flag_hours` on `entries` is maintained by a DB trigger — don't compute/write it manually.
- `timer_start_time` is a `bigint` in the DB (epoch ms) — don't fit it into a postgres `int`.

### NEXT_PUBLIC_* vars are build-time, not runtime
- These are baked into the client JS bundle during `npm run build`. Changing them at `docker compose up` time has no effect. Always pass them as `build.args` in `docker-compose.yml` and rebuild the image when they change.

### Revalidation rules
- `revalidatePath("/", "layout")` required on every timer mutation (nav dot).
- `revalidatePeriodScreens()` in `src/app/actions/settings.ts` — call on splitDay/period override changes.
- `revalidateAll()` in `settings.ts` — call for import and clear-all only.

### Commit style
- Title < 70 chars, imperative mood. Why-focused bulleted body.
- Trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
- Never auto-commit — wait for user confirmation first.

### Do not refactor `src/components/forms/OpCodeModals.tsx` — standing rule.
