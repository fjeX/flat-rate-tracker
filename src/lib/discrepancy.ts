// Pure pay-discrepancy verdict math, extracted from DiscrepancyCard.tsx so it
// can be unit-tested in isolation (the component is now render-only).
//
// A "verdict" compares the flag hours the shop actually PAID for a pay period
// against the flag hours the tech LOGGED. Within a small tolerance the two are
// treated as a match; otherwise the tech was either short-paid ("missing") or
// over-paid ("over"). A null paid value means the tech hasn't entered it yet.

// Hours can differ by rounding on the pay stub, so treat anything within this
// many flag hours as an exact match.
export const TOLERANCE = 0.1;

export type Verdict = "missing" | "over" | "match" | "unknown";

// Render helper: a null number becomes an empty input string.
export function toText(n: number | null): string {
  return n === null ? "" : String(n);
}

// Parse a free-text hours input into a non-negative number, or null when the
// field is blank / not a valid non-negative number.
export function parseHours(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// The core verdict. paid === null => "unknown". Otherwise compare against the
// logged total within TOLERANCE.
export function verdictFor(paid: number | null, logged: number): Verdict {
  if (paid === null) return "unknown";
  const diff = paid - logged;
  if (Math.abs(diff) <= TOLERANCE) return "match";
  return diff < 0 ? "missing" : "over";
}
