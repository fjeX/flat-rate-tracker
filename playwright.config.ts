import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Optional local credentials for the auth setup step (gitignored).
// Format: KEY=value lines. Same keys as the VM's ~/.frt-bot.env.
const envFile = path.join(__dirname, ".env.bot.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/**
 * UI regression matrix: dark + light × mobile (390) + desktop (1440).
 * Project names are parsed by tests/e2e/fixtures.ts to apply the theme,
 * so keep the `{theme}-{width}` naming.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./tests/e2e/.results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "tests/e2e/.report", open: "never" }]],
  expect: {
    toHaveScreenshot: {
      // Small anti-flake allowance; real layout shifts blow way past this.
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL: "http://localhost:3000",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 90_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "dark-mobile", dependencies: ["setup"], use: { viewport: MOBILE, isMobile: true, hasTouch: true } },
    { name: "dark-desktop", dependencies: ["setup"], use: { viewport: DESKTOP } },
    { name: "light-mobile", dependencies: ["setup"], use: { viewport: MOBILE, isMobile: true, hasTouch: true } },
    { name: "light-desktop", dependencies: ["setup"], use: { viewport: DESKTOP } },
  ],
});
