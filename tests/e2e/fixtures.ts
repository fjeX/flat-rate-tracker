import { test as base } from "@playwright/test";

/**
 * Shared setup for the canary suite.
 *
 * There is exactly one way to run these specs now: `playwright.visual.config.ts`
 * against a container started with FRT_FIXTURE_MODE=1. The old local config that
 * signed into prod as the bot account is gone, along with its bot-state.json
 * plumbing — the server stubs auth in fixture mode, so there is no session to
 * load and nothing to sign in to.
 */

/**
 * Pinned so "today" is computed identically on every machine. The app derives
 * the date from the frt_timezone cookie; with it unset the server falls back to
 * its own locale, which in a container is UTC — and a run started at 4:30pm PST
 * would snapshot tomorrow's date. Frozen clock + fixed zone, or it still drifts.
 */
const FIXTURE_COOKIES = [
  { name: "frt_timezone", value: "America/Los_Angeles" },
  { name: "frt_week_start", value: "0" },
];

type UiFixtures = {
  theme: "dark" | "light";
};

/**
 * Applies the theme encoded in the project name (`dark-mobile`, `light-desktop`…)
 * before any page script runs, so the <head> theme script paints the right
 * theme on first render — same mechanism a real user's saved preference uses.
 */
export const test = base.extend<UiFixtures>({
  theme: [
    async ({}, use, testInfo) => {
      await use(testInfo.project.name.startsWith("light") ? "light" : "dark");
    },
    { auto: false },
  ],
  context: async ({ context, baseURL }, use, testInfo) => {
    const theme = testInfo.project.name.startsWith("light") ? "light" : "dark";
    if (baseURL) {
      // `url` and `path` are mutually exclusive here — passing both is rejected
      // with "Cookie should have either url or path". url implies path "/".
      await context.addCookies(
        FIXTURE_COOKIES.map((c) => ({ ...c, url: baseURL })),
      );
      /**
       * Seal the browser off from the real Supabase.
       *
       * FRT_FIXTURE_MODE only swaps the SERVER client. NEXT_PUBLIC_SUPABASE_URL
       * is baked into the client bundle at build time, so any client component
       * that queries on mount would still reach prod — pulling live data into a
       * supposedly frozen snapshot, and writing to prod from a screenshot test
       * if it ever POSTed. Failing the request keeps the page on whatever the
       * server rendered, which is the frozen state we mean to photograph.
       */
      await context.route(/api\.slimelab\.cc/, (route) => route.abort());
    }
    await context.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
        if (t === "light") document.documentElement.classList.add("theme-light");
        else document.documentElement.classList.remove("theme-light");
      } catch {}
    }, theme);
    await use(context);
  },
});

export { expect } from "@playwright/test";
