import { test, expect, watchForErrors, expectNoErrorBoundary } from "./fixtures";
import { ROUTES } from "../e2e/routes";

/**
 * Does every route actually RENDER on the deployed build?
 *
 * The old deploy check was `docker compose ps` showing "Up", plus at most a curl
 * of `/`. On 2026-08-05 a `"use server"` re-export threw a ReferenceError on the
 * first render of every page importing that module — saving an RO included. The
 * container reported Up. `/` returned 200, because the public landing page never
 * imports it. Every authenticated page was dead.
 *
 * Reusing ROUTES from the UI suite is deliberate: one list, so a new route added
 * for a visual test is smoke-covered the same day it ships. The day-one bug
 * cluster in the incident log (/insights 3 bugs its first night, the mini-timer
 * pip 2, dispute-tracking 2) is what uncovered-new-surface looks like.
 */
test.describe("render health", () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path}) renders clean`, async ({ page }) => {
      const errors = watchForErrors(page);

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
      expect(response, `${route.path}: no response`).toBeTruthy();
      expect(response!.status(), `${route.path} returned ${response!.status()}`).toBeLessThan(400);

      // An authed route that bounces to /signin means the session broke, which
      // is itself a deploy failure worth catching.
      if (route.auth) {
        expect(page.url(), `${route.path} redirected to signin — auth broken`).not.toMatch(/\/signin/);
      }

      await page.waitForLoadState("networkidle").catch(() => {});
      await expectNoErrorBoundary(page, route.path);

      // Real content separates "rendered" from "served an empty shell". Prefer
      // <main>, but the dispute-pack print sheet is a bare document with no
      // <main> at all — asserting on a missing element would fail every deploy
      // for a page that is working fine.
      const scope = (await page.locator("main").count()) > 0 ? page.locator("main").first() : page.locator("body");
      const bodyText = await scope.innerText().catch(() => "");
      expect(bodyText.trim().length, `${route.path}: rendered no content`).toBeGreaterThan(0);

      expect(errors.fatal, `${route.path} console: ${errors.fatal.join(" | ")}`).toEqual([]);
      expect(errors.httpErrors, `${route.path} 5xx: ${errors.httpErrors.join(" | ")}`).toEqual([]);

      if (errors.benign.length) {
        console.log(`[smoke] ${route.path} benign: ${errors.benign.join(" | ")}`);
      }
    });
  }
});
