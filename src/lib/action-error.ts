// What to show a user when a Server Action call throws.
//
// Bug report 33cbab9e: a tab left open across a redeploy still holds the OLD
// build's Server Action IDs. Next.js regenerates those IDs on every build, so
// the next save from that tab fails with
//
//   Server Action "6089742b…" was not found on the server. Read more: …
//
// and the raw message was being pasted straight into the form's error slot.
// The data is fine (nothing was sent), the fix is a reload, and the user has
// no way to know that from the text. Every catch block that used to do
// `err instanceof Error ? err.message : fallback` goes through here instead,
// so a stale tab gets told what actually happened and what to do.
//
// The reload is deliberately NOT automatic from inside a form — the user may
// have a half-typed RO in front of them and a reload throws that away. The
// error boundaries (app/error.tsx) do reload, because by the time an action
// error escapes to a boundary there is no form left to protect.

export const STALE_DEPLOY_MESSAGE =
  "The app was updated while this tab was open. Reload the page and try again — nothing was lost.";

/** True when the error is Next.js rejecting a Server Action ID from an older build. */
export function isStaleDeployError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return (
    /Server Action .* was not found on the server/i.test(message) ||
    /failed-to-find-server-action/i.test(message) ||
    /Server Reference ID did not match the expected format/i.test(message)
  );
}

/**
 * The message for a failed action: the stale-deploy explanation when that is
 * what happened, otherwise the error's own message, otherwise `fallback`.
 */
export function actionErrorMessage(err: unknown, fallback: string): string {
  if (isStaleDeployError(err)) return STALE_DEPLOY_MESSAGE;
  return err instanceof Error ? err.message : fallback;
}
