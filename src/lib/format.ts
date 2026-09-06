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
//
// Money has the same two rules for the same reasons, and they live next to the
// hours ones so the pair can't drift apart again:
//
//   fmtMoney  — whole dollars, app UI. Stays in lib/earnings.ts where it has
//               always lived, and where its call sites already import it.
//   fmtMoney2 — 2dp, exact, for documents. Same contract as fmtHours2. Defined
//               here next to its hours twin and re-exported from lib/earnings
//               for callers that already import fmtMoney from there. The
//               re-export goes one way only (earnings → format); format must
//               never import from earnings or the two become a cycle.

/** Display resolution of {@link fmtHours}: anything under this rounds to zero. */
export const HOURS_DISPLAY_STEP = 0.1;

/**
 * Snap a float accumulation back to the resolution the data is actually stored
 * at (2dp — hours are `numeric(5,2)`, money is cents) before it is rounded for
 * display.
 *
 * Escalation `shortfall-one-decimal-float` (2026-09-06): every figure here
 * arrives as an unrounded `reduce` over floats, so `82.1 - 70.25` is
 * `11.849999999999994`, not `11.85`. Rounded straight to one decimal that lands
 * *below* the x.x5 boundary and prints `11.8` — the number is off by a tenth in
 * the shop's favour on a document whose whole job is to argue about tenths.
 * Snapping to 2dp first removes the binary dust and only the dust: at the
 * stored resolution `11.85` is a genuine half and rounds up, while a true
 * `330.75` still rounds to `330.8` exactly as before.
 */
function toStoredPrecision(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Hours for the app UI, to one decimal.
 *
 * A nonzero value too small to show at this resolution renders as "<0.1"
 * (or "-<0.1"), never "0.0" — a real zero and a rounded-away 0.02 must not be
 * the same string. A true zero still prints "0.0".
 */
export function fmtHours(n: number): string {
  const rounded = Math.round(toStoredPrecision(n) * 10) / 10;
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
  const snapped = toStoredPrecision(n);
  // Normalise -0 so a line that nets to zero never prints "-0.00". Snapping
  // can produce -0 from a tiny negative, so this has to come after it.
  const v = snapped === 0 ? 0 : snapped;
  return v.toFixed(2);
}

/**
 * Money for external-facing documents, to two decimals.
 *
 * The money twin of {@link fmtHours2}, and it exists for the identical reason
 * (escalation `disputepack-money-column-rounding`, 2026-09-06). Four rework
 * rows of 1.40/1.30/1.40/1.10h at $32 are 44.80/41.60/44.80/35.20 — at whole
 * dollars they print 45/42/45/35, which adds to $167, under a total of 166.40
 * printing as $166. Every one of those five figures is individually correct and
 * the page still contradicts itself, which is exactly what a service manager
 * needs to wave the claim off.
 *
 * Deliberately NOT a change to {@link fmtMoney}: whole dollars are the right
 * call on a period total or a spiff, where cents are noise and nobody is adding
 * the column up. Use this one only where a reader checks the arithmetic — the
 * dispute pack and the unpaid-rework audit rows.
 */
export function fmtMoney2(n: number): string {
  const snapped = toStoredPrecision(n);
  const v = snapped === 0 ? 0 : snapped;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
