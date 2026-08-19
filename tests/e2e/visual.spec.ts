import { test, expect } from "./fixtures";
import { ROUTES } from "./routes";

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
    test(`renders like the approved ${route.name}`, async ({ page, theme }) => {
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
       * Prove the theme BEFORE comparing pixels.
       *
       * A light project that lost its theme class photographs a dark page and
       * the snapshot still passes — it just quietly becomes a second copy of
       * the dark baseline. settings-light-* and dispute-pack-light-* were
       * byte-identical to their dark counterparts from the first baseline
       * commit: React recovered a hydration mismatch by re-rendering from the
       * root, which rewrote <html className> from the server prop and dropped
       * the class the <head> theme script had added. Four weeks of light
       * coverage that proved nothing, and no pixel assertion can see it.
       *
       * `not.toHaveClass` goes vacuous the moment the locator or the class read
       * stops working — it passes for "genuinely dark" and for "looking at the
       * wrong thing" alike. So the dark branch is fenced by a positive control
       * on the SAME locator: `antialiased` comes from the root layout's own
       * className and is present in both themes (it survives the wipe, which is
       * exactly why it is a control and not a second theme check). If the
       * instrument breaks, every project fails instead of half of them going
       * quiet.
       */
      const html = page.locator("html");
      await expect(
        html,
        "positive control failed: <html> class list is unreadable, so the dark-mode theme assertion below would be vacuous",
      ).toHaveClass(/(^|\s)antialiased(\s|$)/);
      if (theme === "light") {
        await expect(
          html,
          "light project rendered without theme-light — the theme class was wiped (hydration recovery?), so this snapshot would be a dark page",
        ).toHaveClass(/(^|\s)theme-light(\s|$)/);
      } else {
        await expect(
          html,
          "dark project rendered WITH theme-light",
        ).not.toHaveClass(/(^|\s)theme-light(\s|$)/);
      }
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
