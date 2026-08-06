#!/usr/bin/env bash
# FRT deploy gate — VM only. Run from ~/docker/flat-rate-tracker.
#
#   ./scripts/deploy.sh              build, deploy, smoke, roll back on failure
#   ./scripts/deploy.sh --skip-smoke deploy without the gate (records WHY it was skipped)
#   ./scripts/deploy.sh --smoke-only run the smoke against what is already live
#
# WHY THIS IS A SCRIPT AND NOT STEPS IN A SKILL FILE
# The incident log is explicit about this. bot-runner-hang was "fixed" with prose
# in INSTRUCTIONS.md on 07-23 and regressed on 07-30; it only held once run-bot.sh
# stopped trusting the exit code. Rollback and the smoke gate have the same
# property: they must happen even when nobody remembers them. A skill can forget
# a step. A script cannot.
#
# WHAT IT GUARDS
# The old verification was `docker compose ps` showing "Up". On 2026-08-05 a
# "use server" re-export threw on the first render of every page importing that
# module — saving an RO included. The container was Up. `/` returned 200. Every
# authenticated page was dead. "Up" is not "working".

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

SMOKE_BASE_URL="${SMOKE_BASE_URL:-https://tracker.slimelab.cc}"
BOT_ENV="${BOT_ENV:-$HOME/.frt-bot.env}"
ROLLBACK_TAG="frt-rollback:prev"
SKIP_SMOKE=0
SMOKE_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --skip-smoke) SKIP_SMOKE=1 ;;
    --smoke-only) SMOKE_ONLY=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── Preconditions ───────────────────────────────────────────────────────────
[[ -f docker-compose.yml ]] || die "not in the FRT repo ($REPO_DIR)"
command -v docker >/dev/null || die "docker not found — this script is VM-only"

IMAGE_NAME="$(docker compose config --images | head -1)"
[[ -n "$IMAGE_NAME" ]] || die "could not resolve the app image name from compose"

# ── Smoke credentials, checked BEFORE we build ──────────────────────────────
# Finding out the gate can't run only after the new image is already live is how
# you end up shipping ungated and calling it a pass.
if [[ "$SKIP_SMOKE" -eq 0 ]]; then
  if [[ -f "$BOT_ENV" ]]; then
    set -a; source "$BOT_ENV"; set +a
  fi
  [[ -n "${FRT_BOT_EMAIL:-}" && -n "${FRT_BOT_PASSWORD:-}" ]] \
    || die "FRT_BOT_EMAIL/FRT_BOT_PASSWORD missing (looked in $BOT_ENV) — the smoke cannot sign in.
       Fix the credentials, or deploy ungated on purpose with --skip-smoke."
  # The smoke must never bill the metered API if it ever shells out to Claude.
  unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
  export FRT_BOT_EMAIL FRT_BOT_PASSWORD SMOKE_BASE_URL
fi

# ── Test deps (one-time on the VM; the build itself runs in Docker) ─────────
ensure_test_deps() {
  if [[ ! -x node_modules/.bin/playwright ]]; then
    log "Installing test dependencies (first run only)"
    npm ci --no-audit --no-fund
  fi
  # Browsers are already cached at ~/.cache/ms-playwright; this is a no-op then.
  npx playwright install chromium >/dev/null 2>&1 || warn "playwright install chromium reported a problem"
  ok "test deps ready"
}

run_smoke() {
  ensure_test_deps
  log "Smoke gate against $SMOKE_BASE_URL"
  npx playwright test --config=playwright.smoke.config.ts
}

# ── --smoke-only: gate what is already running, change nothing ───────────────
if [[ "$SMOKE_ONLY" -eq 1 ]]; then
  run_smoke && { ok "smoke passed"; exit 0; } || die "smoke FAILED (nothing was deployed or rolled back)"
fi

# ── 1. Record the rollback point ────────────────────────────────────────────
log "Recording rollback point"
PREV_IMAGE_ID="$(docker compose images -q app 2>/dev/null || true)"
if [[ -n "$PREV_IMAGE_ID" ]]; then
  docker tag "$PREV_IMAGE_ID" "$ROLLBACK_TAG"
  ok "current image $PREV_IMAGE_ID tagged $ROLLBACK_TAG"
else
  warn "no running image — first deploy, ROLLBACK WILL NOT BE AVAILABLE"
fi

# ── 2. Build ────────────────────────────────────────────────────────────────
# `next build` type-checks, so a tsc error fails here and never reaches the site.
log "Building"
docker compose build || die "build FAILED — nothing was deployed, the old container is untouched"
ok "image built"

# ── 3. Deploy ───────────────────────────────────────────────────────────────
log "Deploying"
docker compose up -d
ok "container started"

# ── 4. Wait for the site to answer ──────────────────────────────────────────
log "Waiting for $SMOKE_BASE_URL"
UP=0
for i in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SMOKE_BASE_URL" || true)"
  if [[ "$CODE" == "200" ]]; then UP=1; ok "HTTP 200 after ${i}s"; break; fi
  sleep 1
done

rollback() {
  local reason="$1"
  printf '\n\033[31m✗ %s\033[0m\n' "$reason" >&2
  if [[ -z "$PREV_IMAGE_ID" ]]; then
    die "NO ROLLBACK IMAGE — the bad build is live. Fix forward now."
  fi
  log "ROLLING BACK to $PREV_IMAGE_ID"
  docker tag "$ROLLBACK_TAG" "$IMAGE_NAME"
  docker compose up -d --force-recreate --no-build
  sleep 5
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SMOKE_BASE_URL" || true)"
  if [[ "$code" == "200" ]]; then
    ok "rolled back — $SMOKE_BASE_URL serving 200 on the previous image"
  else
    warn "rollback ran but the site returns $code — CHECK MANUALLY"
  fi
  printf '\n\033[31mDEPLOY REJECTED. The previous image is live. Fix the failure above, then redeploy.\033[0m\n' >&2
  exit 1
}

[[ "$UP" -eq 1 ]] || rollback "site never returned 200 within 30s"

# ── 5. The gate ─────────────────────────────────────────────────────────────
if [[ "$SKIP_SMOKE" -eq 1 ]]; then
  warn "SMOKE SKIPPED (--skip-smoke) — this deploy is UNGATED. Container is Up; that is all we know."
  exit 0
fi

run_smoke || rollback "smoke FAILED on the new image"

log "Deploy accepted"
ok "smoke passed against $SMOKE_BASE_URL"
docker compose ps
