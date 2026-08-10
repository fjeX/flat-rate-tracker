#!/usr/bin/env bash
# Accept the current look as the new canary baseline. VM only (needs Docker).
#
#   ./scripts/update-baselines.sh          rebuild, then regenerate every baseline
#   ./scripts/update-baselines.sh --no-build   reuse the image already built
#
# Run this ONLY after reviewing the diff (npm run test:ui:report) and deciding
# the change is intentional. It is the "yes, the design moved" button — running
# it reflexively to make a red gate green is how the old suite stopped meaning
# anything.
#
# The images it writes are committed alongside the change that caused them, the
# same way a migration ships with the code that needs it.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

CANARY_PORT="${CANARY_PORT:-3901}"
PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.61.1-noble}"
BUILD=1
[[ "${1:-}" == "--no-build" ]] && BUILD=0

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f docker-compose.yml ]] || die "not in the FRT repo ($REPO_DIR)"
command -v docker >/dev/null || die "docker not found — this script is VM-only"

IMAGE_NAME="$(docker compose config --images | head -1)"
[[ -n "$IMAGE_NAME" ]] || die "could not resolve the app image name from compose"
export IMAGE_NAME CANARY_PORT

if [[ "$BUILD" -eq 1 ]]; then
  log "Building"
  docker compose build || die "build FAILED"
  ok "image built"
fi

canary_down() { docker compose --profile canary rm -sf app-canary >/dev/null 2>&1 || true; }
canary_down
trap canary_down EXIT

log "Starting canary on port $CANARY_PORT"
docker compose --profile canary up -d app-canary || die "canary failed to start"

CANARY_URL="http://127.0.0.1:$CANARY_PORT"
UP=0
for i in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$CANARY_URL" || true)"
  if [[ "$CODE" == "200" ]]; then UP=1; ok "canary answering after ${i}s"; break; fi
  sleep 1
done
[[ "$UP" -eq 1 ]] || { docker compose --profile canary logs --tail=30 app-canary || true; die "canary never returned 200"; }

# Same guard as the deploy gate: baselines captured from a canary that fell back
# to live data would bake tonight's bot data in permanently.
docker compose --profile canary logs app-canary 2>&1 | grep -q "FIXTURE MODE" \
  || die "canary is NOT in fixture mode — refusing to write baselines from live data"
ok "fixture mode confirmed"

log "Regenerating baselines"
docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  -v "$REPO_DIR:/work" -w /work \
  -e HOME=/tmp -e FRT_CANARY_URL="$CANARY_URL" \
  "$PLAYWRIGHT_IMAGE" \
  npx playwright test --config=playwright.visual.config.ts --update-snapshots

canary_down
trap - EXIT

log "Baselines updated"
ok "review with 'git diff --stat tests/e2e/__canary__' and commit them WITH the change that caused them"
