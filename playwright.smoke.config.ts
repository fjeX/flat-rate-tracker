import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * DEPLOY SMOKE — separate from the UI regression suite in playwright.config.ts.
 *
 * That suite is read-only: it navigates to routes and asserts layout and pixels.
 * Every production bug in ~/frt-ops/incident-log.md is a WRITE bug — a save that
 * silently didn't persist, a delete that stayed on the list, a card that went
 * stale after a save, an authed render that threw. 343 passing UI tests never had
 * a chance at any of them, because not one of them writes.
 *
 * This config runs a small suite that DOES write, against the deployed site, as
 * the bot account, after the container is up. It is the last gate before a
 * deploy is considered good — scripts/deploy.sh rolls the image back if it fails.
 *
 * Target: SMOKE_BASE_URL (default https://tracker.slimelab.cc). No webServer —
 * we are testing something already running, never something we start.
 */

// Credentials: env first (the VM exports them from ~/.frt-bot.env), then the
// gitignored local file used by the UI suite.
//
// THE VALUE HAS TO BE UNESCAPED, NOT READ LITERALLY.
// These files are written to be `source`d by a shell — deploy.sh does exactly
// that (`set -a; source "$BOT_ENV"`). A password containing $ & or ! is stored
// backslash-escaped, and the shell strips those backslashes on the way in. The
// old regex here took the raw text instead, so a local run built an 18-char
// string for a 16-char password and every smoke test failed at sign-in with
// "Incorrect email or password."
//
// It never showed up on the VM because deploy.sh sources the file first and
// process.env wins below — so the one path that was broken is the one a person
// uses to run the suite by hand, which is also the path that would have caught
// today's auth bugs before they shipped.
function parseShellEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key] = m;
    let value = m[2].trim();

    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      // Single quotes are literal in the shell — no unescaping at all.
      value = value.slice(1, -1);
    } else {
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        value = value.slice(1, -1);
      }
      // Unquoted or double-quoted: a backslash escapes the next character.
      value = value.replace(/\\(.)/g, "$1");
    }
    out[key] = value;
  }
  return out;
}

const envFile = path.join(__dirname, ".env.bot.local");
if (fs.existsSync(envFile)) {
  const parsed = parseShellEnv(fs.readFileSync(envFile, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

export const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL || "https://tracker.slimelab.cc";

export default defineConfig({
  testDir: "./tests/smoke",
  outputDir: "./tests/smoke/.results",
  // Serial. These tests write to a real account; parallel runs would race each
  // other's rows and the failure would look like an app bug.
  fullyParallel: false,
  workers: 1,
  // One retry. A false failure here rolls back good code, so a network blip
  // shouldn't be fatal — but a genuine break fails both attempts. Retries are
  // reported, so a flaky pass stays visible instead of reading as clean.
  retries: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: SMOKE_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Prod is slower than localhost; give real network room.
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "smoke-setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "smoke",
      testMatch: /.*\.smoke\.ts/,
      dependencies: ["smoke-setup"],
      use: { storageState: path.join(__dirname, "tests/.auth/smoke-state.json") },
    },
  ],
});
