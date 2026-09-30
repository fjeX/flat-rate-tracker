// RO numbers are digits only. Decided 2026-09-29 (phase 4): 0 of 1436 stored
// ROs had a non-digit, and a stray letter or dash is what makes the duplicate
// check miss. One rule, shared by the Log RO form, Quick Add and the server
// schema (src/lib/validation/actions.ts), so client and server agree.
//
// NOT applied to the import/backup path: that restores what was already stored.

/** Trimmed, at least one character, digits only. */
export const RO_DIGITS_RE = /^\d+$/;

/** Server-side refusal sentence (the client shows the FIX copy below). */
export const RO_DIGITS_ERROR = "RO numbers are digits only. Take out the letters, then save.";

export type RoNumberState = "empty" | "invalid" | "ok";

export function roNumberState(raw: string): RoNumberState {
  const v = raw.trim();
  if (v === "") return "empty";
  return RO_DIGITS_RE.test(v) ? "ok" : "invalid";
}

/** The save-bar / footer text when the RO blocks saving; null when it doesn't. */
export function roBlockedStatus(state: RoNumberState): string | null {
  if (state === "empty") return "Fill in RO # to save";
  if (state === "invalid") return "Fix the RO # to save";
  return null;
}
