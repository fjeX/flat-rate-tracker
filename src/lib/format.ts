// The one place hours become text.
//
// This file exists because there were three independent copies of the same
// one-line rounding function — lib/stats.ts, lib/dispute-pack.ts and
// components/pay-period/DisputePackPrint.tsx — and all three shared the same
// defect: a genuinely nonzero value that rounds below the display resolution
// printed as a flat "0.0". On the dispute pack that reads as "nothing
// happened" on a line where something did, in a document a tech hands to a
// service manager. Same bug class as the insights-zero-ratio-display
// escalation (resolved 2026-08-03); that fix only ever reached lib/insights.
//
// Hours are stored as numeric(5,2), so two decimals is the real resolution of
// the data and one decimal is a display convenience. Which of the two you want
// depends on whether the reader is glancing or auditing:
//
//   fmtHours  — 1dp, for the app UI. Glanceable. Never prints a bare zero for
//               a nonzero value; sub-resolution renders as "<0.1".
//   fmtHours2 — 2dp, exact, for documents. Rows add up to their totals on the
//               page, because every figure is shown at the resolution it is
//               stored at. Use this anywhere a reader may check the arithmetic.
//
// fmtHoursGrouped is fmtHours plus thousands separators, for four-digit
// lifetime totals. It is a wrapper, not a third rule — see its own note.

/** Display resolution of {@link fmtHours}: anything under this rounds to zero. */
export const HOURS_DISPLAY_STEP = 0.1;

/**
 * Hours for the app UI, to one decimal.
 *
 * A nonzero value too small to show at this resolution renders as "<0.1"
 * (or "-<0.1"), never "0.0" — a real zero and a rounded-away 0.02 must not be
 * the same string. A true zero still prints "0.0".
 */
export function fmtHours(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  if (rounded === 0 && n !== 0) return n > 0 ? "<0.1" : "-<0.1";
  return rounded.toFixed(1);
}

/**
 * Hours for external-facing documents, to two decimals — the resolution the
 * column is actually stored at.
 *
 * Exact by construction: a total shown with this equals the sum of its rows
 * shown with this, so a reader adding up the page always lands on the printed
 * total. No floor is needed because nothing is rounded away.
 */
export function fmtHours2(n: number): string {
  // Normalise -0 so a line that nets to zero never prints "-0.00".
  const v = Object.is(n, -0) ? 0 : n;
  return v.toFixed(2);
}

/**
 * Hours for the app UI with thousands grouping — `1,234.5` rather than
 * `1234.5`. Same semantics as {@link fmtHours} in every other respect; use it
 * only where a figure can plausibly reach four digits (career/lifetime totals).
 *
 * This composes {@link fmtHours} instead of reaching for `Intl` directly, which
 * is the mistake it replaces. Two call sites — CareerOdometerCard and
 * SnapshotSheet — each had a private `toLocaleString` with
 * `maximumFractionDigits: 1`. That agrees with fmtHours on every rounding case
 * (V8 formats from the shortest decimal representation, so 5.35 → "5.4" both
 * ways); what it does NOT have is the sub-resolution floor, so a career total
 * of 0.02 flag hours printed a flat "0.0" — the exact defect named at the top
 * of this file, on a card whose own second figure already called fmtHours.
 * Below the display resolution there is nothing to group, so fmtHours' own
 * "<0.1" is returned verbatim rather than re-worded.
 */
export function fmtHoursGrouped(n: number): string {
  const plain = fmtHours(n);
  if (plain.includes("<")) return plain;
  // `plain` is already rounded to the display resolution, so this only inserts
  // separators — Intl is never given the chance to round a second time.
  return Number(plain).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
