# CLAUDE.md — Flat Rate Tracker

You are assisting with the Flat Rate Tracker (FRT) — a Next.js app for logging automotive repair orders.

## How Changes Flow — Always Read This First

**All code changes happen off the VM.** The process is always:

1. New feature or fix built and tested locally (laptop or PC)
2. Changes committed and pushed to GitHub (`frt` remote)
3. SSH into VM → `git pull origin master`
4. Apply any new DB migrations (see below)
5. Rebuild the Docker image if code changed: `docker compose down && docker compose build && docker compose up -d`

**Never edit app code directly on the VM.** The VM's job is to run the app, not develop it. If something looks wrong in the code, the fix happens locally, gets pushed, and gets pulled in.

## VM Directory Structure

- **FRT app + Dockerfile:** `~/docker/flat-rate-tracker/`
- **Supabase stack:** `~/docker/flat-rate-tracker/supabase-stack/`

## The One Thing That's VM-Only: The Database

The self-hosted Supabase database is the only component that differs between environments. It does not auto-apply migrations — every migration file must be run manually against production.

### Applying migrations

1. After a `git pull`, check if any new migration files came in:
   ```bash
   git log --oneline -5 -- supabase/migrations/
   ```
2. If yes, apply each new `.sql` file (oldest timestamp first) via `docker exec`:
   ```bash
   docker exec supabase-db psql -U postgres -d postgres -f /path/to/migration.sql
   ```
   Or paste the SQL directly into the Supabase Studio SQL editor if it's accessible.
3. Verify the columns exist:
   ```bash
   docker exec supabase-db psql -U postgres -d postgres \
     -c "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, column_name;"
   ```

Migration files live at: `~/docker/flat-rate-tracker/supabase/migrations/`

**Never skip this check after a pull.** Missing migrations are the most common production failure mode — the app code and DB schema get out of sync silently.

## Infrastructure Reference

### Reverse Proxy: Traefik Only

Traefik is already running on this VM and owns ports 80 and 443. **Never add Caddy, nginx, or any other reverse proxy.** The official Supabase docker-compose includes a `caddy` service — it must be commented out entirely.

- **Traefik network:** `proxy` (external Docker network)
- **Certresolver:** `cloudflare`

### Domains

| Domain | Routes to |
|---|---|
| `tracker.slimelab.cc` | FRT Next.js app (port 3000) |
| `api.slimelab.cc` | Supabase Kong API gateway (port 8000) |

### NEXT_PUBLIC_* Vars Are Build-Time Only

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are baked into the Next.js bundle at build time. Changing `.env` without rebuilding does nothing. Always rebuild after changing these vars.

`NEXT_PUBLIC_SUPABASE_URL` must be `https://api.slimelab.cc`.

### Kong / Traefik Integration

The `kong` service in `supabase-stack/docker-compose.yml` needs these for `api.slimelab.cc` to route correctly:

```yaml
networks:
  - proxy
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.supabase-api.rule=Host(`api.slimelab.cc`)"
  - "traefik.http.routers.supabase-api.entrypoints=websecure"
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
