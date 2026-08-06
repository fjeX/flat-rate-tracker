import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SMOKE_AUTH_STATE } from "./fixtures";

/**
 * Signs in to the DEPLOYED site and saves session state for the smoke tests.
 *
 * Unlike tests/e2e/auth.setup.ts this never falls back to a pre-existing state
 * file. The smoke suite is a deploy gate: if it cannot prove it signed in to the
 * thing that was just deployed, it must fail loudly rather than test a stale
 * session against the wrong origin (prod and localhost don't share cookies).
 */
setup("smoke session", async ({ page, baseURL }) => {
  const email = process.env.FRT_BOT_EMAIL;
  const password = process.env.FRT_BOT_PASSWORD;

  expect(
    email && password,
    "FRT_BOT_EMAIL / FRT_BOT_PASSWORD missing — on the VM they come from ~/.frt-bot.env, " +
      "locally from .env.bot.local",
  ).toBeTruthy();

  await page.goto("/signin");
  await page.getByLabel(/email/i).fill(email!);
  await page.getByLabel(/password/i).fill(password!);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // Landing on /dashboard is the first real proof the deploy serves an authed
  // page at all — the exact thing `docker compose ps` cannot tell us.
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  fs.mkdirSync(path.dirname(SMOKE_AUTH_STATE), { recursive: true });
  await page.context().storageState({ path: SMOKE_AUTH_STATE });

  console.log(`[smoke] signed in to ${baseURL} as ${email!.replace(/(.{2}).*(@.*)/, "$1***$2")}`);
});
