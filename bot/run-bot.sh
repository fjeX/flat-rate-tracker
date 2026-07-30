#!/usr/bin/env bash
# FRT nightly bot runner — VM only.
# Cron: 0 3 * * *  /home/liem9319/docker/flat-rate-tracker/bot/run-bot.sh
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
# A yielded turn silently kills the run. Headless `claude -p` treats handing the
# turn back — a backgrounded wait, a scheduled wake-up, "I'll resume once
# notified" — as a COMPLETED turn and exits 0, before bot/reports/$RUN_DATE.md is
# ever written. INSTRUCTIONS.md has told the bot not to do this since 2026-07-23
# and it did it anyway on 2026-07-30 (fingerprint: bot-runner-hang). Prose cannot
# be the only guard, so the runner no longer trusts the exit code:
# THE REPORT FILE IS THE ONLY SUCCESS SIGNAL, and a missing one earns one retry.
cd "$REPO_DIR"
BASE_PROMPT="You are the FRT nightly bot. Read bot/INSTRUCTIONS.md and follow it exactly. RUN_DATE=$RUN_DATE WEEKLY_DIGEST=$WEEKLY_DIGEST. Login email is in \$FRT_BOT_EMAIL, password in \$FRT_BOT_PASSWORD."

RETRY_NOTE="RETRY — READ THIS FIRST. A previous attempt tonight exited without writing
bot/reports/$RUN_DATE.md. It ended its turn early, almost certainly by backgrounding a
wait instead of blocking on it. You are running headless: ending your turn for ANY
reason terminates the whole run and loses everything you tested. Every pause must be a
single foreground, blocking \`sleep N\` inside one Bash call — never a background timer,
scheduled wake-up, or any wait that hands the turn back. If a step genuinely cannot be
done without waiting asynchronously, SKIP that step, record it as untested in the
report, and keep going. Writing the report file is the one thing you may never skip."

run_attempt() {
  local n="$1" prompt="$2" rc=0
  echo "=== attempt $n started $(date +%T) ===" >>"$LOG_FILE"
  timeout 45m claude -p "$prompt" \
      --dangerously-skip-permissions \
      >>"$LOG_FILE" 2>&1 || rc=$?
  echo "=== attempt $n finished $(date +%T): claude exited $rc ===" >>"$LOG_FILE"
}

STATUS="FAIL"
RETRIED=0

run_attempt 1 "$BASE_PROMPT"

if [[ ! -f "$REPORT_FILE" ]]; then
  RETRIED=1
  echo "NO REPORT FILE after attempt 1 (bot-runner-hang) — retrying once" >>"$LOG_FILE"
  run_attempt 2 "$BASE_PROMPT

$RETRY_NOTE"
fi

# --- collect the report ------------------------------------------------------
if [[ -f "$REPORT_FILE" ]]; then
  REPORT="$(cat "$REPORT_FILE")"
  STATUS="$(grep -m1 '^## Status:' "$REPORT_FILE" | sed 's/^## Status:[[:space:]]*//' || true)"
  [[ -z "$STATUS" ]] && STATUS="UNKNOWN"
  # Surface the retry even on success — a run that only passed on attempt 2 is
  # still the bot-runner-hang bug, and it must not disappear behind a PASS.
  if [[ "$RETRIED" == "1" ]]; then
    REPORT="$REPORT

---
**⚠️ Runner note:** attempt 1 exited without writing a report (fingerprint
\`bot-runner-hang\`); this report came from the automatic retry. The retry
succeeding does not mean the hang is fixed."
  fi
else
  REPORT="# FRT Bot Run — $RUN_DATE

## Status: FAIL (no report after 2 attempts)

Fingerprint: \`bot-runner-hang\`. The bot produced no report file on either
attempt — it ended its turn before writing one, which makes headless
\`claude -p\` exit as if the work were done. This is a bot-harness failure,
**not** an FRT application failure: do not restart containers or touch the app.

Runner log tail:

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
