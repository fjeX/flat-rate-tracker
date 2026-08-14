#!/usr/bin/env bash
# Exercises bot/run-bot.sh's failure classification with a stubbed `claude`.
# Nothing here touches the network or the real VM.
set -uo pipefail

SRC="$1"                       # path to the real run-bot.sh
ROOT="$(mktemp -d)"
# A deadline comfortably ahead of whenever this test runs, so the retry path is
# actually exercised instead of being correctly skipped as too late.
FUTURE="$(date -d "+3 hours" +%H:%M)"
PASS=0; FAIL=0

check() { # check <label> <needle> <file>
  if grep -qF -- "$2" "$3"; then
    echo "  ok   — $1"; PASS=$((PASS+1))
  else
    echo "  FAIL — $1 (expected to find: $2)"; FAIL=$((FAIL+1))
  fi
}
check_not() {
  if grep -qF -- "$2" "$3"; then
    echo "  FAIL — $1 (should NOT contain: $2)"; FAIL=$((FAIL+1))
  else
    echo "  ok   — $1"; PASS=$((PASS+1))
  fi
}

# scenario <name> <rc1> <writes1> <rc2> <writes2> <app_code> [finish_by]
scenario() {
  local name="$1" rc1="$2" w1="$3" rc2="$4" w2="$5" app="$6" finish="${7:-$FUTURE}"
  local d="$ROOT/$name"
  mkdir -p "$d/repo/bot/reports" "$d/repo/bot/logs" "$d/bin" "$d/home"
  cp "$SRC" "$d/repo/bot/run-bot.sh"; chmod +x "$d/repo/bot/run-bot.sh"

  cat >"$d/home/.frt-bot.env" <<EOF
FRT_BOT_EMAIL=t@t.t
FRT_BOT_PASSWORD=x
N8N_BOT_WEBHOOK_URL=http://localhost:1/hook
EOF

  # `claude` stub: nth invocation uses the nth rc/writes pair.
  cat >"$d/bin/claude" <<EOF
#!/usr/bin/env bash
N_FILE="$d/attempts"
n=\$(( \$(cat "\$N_FILE" 2>/dev/null || echo 0) + 1 ))
echo "\$n" > "\$N_FILE"
if [[ "\$n" == "1" ]]; then rc=$rc1; w=$w1; else rc=$rc2; w=$w2; fi
if [[ "\$w" == "1" ]]; then
  printf '# FRT Bot Run\n\n## Status: PASS\n\nall good\n' > "$d/repo/bot/reports/\$(date +%F).md"
fi
exit \$rc
EOF
  chmod +x "$d/bin/claude"

  # curl stub: app probe returns \$app; the webhook POST just succeeds.
  cat >"$d/bin/curl" <<EOF
#!/usr/bin/env bash
for a in "\$@"; do [[ "\$a" == "%{http_code}" ]] && { echo "$app"; exit 0; }; done
exit 0
EOF
  chmod +x "$d/bin/curl"

  # jq stub: the payload isn't under test here.
  # Must NOT read stdin: as the head of the pipeline it inherits the caller's
  # stdin, and a `cat` there never sees EOF.
  cat >"$d/bin/jq" <<JQEOF
#!/usr/bin/env bash
printf '%s\\n' "\$@" > "$d/payload"
echo "{}"
JQEOF
  chmod +x "$d/bin/jq"

  echo "== $name =="
  HOME="$d/home" PATH="$d/bin:$PATH" FRT_BOT_FINISH_BY="$finish" \
    FRT_BOT_TIMEOUT_MIN=20 "$d/repo/bot/run-bot.sh" >"$d/stdout" 2>&1 </dev/null

  LOG="$d/repo/bot/logs/$(date +%F).log"
  ATTEMPTS="$(cat "$d/attempts" 2>/dev/null || echo 0)"
  echo "  (attempts: $ATTEMPTS)"
}

# 1. Clean pass on the first attempt.
scenario pass 0 1 0 1 200
check "no runner note on a clean pass" "run complete: status=PASS" "$ROOT/pass/repo/bot/logs/$(date +%F).log"
[[ "$(cat "$ROOT/pass/attempts")" == "1" ]] \
  && { echo "  ok   — did not retry"; PASS=$((PASS+1)); } \
  || { echo "  FAIL — retried a passing run"; FAIL=$((FAIL+1)); }

# 2. Timeout, then a passing retry: must be labelled timeout, NOT hang.
scenario timeout_then_pass 124 0 0 1 200
LOG="$ROOT/timeout_then_pass/repo/bot/logs/$(date +%F).log"
check "timeout gets its own fingerprint" "bot-runner-timeout" "$LOG"
check_not "timeout is not mislabelled as a hang" "bot-runner-hang" "$LOG"
check "retry ran" "retrying with" "$LOG"
check "retry is told it was a timeout, not a hang" "(timeout)" "$LOG"
[[ "$(cat "$ROOT/timeout_then_pass/attempts")" == "2" ]]   && { echo "  ok   — really ran twice"; PASS=$((PASS+1)); }   || { echo "  FAIL — did not actually retry"; FAIL=$((FAIL+1)); }

# 3. Yielded turn (exit 0, no report) keeps the original fingerprint.
scenario yield_then_pass 0 0 0 1 200
LOG="$ROOT/yield_then_pass/repo/bot/logs/$(date +%F).log"
check "yielded turn is still bot-runner-hang" "bot-runner-hang" "$LOG"
check_not "yield is not called a timeout" "bot-runner-timeout" "$LOG"

# 4. Crash gets a third fingerprint.
scenario crash 1 0 1 0 200
check "non-zero, non-124 exit is a crash" "bot-runner-crash" "$ROOT/crash/repo/bot/logs/$(date +%F).log"

# 5. Both attempts fail while the app is healthy → harness verdict.
scenario fail_app_up 0 0 0 0 200
check "app probe recorded" "app probe:" "$ROOT/fail_app_up/repo/bot/logs/$(date +%F).log"
check "healthy app still gets the harness verdict" "an FRT application failure" "$ROOT/fail_app_up/payload"
check_not "healthy app is not called an outage" "possible production outage" "$ROOT/fail_app_up/payload"

# 6. Both attempts fail AND the app is down → must NOT reassure.
scenario fail_app_down 0 0 0 0 503
check "records the bad status code" "-> 503" "$ROOT/fail_app_down/repo/bot/logs/$(date +%F).log"
check "emailed report warns about a possible outage" "possible production outage" "$ROOT/fail_app_down/payload"
check_not "does not reassure while the app is down" "an FRT application failure" "$ROOT/fail_app_down/payload"

# 7. Past the digest deadline → no pointless retry.
scenario past_deadline 124 0 0 1 200 00:01
LOG="$ROOT/past_deadline/repo/bot/logs/$(date +%F).log"
check "retry skipped past the deadline" "SKIPPING retry" "$LOG"
[[ "$(cat "$ROOT/past_deadline/attempts")" == "1" ]] \
  && { echo "  ok   — really only ran once"; PASS=$((PASS+1)); } \
  || { echo "  FAIL — retried anyway"; FAIL=$((FAIL+1)); }

echo
echo "passed: $PASS   failed: $FAIL"
[[ "$FAIL" == "0" ]] || exit 1
