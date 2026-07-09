#!/usr/bin/env bash
# FRT nightly bot runner — VM only.
# Cron: 0 3 * * *  /home/slime/docker/flat-rate-tracker/bot/run-bot.sh
# Setup: see bot/README.md

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOT_DIR="$REPO_DIR/bot"
ENV_FILE="$HOME/.frt-bot.env"
RUN_DATE="$(date +%F)"
REPORT_FILE="$BOT_DIR/reports/$RUN_DATE.md"
LOG_FILE="$BOT_DIR/logs/$RUN_DATE.log"

mkdir -p "$BOT_DIR/reports" "$BOT_DIR/logs"

# --- credentials + webhook ---------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  echo "FATAL: $ENV_FILE missing (needs FRT_BOT_EMAIL, FRT_BOT_PASSWORD, N8N_BOT_WEBHOOK_URL)" | tee -a "$LOG_FILE"
  exit 1
fi
# shellcheck source=/dev/null
set -a; source "$ENV_FILE"; set +a  # export everything (incl. CLAUDE_CODE_OAUTH_TOKEN)
: "${FRT_BOT_EMAIL:?missing in $ENV_FILE}"
: "${FRT_BOT_PASSWORD:?missing in $ENV_FILE}"
: "${N8N_BOT_WEBHOOK_URL:?missing in $ENV_FILE}"

# --- billing guardrail -------------------------------------------------------
# The bot must pull from the Claude subscription (claude.ai login), NEVER the
# metered API. If an API key is in the environment, Claude Code would silently
# bill it — so we hard-unset every route to metered billing before launching.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

# Weekly digest on Sundays
WEEKLY_DIGEST=0
[[ "$(date +%u)" == "7" ]] && WEEKLY_DIGEST=1

export FRT_BOT_EMAIL FRT_BOT_PASSWORD RUN_DATE WEEKLY_DIGEST

# --- run the bot -------------------------------------------------------------
cd "$REPO_DIR"
PROMPT="You are the FRT nightly bot. Read bot/INSTRUCTIONS.md and follow it exactly. RUN_DATE=$RUN_DATE WEEKLY_DIGEST=$WEEKLY_DIGEST. Login email is in \$FRT_BOT_EMAIL, password in \$FRT_BOT_PASSWORD."

STATUS="FAIL"
if timeout 45m claude -p "$PROMPT" \
    --dangerously-skip-permissions \
    >>"$LOG_FILE" 2>&1; then
  echo "claude run exited 0" >>"$LOG_FILE"
else
  echo "claude run exited nonzero ($?)" >>"$LOG_FILE"
fi

# --- collect the report ------------------------------------------------------
if [[ -f "$REPORT_FILE" ]]; then
  REPORT="$(cat "$REPORT_FILE")"
  STATUS="$(grep -m1 '^## Status:' "$REPORT_FILE" | sed 's/^## Status:[[:space:]]*//' || true)"
  [[ -z "$STATUS" ]] && STATUS="UNKNOWN"
else
  REPORT="# FRT Bot Run — $RUN_DATE

## Status: FAIL (couldn't complete run)

The bot did not produce a report file. Runner log tail:

\`\`\`
$(tail -n 40 "$LOG_FILE" 2>/dev/null)
\`\`\`"
  STATUS="FAIL"
fi

# --- ship to n8n -> email ----------------------------------------------------
jq -n \
  --arg date "$RUN_DATE" \
  --arg status "$STATUS" \
  --arg subject "FRT Bot [$STATUS] — $RUN_DATE" \
  --arg report "$REPORT" \
  '{date: $date, status: $status, subject: $subject, report: $report}' \
| curl -sS -X POST "$N8N_BOT_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d @- >>"$LOG_FILE" 2>&1 \
  || echo "WARNING: webhook POST failed" >>"$LOG_FILE"

# --- housekeeping: keep 90 days of reports/logs ------------------------------
find "$BOT_DIR/reports" "$BOT_DIR/logs" -type f -mtime +90 -delete 2>/dev/null

echo "run complete: status=$STATUS" >>"$LOG_FILE"
