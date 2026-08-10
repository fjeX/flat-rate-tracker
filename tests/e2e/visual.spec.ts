import fs from "node:fs";
import { test, expect, AUTH_STATE, FIXTURE_TARGET } from "./fixtures";
import { ROUTES } from "./routes";

/**
 * Visual regression: every route × (dark|light) × (390px|1440px), driven by
 * the four projects in playwright.config.ts. Dynamic data (the bot account's
 * ROs, dates, charts) is masked per routes.ts; layout in masked regions is
 * still covered by quality.spec.ts.
 *
 * Accepting an intentional look change:  npm run test:ui:update
 */
for (const route of ROUTES) {
  test.describe(route.name, () => {
    // Against a fixture-mode container the server stubs auth, so there is no
    // session to load. Skipping on a missing AUTH_STATE there would silently
    // drop every authed route from a gate whose whole job is to check them.
    if (route.auth && !FIXTURE_TARGET) {
      test.skip(!fs.existsSync(AUTH_STATE), "no bot session — run auth setup");
      test.use({ storageState: AUTH_STATE });
    }

    test(`renders like the approved ${route.name}`, async ({ page }) => {
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
       * Against a fixture-mode container: mask nothing.
       *
       * Every selector in route.mask is there to hide data that churns — the
       * bot's nightly ROs, rolling dates, chart values. With the dataset and the
       * clock both pinned, none of it churns, so masking would only be throwing
       * away coverage. This is the actual payoff of the fixture work: /insights
       * and /account went from "mask the card interiors wholesale" to being
       * genuinely compared, numerals and all.
       *
       * Verified byte-identical across repeated renders before this was turned
       * on. If a specific region ever does prove unstable here, mask that one
       * selector with a comment saying what moves — don't restore the whole set.
       */
      await expect(page).toHaveScreenshot(`${route.name}.png`, {
        fullPage: true,
        mask: FIXTURE_TARGET ? [] : route.mask.map((sel) => page.locator(sel)),
        maskColor: "#3a3f4b",
      });
    });
  });
}
