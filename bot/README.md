# FRT Nightly Bot

A headless Claude Code instance that logs in to tracker.slimelab.cc every night
at 3 AM as the bot account, uses every feature (logs ROs, runs the timer,
reconciliation, spiffs, Pay Check-Up…), and emails Liem a report via n8n.

- **`INSTRUCTIONS.md`** — the bot's brain. Lives in this repo so `git pull` on
  the VM updates it. **When app features change, update this file** (the
  wrap-up skill has a step for it).
- **`FOCUS.md`** (optional, gitignored-friendly) — drop a note here to make the
  bot hammer a specific feature tonight. Delete it when done.
- **`run-bot.sh`** — the runner, called by cron on the VM.
- **`reports/`**, **`logs/`** — nightly output, gitignored, pruned after 90 days.

## VM setup (one time)

1. **Credentials file** — `~/.frt-bot.env`, locked down:
   ```bash
   cat > ~/.frt-bot.env <<'EOF'
   FRT_BOT_EMAIL=claude@email.com
   FRT_BOT_PASSWORD=<the password>
   N8N_BOT_WEBHOOK_URL=<production webhook URL from the n8n workflow>
   EOF
   chmod 600 ~/.frt-bot.env
   ```

2. **Claude Code on subscription, not API** — the runner unsets
   `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` so runs can only bill the plan.
   For headless cron runs, mint a subscription token once:
   ```bash
   claude setup-token
   ```
   and put the resulting `CLAUDE_CODE_OAUTH_TOKEN=...` line in `~/.frt-bot.env`
   (the runner sources it). If `claude -p "say hi"` works from a fresh shell
   without an API key set, you're on plan usage.

3. **Playwright MCP** (user scope, headless):
   ```bash
   claude mcp add playwright --scope user -- npx @playwright/mcp@latest --headless
   ```

4. **jq** — `sudo apt install -y jq` if missing.

5. **n8n workflow** — Webhook (POST, path `frt-bot-report`) → Email node reusing
   the nightly-health-check SMTP credentials. Subject: `{{$json.subject}}`,
   body: `{{$json.report}}`. Activate it, copy the **production** webhook URL
   into `~/.frt-bot.env`.

6. **Cron**:
   ```bash
   crontab -e
   # add:
   0 3 * * * /home/liem9319/docker/flat-rate-tracker/bot/run-bot.sh
   ```
   Check the VM timezone first (`timedatectl`) — 3 AM should be 3 AM Pacific.

7. **First run, supervised**: `bot/run-bot.sh` by hand, watch
   `bot/logs/$(date +%F).log`, confirm the email arrives.

## Safety rails

- Bot uses its own account — its data is isolated by RLS like any other user.
- The runner can only bill the Claude subscription, never a metered API key.
- The bot never deletes data from previous nights — everything accumulates as
  test data for verifying future features.
- 45-minute hard timeout per run.
