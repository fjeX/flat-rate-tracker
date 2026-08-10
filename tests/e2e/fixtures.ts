import { test as base } from "@playwright/test";
import path from "node:path";

export const AUTH_STATE = path.join(__dirname, "../.auth/bot-state.json");

/**
 * Set when the suite is pointed at a container running FRT_FIXTURE_MODE=1.
 *
 * In that mode the server stubs auth outright, so there is no session to sign
 * in for and no bot-state.json to load — the authed routes render for anyone
 * who asks. Without this flag the authed specs would hit their
 * `skip(!existsSync(AUTH_STATE))` guard and quietly pass having tested nothing,
 * which is the worst possible outcome for a deploy gate.
 */
export const FIXTURE_TARGET = process.env.FRT_FIXTURE_TARGET === "1";

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
    if (FIXTURE_TARGET && baseURL) {
      await context.addCookies(
        FIXTURE_COOKIES.map((c) => ({ ...c, url: baseURL, path: "/" })),
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
