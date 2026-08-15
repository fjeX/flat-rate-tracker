import { test, expect, watchForErrors, expectNoErrorBoundary } from "./fixtures";

/**
 * THE AUTH PATH — the thing neither the visual gate nor the write-smoke touches.
 *
 * On 2026-08-14 five real bugs shipped to production in a single day, every one
 * of them in auth, and not one was caught by tsc, eslint, 791 unit tests, the
 * 343-shot visual gate or the write-smoke:
 *
 *   1. /reset-password read only the query string, so an implicit-flow link and
 *      an expired link both rendered as "this page needs a reset link" —
 *      blaming the user for a token that had timed out.
 *   2. /forgot-password sat in AUTH_PAGES, so it bounced signed-in users to
 *      /dashboard. Clicking any reset link signs you in, so the first spent
 *      link made "request another one" unreachable. A real deadlock.
 *   3. Reset links were bound to the requesting browser (PKCE verifier cookie),
 *      so a link opened anywhere else was valid and unusable.
 *   4. signUp assumed a session, so with email confirmation on a new user
 *      bounced to /signin and read it as "signing up failed".
 *   5. The reset page had to be stopped from accepting an ORDINARY session —
 *      "signed in ⇒ show the form" would have re-opened the account-takeover
 *      path the current-password requirement had just closed.
 *
 * Every one of them is a page reachable in the wrong auth state, or copy that
 * lies about why something failed. That is what this file asserts.
 *
 * READ-ONLY. Unlike write.smoke.ts nothing here creates a user, sends mail, or
 * writes a row — so there is nothing to clean up and no email sent on every
 * deploy. The cases that genuinely need a mailbox (delivery, a live recovery
 * token) are deliberately absent; they cannot be automated from here and
 * pretending otherwise would be worse than the gap.
 */

// Copy assertions, kept in one place so a wording change is one edit and an
// accidental wording change is a visible diff.
const NEEDS_LINK = /this page needs a reset link/i;
const EXPIRED = /expired or has already been used/i;
const NEW_PASSWORD_FIELD = /new password/i;

// ───────────────────────────────────────────────────────────────────────────
// Signed OUT — storageState cleared for this block.
// ───────────────────────────────────────────────────────────────────────────
test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a protected route redirects to sign in", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/dashboard");
    // The single most important guard in the app: without it every authed page
    // is public. Asserting the landing URL rather than a status code, because
    // the redirect is what a user actually experiences.
    await expect(page).toHaveURL(/\/signin/);
    expect(errors.fatal, "fatal console errors on the signin redirect").toEqual([]);
  });

  test("/forgot-password is reachable and offers the form", async ({ page }) => {
    await page.goto("/forgot-password");
    await expectNoErrorBoundary(page, "/forgot-password");
    await expect(page.getByRole("button", { name: /send reset link/i })).toBeVisible();
  });

  test("the sign-in page links to password recovery", async ({ page }) => {
    // Bug 2's other half: the flow existed but nothing pointed at it. A reset
    // flow nobody can find is the same as no reset flow.
    await page.goto("/signin");
    await expect(page.getByRole("link", { name: /forgot your password/i })).toBeVisible();
  });

  test("/reset-password with NO token refuses to show the form", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByText(NEEDS_LINK)).toBeVisible();
    await expect(
      page.getByLabel(NEW_PASSWORD_FIELD),
      "a password form appeared without any recovery token",
    ).toHaveCount(0);
  });

  test("an expired link in the FRAGMENT says expired, not 'needs a link'", async ({ page }) => {
    // Bug 1, exactly as GoTrue delivers it on the implicit flow. Before the fix
    // this rendered NEEDS_LINK, which tells a locked-out user they did
    // something wrong rather than that their token aged out.
    await page.goto(
      "/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    await expect(page.getByText(EXPIRED)).toBeVisible();
    await expect(page.getByText(NEEDS_LINK)).toHaveCount(0);
    await expect(page.getByLabel(NEW_PASSWORD_FIELD)).toHaveCount(0);
  });

  test("an expired link in the QUERY STRING also says expired", async ({ page }) => {
    // The PKCE shape of the same failure. Both are live: the app sends implicit
    // now, but a link minted before that change still arrives this way.
    await page.goto(
      "/reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    await expect(page.getByText(EXPIRED)).toBeVisible();
    await expect(page.getByLabel(NEW_PASSWORD_FIELD)).toHaveCount(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Signed IN — inherits the smoke project's bot session.
// ───────────────────────────────────────────────────────────────────────────
test.describe("signed in", () => {
  test("/forgot-password does NOT bounce a signed-in user", async ({ page }) => {
    // Bug 2. Clicking any recovery link signs you in, so if this redirects, a
    // user whose first link is spent can never request a second one. The URL
    // assertion is the whole test — the form rendering is the consequence.
    await page.goto("/forgot-password");
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByRole("button", { name: /send reset link/i })).toBeVisible();
  });

  test("/reset-password refuses an ordinary session", async ({ page }) => {
    // Bug 5, and the most important assertion in this file.
    //
    // A signed-in visitor with no recovery token must NOT be offered a password
    // form. The obvious implementation — "there's a session, show the form" —
    // would let anyone at an unlocked machine set a new password without
    // knowing the old one, undoing the current-password requirement on
    // /account. The page must treat a session as worth nothing here; only a
    // recovery token counts.
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/reset-password/);
    await expect(
      page.getByLabel(NEW_PASSWORD_FIELD),
      "SECURITY: a signed-in user was offered a password reset form with no recovery token",
    ).toHaveCount(0);
    await expect(page.getByText(NEEDS_LINK)).toBeVisible();
  });

  test("/account requires the current password to change it", async ({ page }) => {
    // The fix for the original audit finding. If this field disappears, a live
    // session is once again enough to change the password and lock the owner
    // out — so its absence is a security regression, not a cosmetic one.
    const errors = watchForErrors(page);
    await page.goto("/account");
    await expectNoErrorBoundary(page, "/account");
    await expect(
      page.getByLabel(/current password/i),
      "SECURITY: the current-password field is gone from /account",
    ).toBeVisible();

    // NOT redundant, and not really about /account.
    //
    // Three assertions above use `getByLabel(NEW_PASSWORD_FIELD)).toHaveCount(0)`
    // to prove a password form is absent. A negative assertion passes just as
    // happily when the selector is wrong as when the form is genuinely gone, so
    // on its own it proves nothing. This pins the same locator against a page
    // that definitely HAS the field: if a markup change breaks the selector,
    // this fails loudly instead of letting the security assertions rot into
    // vacuous truths.
    await expect(
      page.getByLabel(NEW_PASSWORD_FIELD),
      "the NEW_PASSWORD_FIELD locator matches nothing — the toHaveCount(0) " +
        "assertions in this file are now vacuous and prove nothing",
    ).toBeVisible();

    expect(errors.fatal, "fatal console errors on /account").toEqual([]);
  });
});
