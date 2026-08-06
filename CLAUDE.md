# CLAUDE.md — Flat Rate Tracker

You are assisting with the Flat Rate Tracker (FRT) — a Next.js app for logging automotive repair orders.

## How Changes Flow — Always Read This First

**All code changes happen off the VM.** The process is always:

1. New feature or fix built and tested locally (laptop or PC)
2. Changes committed and pushed to GitHub (`frt` remote)
3. SSH into VM → `git pull origin master`
4. Apply any new DB migrations if needed (see The One Thing That's VM-Only below)
5. Rebuild the Docker image if app code changed (see After a Pull below)

**Never edit app code directly on the VM.** The VM's job is to run the app, not develop it. If something looks wrong in the code, the fix happens locally, gets pushed, and gets pulled in.

## After a Pull — What to Do Next

Use the **rebuild skill**. It is two steps and neither is conditional:

### 1. Apply migrations — invoke the migrate skill, unconditionally
Do not gate this on a git check, and do not apply migrations by hand or in the
Supabase SQL editor. The skill detects what is pending against
`public.applied_migrations` and records what it applied; anything applied outside it
leaves no ledger row and looks pending forever.

A `git log ORIG_HEAD..HEAD` check asks *"what arrived in the last pull"*, not *"what
is pending against the database"*. On 2026-08-06 that difference nearly shipped a
container calling a function the DB did not have — the migration had landed in an
earlier pull, so the diff was empty, and every later pull moved `ORIG_HEAD` further
past it.

**Migrations always finish before the deploy.** If migrate fails, stop.

### 2. Deploy — one command
```bash
cd ~/docker/flat-rate-tracker
./scripts/deploy.sh
```

Tags the running image for rollback → builds → deploys → waits for 200 → runs the
**write-smoke** against the live site → **rolls back automatically if it fails**.
`Deploy accepted` is the only pass. Anything else means the previous image is live
and the new code is not deployed.

**Do not run `docker compose down && docker compose build && docker compose up -d`
directly.** That was the old procedure. It has no gate and no rollback, and it is
how a build that returned 200 on `/` while every authenticated page threw was
reported as a successful deploy (2026-08-05).

If the container itself is sick: `docker compose logs --tail=50`.

## VM Directory Structure

- **FRT app + Dockerfile:** `~/docker/flat-rate-tracker/`
- **Supabase stack:** `~/docker/flat-rate-tracker/supabase-stack/`

## The One Thing That's VM-Only: The Database

The self-hosted Supabase database is the only component that differs between environments. It does not auto-apply migrations — every migration file must be run manually against production.

### Applying migrations

**Use the migrate skill.** It is the only supported path.

It diffs the files in `supabase/migrations/` against the `public.applied_migrations`
ledger, applies whatever is pending oldest-first with `ON_ERROR_STOP=1`, writes a
ledger row per file immediately after that file succeeds, and verifies against the
catalog rather than against its own ledger.

Do not hand-run `psql` and do not use the Supabase SQL editor. Both work and both
leave no ledger row, so the migration stays "pending" forever and the next deploy
tries to apply it again. `ON_ERROR_STOP=1` matters for the same reason: without it
psql half-applies a file and still exits 0.

Migration files live at `~/docker/flat-rate-tracker/supabase/migrations/`.

## Infrastructure Reference

### Reverse Proxy: Traefik Only

Traefik is already running on this VM and owns ports 80 and 443. **Never add Caddy, nginx, or any other reverse proxy.** The official Supabase docker-compose includes a `caddy` service — it must be commented out entirely.

- **Traefik network:** `proxy` (external Docker network)
- **Certresolver:** `cloudflare`
- **Entrypoint for internet-facing services:** `websecure-ext` (port 444) — use this for anything exposed to the public internet. `websecure` does not exist in this Traefik config; using it will cause Traefik to silently drop the router with no error.

### Domains

| Domain | Routes to |
|---|---|
| `tracker.slimelab.cc` | FRT Next.js app (port 3000) |
| `api.slimelab.cc` | Supabase Kong API gateway (port 8000) |

### NEXT_PUBLIC_* Vars Are Build-Time Only

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are baked into the Next.js bundle at build time. Changing `.env` without rebuilding does nothing. Always rebuild after changing these vars.

`NEXT_PUBLIC_SUPABASE_URL` must be `https://api.slimelab.cc`.

### SUPABASE_INTERNAL_URL Is Runtime-Only

`SUPABASE_INTERNAL_URL` (set in `.env`, passed through `docker-compose.yml` as a container env var) points server-side Supabase calls straight at Kong over the shared `proxy` Docker network — e.g. `http://supabase-kong:8000`. This skips DNS → Traefik → TLS for every query the app server makes.

- It is read at **runtime**, not build time — changing it only needs `docker compose up -d` to recreate the container, no rebuild
- If unset or empty, the app falls back to the public `NEXT_PUBLIC_SUPABASE_URL` (slower but works)
- The browser always uses the public URL; this var affects Server Components, Server Actions, and the auth proxy only
- The hostname must resolve on the `proxy` network — verify with `docker exec <app-container> wget -qO- http://supabase-kong:8000/auth/v1/health`

### Kong / Traefik Integration

The `kong` service in `supabase-stack/docker-compose.yml` needs these for `api.slimelab.cc` to route correctly:

```yaml
networks:
  - proxy
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.supabase-api.rule=Host(`api.slimelab.cc`)"
  - "traefik.http.routers.supabase-api.entrypoints=websecure-ext"
  - "traefik.http.routers.supabase-api.tls=true"
  - "traefik.http.routers.supabase-api.tls.certresolver=cloudflare"
  - "traefik.http.services.supabase-api.loadbalancer.server.port=8000"
```

And at the bottom of that file:

```yaml
networks:
  proxy:
    external: true
```

## What NOT to Do

- Do not edit app code directly on the VM — push from local, pull on VM
- Do not add any reverse proxy (Caddy, nginx, etc.)
- Do not change `NEXT_PUBLIC_*` values without rebuilding the image
- Do not `docker compose down` the Traefik container — it serves all homelab traffic
- Do not create Docker networks named `web`, `traefik`, or `default` — use `proxy`
- Do not clone the Supabase repo anywhere other than `~/supabase/`

## UI Changes — Required Gate

Before any commit that touches `.tsx` or `.css`, run **`npm run test:ui`**
(visual snapshots + quality checks, every route × dark/light × mobile/desktop).
Intentional look changes: review with `npm run test:ui:report`, accept with
`npm run test:ui:update`, commit baselines with the change. Details in
`README.md` and `AGENTS.md`.
