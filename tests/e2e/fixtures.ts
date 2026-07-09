import { test as base } from "@playwright/test";
import path from "node:path";

export const AUTH_STATE = path.join(__dirname, "../.auth/bot-state.json");

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
  context: async ({ context }, use, testInfo) => {
    const theme = testInfo.project.name.startsWith("light") ? "light" : "dark";
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
