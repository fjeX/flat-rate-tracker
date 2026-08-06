import { test as base, expect, type Page } from "@playwright/test";
import path from "node:path";

export const SMOKE_AUTH_STATE = path.join(__dirname, "../.auth/smoke-state.json");

/**
 * Disposable RO numbers live in a reserved band so a leftover from a crashed run
 * is always identifiable and never collides with a real RO or with the nightly
 * bot's numbers (it uses 77xxx / 99xxx five-digit values).
 *
 * RO numbers are NOT unique in FRT (see memory/project_ro_numbers_not_unique.md)
 * — a repeat opens the duplicate dialog mid-save, which would look like a smoke
 * failure. Deriving from the clock keeps every run's number fresh.
 */
export const SMOKE_RO_PREFIX = "9099";
export function smokeRoNumber(): string {
  return `${SMOKE_RO_PREFIX}${String(Date.now() % 100_000).padStart(5, "0")}`;
}
export const SMOKE_RO_PATTERN = new RegExp(`^${SMOKE_RO_PREFIX}\\d{5}$`);

/**
 * Error signatures worth failing a deploy over.
 *
 * The first one is today's bug (2026-08-05): a `"use server"` re-export shipped a
 * ReferenceError that threw on first render of every page importing the module,
 * including saving an RO. In production React omits the real message, so the
 * generic Server Components string IS the signature — see
 * memory/reference_frt_use_server_gotchas.md.
 */
const FATAL_CONSOLE = [
  /An error occurred in the Server Components render/i,
  /ReferenceError/i,
  /Minified React error #4(18|22|23)/i, // hydration mismatch family
  /Application error: a (client|server)-side exception/i,
];

/**
 * Known-benign and deliberately NOT fatal: "Failed to find Server Action" is a
 * stale-deploy artifact that self-clears on refresh (logged BENIGN 07-14, 07-23,
 * 07-26). Failing on it would roll back good code for a browser-cache problem.
 */
const BENIGN_CONSOLE = [/Failed to find Server Action/i];

export type PageErrors = {
  fatal: string[];
  benign: string[];
  httpErrors: string[];
};

/** Attach console/network/pageerror collection to a page. */
export function watchForErrors(page: Page): PageErrors {
  const errors: PageErrors = { fatal: [], benign: [], httpErrors: [] };

  const classify = (text: string) => {
    if (BENIGN_CONSOLE.some((re) => re.test(text))) errors.benign.push(text);
    else if (FATAL_CONSOLE.some((re) => re.test(text))) errors.fatal.push(text);
  };

  page.on("console", (msg) => {
    if (msg.type() === "error") classify(msg.text());
  });
  // Uncaught exceptions never reach console listeners — collect them separately.
  page.on("pageerror", (err) => classify(`${err.name}: ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 500) errors.httpErrors.push(`${res.status()} ${res.url()}`);
  });

  return errors;
}

/**
 * Assert a page rendered rather than error-boundaried. Next's production error
 * boundary renders visible text; a container that is "Up" while every authed
 * route throws still passes `docker compose ps`, which is exactly how today's
 * bug reached production.
 */
export async function expectNoErrorBoundary(page: Page, label: string) {
  const boundary = page.getByText(
    /Application error|An error occurred in the Server Components render|This page could not be found/i,
  );
  await expect(boundary, `${label}: error boundary rendered`).toHaveCount(0);
}

export const test = base;
export { expect };
