/**
 * Keys and helpers for the guest-mode session store.
 *
 * Both the guest store (writer) and GuestSyncEffect (reader) live off these
 * constants so the two can't drift apart — a renamed key on one side only
 * would silently strand every guest RO.
 */

/** Where guest ROs, op codes, timers and rate live for the life of the tab. */
export const GUEST_STORAGE_KEY = "frt_guest";

/**
 * Set only when the visitor explicitly asks to carry their guest work into an
 * account (the "Create a free account" hand-off in the guest banner).
 *
 * This is the consent gate for the sync. Guest data sitting in sessionStorage
 * is NOT permission to write it into whatever account the tab happens to be
 * signed into — a signed-in user who wanders through /guest to look around
 * would otherwise have that throwaway data land in their real history the
 * moment they returned to the dashboard.
 */
export const GUEST_CLAIM_KEY = "frt_guest_claim";

/** Called from the guest → sign-up hand-off. Safe in private-mode browsers. */
export function markGuestClaim(): void {
  try {
    sessionStorage.setItem(GUEST_CLAIM_KEY, "1");
  } catch {}
}

/** True only after an explicit hand-off from guest mode in this same tab. */
export function hasGuestClaim(): boolean {
  try {
    return sessionStorage.getItem(GUEST_CLAIM_KEY) === "1";
  } catch {
    return false;
  }
}

/** Clear both the claim and the data it authorized. */
export function clearGuestSession(): void {
  try {
    sessionStorage.removeItem(GUEST_STORAGE_KEY);
    sessionStorage.removeItem(GUEST_CLAIM_KEY);
  } catch {}
}
