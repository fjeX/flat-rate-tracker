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

# How long one attempt gets, and the wall the whole run has to be finished by.
# 45m was the budget until 2026-08-13, when attempt 1 was killed at exactly
# 45:00 (exit 124) — INSTRUCTIONS.md had grown 35 lines the afternoon before and
# the checklist simply outgrew the budget. Runs were 31-33 min all week before
# that commit, and the passing retry took 41m33s.
TIMEOUT_MIN="${FRT_BOT_TIMEOUT_MIN:-75}"
# The 6 AM digest reads whatever report exists at 06:00. A retry finishing after
# that is worse than no retry: the digest reports the report missing, which is
# the alarm for "the bot never ran" firing on a run that was merely slow.
FINISH_BY="${FRT_BOT_FINISH_BY:-05:40}"

# Minutes from now until FINISH_BY today (0 if already past).
minutes_left() {
  local now target
  now=$(date +%s)
  target=$(date -d "today $FINISH_BY" +%s 2>/dev/null) || { echo 0; return; }
  if (( target <= now )); then echo 0; else echo $(( (target - now) / 60 )); fi
}

RETRY_NOTE_YIELD="RETRY — READ THIS FIRST. A previous attempt tonight exited without writing
bot/reports/$RUN_DATE.md. It ended its turn early, almost certainly by backgrounding a
wait instead of blocking on it. You are running headless: ending your turn for ANY
reason terminates the whole run and loses everything you tested. Every pause must be a
single foreground, blocking \`sleep N\` inside one Bash call — never a background timer,
scheduled wake-up, or any wait that hands the turn back. If a step genuinely cannot be
done without waiting asynchronously, SKIP that step, record it as untested in the
report, and keep going. Writing the report file is the one thing you may never skip."

# A timed-out attempt was NOT idle — it was working and ran out of clock. Telling
# it "you ended your turn early", which is what every retry used to be told,
# is false and sends it hunting a bug that isn't there.
RETRY_NOTE_TIMEOUT_TMPL="RETRY — READ THIS FIRST. A previous attempt tonight was KILLED at its
time limit while still working; it did not hang and it did not end its turn early. It had
already logged real test data before it died. You have __MINS__ minutes, and that is a hard
kill, not a guideline.

Budget accordingly: work the checklist in order, and from the halfway mark onward prefer
finishing the report over starting another check. Any step you do not reach must be listed
in the report as untested — an unreached check recorded as untested is a good outcome; a
run killed with no report at all is the one true failure. Write bot/reports/$RUN_DATE.md
before you run out of time, then keep testing and update it if time remains."

RETRY_NOTE_CRASH="RETRY — READ THIS FIRST. A previous attempt tonight exited with an error
before writing bot/reports/$RUN_DATE.md. If you hit the same failure, do not fight it —
record it in the report as the blocker, note what you could not test because of it, and
write the report anyway. Writing the report file is the one thing you may never skip."

# Why an attempt produced no report. These need different retry advice and
# different fingerprints; the runner used to call all of them bot-runner-hang,
# which is a real but DIFFERENT bug (a yielded turn exiting 0) — so a timeout
# arrived looking like an already-diagnosed problem.
#   124 → killed at the wall, still working  → bot-runner-timeout
#   137 → SIGKILL, i.e. out of memory        → bot-runner-oom
#     0 → exited "successfully", no report   → bot-runner-hang
#  else → crashed                            → bot-runner-crash
classify() {
  case "$1" in
    124) echo "timeout" ;;
    137) echo "oom" ;;
    0)   echo "yield" ;;
    *)   echo "crash" ;;
  esac
}

fingerprint_for() {
  case "$1" in
    timeout) echo "bot-runner-timeout" ;;
    oom)     echo "bot-runner-oom" ;;
    yield)   echo "bot-runner-hang" ;;
    *)       echo "bot-runner-crash" ;;
  esac
}

# On 2026-08-16 at 03:57 this run's `claude` reached 4.38 GB anon RSS and the
# kernel OOM-killer took it -- and cron.service with it. `claude` is a native
# binary, so NODE_OPTIONS/--max-old-space-size do nothing; a cgroup is the only
# thing that actually bounds it. 5G sits well clear of the 4.38 GB peak but
# below the point where the 22 containers next door start losing pages, so a
# runaway now costs us the night's report instead of the whole VM.
#
# MemorySwapMax=0 is NOT optional and NOT belt-and-suspenders. MemoryMax alone
# caps RAM only: the kernel answers the overage by paging the process out to the
# VM's 4 GB swap, so the run survives, crawls, and drags every container next to
# it down with the I/O -- verified here, a 500 MB allocation under a 100 MB cap
# exits 0. Pinning swap to 0 is what converts "thrash the box" into "kill this
# one run", which is the whole point of the cap.
#
# Best-effort by design: cron's PAM session normally starts the user manager,
# but the user does not linger, so if it is absent we run UNCAPPED rather than
# skip the night entirely. A missing cap is a bad night; a skipped run is worse.
MEM_MAX="${FRT_BOT_MEM_MAX:-5G}"
if systemd-run --user --scope -q -p MemoryMax=200M -p MemorySwapMax=0 true >/dev/null 2>&1; then
  CAP=(systemd-run --user --scope -q -p "MemoryMax=$MEM_MAX" -p "MemorySwapMax=0" --)
  CAP_NOTE="cap $MEM_MAX"
else
  CAP=()
  CAP_NOTE="UNCAPPED"
  echo "WARN: systemd-run --user unavailable -- running without a memory cap" >>"$LOG_FILE"
fi

run_attempt() {
  local n="$1" prompt="$2" budget="$3" rc=0
  echo "=== attempt $n started $(date +%T) (budget ${budget}m, $CAP_NOTE) ===" >>"$LOG_FILE"
  timeout "${budget}m" "${CAP[@]}" claude -p "$prompt" \
      --dangerously-skip-permissions \
      >>"$LOG_FILE" 2>&1 || rc=$?
  echo "=== attempt $n finished $(date +%T): claude exited $rc ===" >>"$LOG_FILE"
  ATTEMPT_RC="$rc"
}

STATUS="FAIL"
RETRIED=0
CAUSE=""
FINGERPRINT=""
SKIPPED_RETRY=""

run_attempt 1 "$BASE_PROMPT" "$TIMEOUT_MIN"

if [[ ! -f "$REPORT_FILE" ]]; then
  CAUSE="$(classify "$ATTEMPT_RC")"
  FINGERPRINT="$(fingerprint_for "$CAUSE")"
  echo "NO REPORT FILE after attempt 1 (rc=$ATTEMPT_RC, $FINGERPRINT)" >>"$LOG_FILE"

  LEFT="$(minutes_left)"
  RETRY_BUDGET=$(( LEFT < TIMEOUT_MIN ? LEFT : TIMEOUT_MIN ))
  # Leave enough room to be worth starting: a 10-minute attempt burns tokens and
  # still lands nothing in front of the digest. Gate on the time actually left,
  # not on RETRY_BUDGET — that is capped by TIMEOUT_MIN, so gating on it would
  # silently disable retries entirely for anyone who lowered the per-attempt
  # limit below 15m.
  if (( LEFT < 15 )); then
    SKIPPED_RETRY="only ${LEFT}m left before ${FINISH_BY}"
    echo "SKIPPING retry — $SKIPPED_RETRY" >>"$LOG_FILE"
  else
    RETRIED=1
    case "$CAUSE" in
      timeout) RETRY_NOTE="${RETRY_NOTE_TIMEOUT_TMPL//__MINS__/$RETRY_BUDGET}" ;;
      yield)   RETRY_NOTE="$RETRY_NOTE_YIELD" ;;
      *)       RETRY_NOTE="$RETRY_NOTE_CRASH" ;;
    esac
    echo "retrying with ${RETRY_BUDGET}m budget ($CAUSE)" >>"$LOG_FILE"
    run_attempt 2 "$BASE_PROMPT

$RETRY_NOTE" "$RETRY_BUDGET"
  fi
fi

# --- collect the report ------------------------------------------------------
if [[ -f "$REPORT_FILE" ]]; then
  REPORT="$(cat "$REPORT_FILE")"
  STATUS="$(grep -m1 '^## Status:' "$REPORT_FILE" | sed 's/^## Status:[[:space:]]*//' || true)"
  [[ -z "$STATUS" ]] && STATUS="UNKNOWN"
  # Surface the retry even on success — a run that only passed on attempt 2 is
  # still a runner failure, and it must not disappear behind a PASS.
  if [[ "$RETRIED" == "1" ]]; then
    case "$CAUSE" in
      timeout) WHAT="was killed at its ${TIMEOUT_MIN}m time limit while still working" ;;
      oom)     WHAT="was killed by the kernel for exceeding the ${MEM_MAX} memory cap" ;;
      yield)   WHAT="exited without writing a report" ;;
      *)       WHAT="exited with an error (rc=$ATTEMPT_RC)" ;;
    esac
    REPORT="$REPORT

---
**⚠️ Runner note:** attempt 1 $WHAT (fingerprint
\`$FINGERPRINT\`); this report came from the automatic retry. The retry
succeeding does not mean the underlying problem is fixed."
  fi
else
  # Is the app itself up? Without this the runner asserted, on every no-report
  # night whatever the cause, that this was "not an FRT application failure" and
  # that nobody should touch the app — which would read as reassuring on exactly
  # the night the site was down.
  APP_URL="${FRT_APP_URL:-https://tracker.slimelab.cc}"
  APP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$APP_URL" 2>/dev/null || echo 000)"
  echo "app probe: $APP_URL -> $APP_CODE" >>"$LOG_FILE"

  if [[ "$APP_CODE" == "200" ]]; then
    APP_LINE="The app answered $APP_CODE at $APP_URL just now, so this is a bot-harness
failure and **not** an FRT application failure: do not restart containers or touch the app."
  else
    APP_LINE="**The app did NOT answer normally** — $APP_URL returned \`$APP_CODE\` when the
runner probed it just now. Treat this as a possible production outage first and a bot
problem second: check the container and the site before assuming the harness is at fault."
  fi

  case "$CAUSE" in
    timeout) WHY="Attempt 1 was killed at its ${TIMEOUT_MIN}m limit (exit 124) while still
working — it did not hang. The checklist may have outgrown the budget again; compare the
attempt durations in tonight's log against previous nights before raising it further." ;;
    yield)   WHY="The bot ended its turn before writing a report, which makes headless
\`claude -p\` exit 0 as if the work were done." ;;
    *)       WHY="The bot exited with code $ATTEMPT_RC before writing a report." ;;
  esac

  if [[ -n "$SKIPPED_RETRY" ]]; then
    WHY="$WHY

No retry was attempted: $SKIPPED_RETRY, and a retry finishing after the 6 AM digest would
have reported itself as missing anyway."
  fi

  if [[ "$RETRIED" == "1" ]]; then ATTEMPTS=" after 2 attempts"; else ATTEMPTS=""; fi

  REPORT="# FRT Bot Run — $RUN_DATE

## Status: FAIL (no report${ATTEMPTS})

Fingerprint: \`$FINGERPRINT\`.

$WHY

$APP_LINE

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
