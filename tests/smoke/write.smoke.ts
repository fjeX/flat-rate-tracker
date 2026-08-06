import {
  test,
  expect,
  watchForErrors,
  expectNoErrorBoundary,
  smokeRoNumber,
  SMOKE_RO_PATTERN,
  SMOKE_RO_PREFIX,
} from "./fixtures";

/**
 * THE WRITE PATH — the thing 343 passing UI tests never touched.
 *
 * Read the incident log and every app bug is a write bug:
 *   silent-save-fail (07-17)          save didn't persist, no error shown
 *   delete-list-refresh (07-17)       deleted RO stayed on the list until reload
 *   spiff-card-stale-refresh (07-19)  card stale after save until reload
 *   guest-mode-data-leak (07-28)      write landed in the wrong account
 *   stale dashboard (08-05)           dashboard stale after Quick Add
 *   import column drops (08-05)       write silently nulled columns
 *
 * Four of those are the same shape: the write SUCCEEDED and the UI didn't move.
 * So it is not enough to save and reload — a reload hides exactly the bug we
 * keep shipping. Every assertion below that says "without a reload" is load
 * bearing.
 *
 * This writes to the real account the nightly bot already uses, in the reserved
 * 9099xxxxx RO band, and cleans up after itself.
 */

test.describe.configure({ mode: "serial" });

test("save → appears live → persists → delete → leaves live", async ({ page }) => {
  const errors = watchForErrors(page);
  const roNumber = smokeRoNumber();
  // window.confirm gates the delete; Playwright dismisses dialogs by default.
  page.on("dialog", (d) => d.accept());

  // ── 1. Save an RO ────────────────────────────────────────────────────────
  await page.goto("/log");
  await expectNoErrorBoundary(page, "/log");

  const roInput = page.locator("#ro-number");
  await expect(roInput, "RO number input missing — /log did not render its form").toBeVisible();
  await roInput.fill(roNumber);

  // An RO needs at least one op code — saveEntry rejects with "Add at least one
  // op code." otherwise. Pick the first plain library code: entries reading
  // "select →" have sub-op-codes and open a second picker, and the footer items
  // create new codes, which a smoke test has no business doing.
  await page.locator("#opc-search").click();
  const opCode = page
    .locator(".opc-dropdown-item")
    .filter({ hasNotText: /select →|Other op code|Create new library|No matches/ })
    .first();
  await expect(opCode, "op code library is empty — cannot save an RO").toBeVisible({ timeout: 15_000 });
  await opCode.click();

  await page.getByRole("button", { name: /^Save RO$/ }).click();

  // The form refuses to navigate unless the persist returned a real row
  // (the silent-save-fail hardening), so leaving /log is itself a signal.
  await page.waitForURL((url) => !url.pathname.startsWith("/log"), { timeout: 30_000 });

  // A visible error means the save path threw — surface the message, don't just
  // fail on a URL timeout.
  const formError = page.locator("#ro-save-error, [role=alert]");
  if (await formError.count()) {
    const text = await formError.first().innerText().catch(() => "");
    expect(text.trim(), `save error shown: ${text}`).toBe("");
  }

  // ── 2. It shows up WITHOUT a reload ──────────────────────────────────────
  // This is the stale-UI class. Do not add a page.reload() here — a reload
  // makes this assertion pass against the exact bug it exists to catch.
  await expect(
    page.getByText(`#${roNumber}`).first(),
    `RO #${roNumber} saved but did not appear on ${new URL(page.url()).pathname} without a reload`,
  ).toBeVisible({ timeout: 20_000 });

  // ── 3. It really persisted (server round-trip, fresh navigation) ─────────
  await page.goto("/history");
  await expectNoErrorBoundary(page, "/history");
  await page.getByPlaceholder(/Search RO#/i).fill(roNumber);
  const row = page.locator(".history-ro-row", { hasText: roNumber });
  await expect(row.first(), `RO #${roNumber} not found in history — the save did not persist`).toBeVisible({
    timeout: 20_000,
  });

  // ── 4. Delete it, and confirm the list moves without a reload ────────────
  await row.first().click();
  const deleteButton = page.getByRole("button", { name: /^Delete$/ });
  await expect(deleteButton, "RO detail modal did not open").toBeVisible({ timeout: 15_000 });
  await deleteButton.click();

  await expect(
    page.locator(".history-ro-row", { hasText: roNumber }),
    `RO #${roNumber} deleted but stayed on the history list without a reload`,
  ).toHaveCount(0, { timeout: 20_000 });

  // ── 5. Nothing threw along the way ───────────────────────────────────────
  expect(errors.fatal, `write path console: ${errors.fatal.join(" | ")}`).toEqual([]);
  expect(errors.httpErrors, `write path 5xx: ${errors.httpErrors.join(" | ")}`).toEqual([]);
});

/**
 * Sweep any smoke ROs a crashed earlier run left behind. Not a correctness
 * check — hygiene, so the reserved band never accumulates junk in a real
 * account. Failures here are logged, never fatal: a stuck leftover row must not
 * roll back a good deploy.
 */
test("cleanup: no smoke ROs left behind", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("/history");
  await page.getByPlaceholder(/Search RO#/i).fill(SMOKE_RO_PREFIX);
  await page.waitForTimeout(2_000);

  let remaining = await page.locator(".history-ro-row").count();
  let guard = 0;
  while (remaining > 0 && guard++ < 10) {
    const first = page.locator(".history-ro-row").first();
    const label = await first.innerText().catch(() => "");
    if (!SMOKE_RO_PATTERN.test((label.match(/\d{9}/) || [""])[0])) break;
    await first.click();
    const del = page.getByRole("button", { name: /^Delete$/ });
    if (!(await del.isVisible().catch(() => false))) break;
    await del.click();
    await page.waitForTimeout(1_500);
    remaining = await page.locator(".history-ro-row").count();
  }

  if (remaining > 0) console.log(`[smoke] ${remaining} leftover smoke RO(s) still present`);
});
