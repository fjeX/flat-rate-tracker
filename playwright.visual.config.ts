import { defineConfig } from "@playwright/test";

/**
 * Visual regression against the CANARY — the freshly built image running in
 * fixture mode on a loopback scratch port, before any traffic swaps to it.
 *
 * HOW THIS DIFFERS FROM playwright.config.ts
 * The local config boots `npm run dev` and signs into prod Supabase as the bot
 * account. That has two problems for a deploy gate: it snapshots the dev server
 * rather than the image that ships, and it renders live data that changes every
 * night, so the baselines rot on their own. This config points at a running
 * container serving frozen data at a frozen instant, so a diff here means the
 * design moved — nothing else can move.
 *
 * NO webServer BLOCK, on purpose — same rule playwright.smoke.config.ts follows:
 * we test something already running, never something the test harness started.
 * deploy.sh owns the canary's lifecycle.
 *
 * NO setup PROJECT — fixture mode stubs auth server-side, so there is no sign-in
 * step and no storage state. FRT_FIXTURE_TARGET tells the specs to skip their
 * auth-state guard (see tests/e2e/fixtures.ts).
 */
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const CANARY_URL = process.env.FRT_CANARY_URL ?? "http://127.0.0.1:3001";

process.env.FRT_FIXTURE_TARGET = "1";

export default defineConfig({
  testDir: "./tests/e2e",
  // The sign-in setup is meaningless against a stubbed-auth container.
  testIgnore: /auth\.setup\.ts/,
  outputDir: "./tests/e2e/.results",
  /**
   * The canary keeps its own baseline set, separate from the local suite's.
   *
   * They are not interchangeable: the local suite renders the bot account's
   * live data on the dev server, this one renders fixture data from the
   * production build. Same route, legitimately different pixels. Sharing a
   * directory would mean the only thing telling them apart is Playwright's
   * platform suffix — and the day someone runs the local config on Linux, it
   * would compare live data against frozen baselines and fail for no reason.
   *
   * No {platform} token here on purpose: the canary always renders inside the
   * same pinned Playwright container, so one set of images is correct
   * everywhere — the VM, a laptop, CI. That is what makes this runnable off the
   * PC at all.
   */
  snapshotPathTemplate: "./tests/e2e/__canary__/{arg}-{projectName}{ext}",
  fullyParallel: true,
  forbidOnly: true,
  // Deterministic input means a retry cannot turn a real failure into a pass.
  // If this ever needs retries, the determinism is broken — fix that instead.
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "tests/e2e/.report", open: "never" }]],
  expect: {
    toHaveScreenshot: {
      // Tighter than the local config's 0.01. With the data frozen there is no
      // legitimate churn left to absorb, so the allowance only needs to cover
      // antialiasing noise. A loose threshold here would let real regressions
      // through — that slack was only ever paying for live-data drift.
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL: CANARY_URL,
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "dark-mobile", use: { viewport: MOBILE, isMobile: true, hasTouch: true } },
    { name: "dark-desktop", use: { viewport: DESKTOP } },
    { name: "light-mobile", use: { viewport: MOBILE, isMobile: true, hasTouch: true } },
    { name: "light-desktop", use: { viewport: DESKTOP } },
  ],
});
