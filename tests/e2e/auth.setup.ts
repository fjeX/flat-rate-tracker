import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { AUTH_STATE } from "./fixtures";

/**
 * Produces tests/.auth/bot-state.json — the signed-in session every authed
 * visual test reuses. Two paths:
 *
 * 1. FRT_BOT_EMAIL + FRT_BOT_PASSWORD present (env or .env.bot.local):
 *    sign in through the real form and save fresh state.
 * 2. No credentials but a state file already exists (e.g. exported from a
 *    logged-in browser): verify it still works and keep it.
 *
 * Auth hits prod Supabase (that's what local dev points at) but only as the
 * bot account — the same account the nightly QA bot uses.
 */
setup("bot session", async ({ page }) => {
  const email = process.env.FRT_BOT_EMAIL;
  const password = process.env.FRT_BOT_PASSWORD;

  if (email && password) {
    await page.goto("/signin");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    fs.mkdirSync(path.dirname(AUTH_STATE), { recursive: true });
    await page.context().storageState({ path: AUTH_STATE });
    return;
  }

  if (fs.existsSync(AUTH_STATE)) {
    // No creds — validate the existing exported session instead.
    const ctx = await page.context().browser()!.newContext({ storageState: AUTH_STATE });
    const p = await ctx.newPage();
    await p.goto("http://localhost:3000/dashboard");
    await expect(p, "tests/.auth/bot-state.json is stale — set FRT_BOT_EMAIL/FRT_BOT_PASSWORD in .env.bot.local and rerun").toHaveURL(/dashboard/);
    await ctx.close();
    return;
  }

  throw new Error(
    "No bot credentials. Create .env.bot.local with FRT_BOT_EMAIL and FRT_BOT_PASSWORD " +
      "(same values as ~/.frt-bot.env on the VM), or export a signed-in session to tests/.auth/bot-state.json.",
  );
});
