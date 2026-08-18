import { test, expect } from "./fixtures";
import { ROUTES } from "./routes";
import { FIXTURE_NOW_ISO } from "@/lib/fixtures/enabled";

/**
 * Visual regression: every route × (dark|light) × (390px|1440px), driven by the
 * four projects in playwright.visual.config.ts.
 *
 * Runs against a container in FRT_FIXTURE_MODE — frozen dataset, frozen clock,
 * stubbed auth — so nothing masks and nothing drifts. A diff here means the
 * design moved.
 *
 * Accepting an intentional change:  ./scripts/update-baselines.sh   (VM only)
 */
for (const route of ROUTES) {
  test.describe(route.name, () => {
    test(`renders like the approved ${route.name}`, async ({ page }) => {
      /**
       * Pin the BROWSER's clock too, not just the server's.
       *
       * `src/instrumentation.ts` overrides the Date constructor in the server
       * process, which covers every server-rendered route. It does not reach
       * the browser, and FRT_FIXTURE_MODE is deliberately server-only (not a
       * NEXT_PUBLIC_ var, so one image serves prod and the canary) — so the
       * client bundle cannot know it is in a frozen world.
       *
       * The guest routes are `"use client"` and derive "today" in the browser
       * (`guest/history/page.tsx` → `isoDate()` → `new Date()`), so they read
       * the REAL calendar. guest-history renders the current pay period, which
       * meant the baseline went stale on its own every 1st and 16th: captured
       * 2026-08-13 showing "AUG 1 – AUG 15", it passed on the 14th and 15th and
       * started failing on the 16th when the period rolled. Twenty-four
       * unexplained red gates a year is how a gate becomes a rubber stamp —
       * the exact death the fixture dataset was built to prevent.
       *
       * setFixedTime, NOT install(): install() fakes the timers as well, and
       * `networkidle` / `document.fonts.ready` below would never settle.
       */
      await page.clock.setFixedTime(new Date(FIXTURE_NOW_ISO));
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");
      // dev server compiles CSS on demand — never snapshot an unstyled page
      await page.waitForFunction(
        () => getComputedStyle(document.documentElement).getPropertyValue("--tap-min").trim() === "44px",
        undefined,
        { timeout: 15_000 },
      );
      // settle fonts + entrance state
      await page.evaluate(() => document.fonts.ready);
      // the Next dev-tools badge (nextjs-portal) blinks in and out — never
      // let it into a baseline
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      /**
       * No mask. The selector list this used to carry existed purely to hide the
       * bot account's churning data; with the data and the clock both pinned
       * there is nothing left that legitimately moves, and masking would only
       * throw away coverage. /insights went from "mask the card interiors
       * wholesale" to being compared numerals and all.
       *
       * If some region ever does prove unstable, mask that ONE selector with a
       * comment naming what moves — don't reintroduce a blanket list.
       */
      await expect(page).toHaveScreenshot(`${route.name}.png`, { fullPage: true });
    });
  });
}
