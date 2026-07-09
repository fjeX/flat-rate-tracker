import fs from "node:fs";
import { test, expect, AUTH_STATE } from "./fixtures";
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
    if (route.auth) {
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
      await expect(page).toHaveScreenshot(`${route.name}.png`, {
        fullPage: true,
        mask: route.mask.map((sel) => page.locator(sel)),
        maskColor: "#3a3f4b",
      });
    });
  });
}
