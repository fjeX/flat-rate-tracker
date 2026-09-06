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
//               page, because hours ARE stored at 2dp, so nothing is rounded
//               away. Use this anywhere a reader may check the arithmetic.
//
// That last claim is true of hours and FALSE of money, which is the trap this
// file fell into once already. Hours are a stored numeric(5,2) column; dollars
// are hours × rate, four decimals wide and stored nowhere. A money column adds
// up only if the VALUES are rounded to the cent and the total is the sum of the
// rounded rows — see roundToCents, and its two callers in lib/dispute-pack and
// lib/unpaid-summary. fmtMoney2 shows an already-exact figure; it cannot create
// one.
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
 * Round `n` to `1 / scale` of a unit (scale 10 = tenths, 100 = cents, 1 = whole
 * dollars), half **away from zero**, with a relative tolerance that absorbs
 * binary dust without moving a genuine value.
 *
 * Escalation `shortfall-one-decimal-float` (2026-09-06): every figure here
 * arrives as an unrounded `reduce` over floats, so `82.1 - 70.25` is
 * `11.849999999999994`, not `11.85`. Rounded straight to one decimal that lands
 * *below* the x.x5 boundary and prints `11.8` — the number is off by a tenth in
 * the shop's favour on a document whose whole job is to argue about tenths.
 *
 * Two things this is NOT, both of them tried and both wrong:
 *
 *  - **Snapping to 2dp first** (`Math.round(n*100)/100`, shipped and reverted
 *    2026-09-06). It fixes the dust case by making every value a stored-
 *    resolution value — but most values reaching {@link fmtHours} are quotients,
 *    not stored columns (`requiredPerDay`, the averages and history charts), and
 *    a double round promotes everything in `[x.x45, x.x50)` up a full tenth.
 *    Measured against the true nearest tenth: wrong on 9,772 of 200,000 random
 *    3dp inputs, and on 2,440 of 120,000 quotients `num/den`. `74.24 / 9` is
 *    `8.2488…` and printed `8.3`.
 *  - **An absolute epsilon** (`n*scale + sign(n)*1e-9`). Correct on every one of
 *    those grids, but the dust it has to absorb grows with magnitude while the
 *    tolerance does not. Over 3,000 accumulations of 200–20,000 stored 2dp
 *    values whose exact sum lands on a tenth boundary, it printed the wrong
 *    tenth 1,183 times. The relative form below: 0.
 *
 * So the tolerance is relative — 1e-9 of the value, floored at 1e-9 absolute so
 * small numbers still get one. Float dust is ~1e-16 relative and grows with the
 * length of the accumulation; a genuine value would have to sit within one part
 * in a billion of the boundary to be moved, which at the tenth scale is 1e-10 of
 * an hour. `330.75` still rounds to `330.8`, `8.2488…` still to `8.2`.
 *
 * Half away from zero (rather than `Math.round`'s half *up*) is the second
 * reason this is a helper and not an inline expression: `Math.round(-0.5)` is
 * `-0`, so `fmtHours(-0.05)` used to disagree in magnitude with `fmtHours(0.05)`.
 * A variance of exactly minus five hundredths of an hour is the same size as
 * plus five hundredths, and on a dispute pack it has to print that way.
 */
export function roundAtScale(n: number, scale: number): number {
  const x = n * scale;
  const mag = Math.abs(x);
  const rounded = Math.round(mag + Math.max(mag, 1) * 1e-9);
  // Normalise -0 at the source: a tiny negative rounds to zero magnitude, and
  // `-1 * 0` is -0, which Intl renders "-$0" and toFixed renders "-0.0". Doing
  // it here rather than in each formatter means no caller can forget.
  if (rounded === 0) return 0;
  return (Math.sign(x) * rounded) / scale;
}

/**
 * Round a dollar figure to the cent, the resolution money is actually stored at
 * (`claimed_dollars` is `numeric(10,2)`; Postgres rounds it there whether we do
 * or not).
 *
 * **This is not a formatting concern and it does not belong in a formatter.**
 * Dollars in this app are not a stored column — they are `hours × rate`, a
 * 2dp × 2dp product carrying four decimals. Rounding each row to cents *for
 * display* while totalling the raw four-decimal products means the printed rows
 * genuinely do not add to the printed total: at $32.50, rows of
 * 1.15/0.75/1.35/2.25/0.45h print $37.38 + $24.38 + $43.88 + $73.13 + $14.63 =
 * $193.40 under a total of $193.38. No formatter can fix that, because both
 * figures are correctly formatted.
 *
 * The fix is to round each row to the cent *as the value*, then sum the rounded
 * rows — which is what `lib/dispute-pack` and `lib/unpaid-summary` now do. The
 * column adds up by construction rather than by luck.
 */
export function roundToCents(n: number): number {
  const v = roundAtScale(n, 100);
  return v === 0 ? 0 : v; // normalise -0
}

/**
 * Hours for the app UI, to one decimal.
 *
 * A nonzero value too small to show at this resolution renders as "<0.1"
 * (or "-<0.1"), never "0.0" — a real zero and a rounded-away 0.02 must not be
 * the same string. A true zero still prints "0.0".
 *
 * Most values arriving here are NOT stored 2dp columns — they are quotients
 * (`requiredPerDay`, chart averages) — so this rounds the value it is given
 * rather than pre-snapping it to a resolution it never had. See
 * {@link roundAtScale}.
 */
export function fmtHours(n: number): string {
  const rounded = roundAtScale(n, 10);
  if (rounded === 0 && n !== 0) return n > 0 ? "<0.1" : "-<0.1";
  // `rounded` is only ever -0 when n is, and n === 0 is handled above, so
  // toFixed never sees a -0 that would print "-0.0".
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
  // Normalise -0 so a line that nets to zero never prints "-0.00". Rounding can
  // produce -0 from a tiny negative, so this has to come after it.
  const v = roundToCents(n);
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
 *
 * **This formatter is not what makes the column add up, and cannot be.** Unlike
 * hours, dollars are not stored at 2dp — they are `hours × rate`, four decimals
 * wide. A page whose rows are snapped to cents at print time while its total is
 * the raw sum contradicts itself no matter how either figure is formatted; see
 * {@link roundToCents}, which the two builders apply to the *values* so the
 * total is a sum of the same cent figures the rows print. All this does is show
 * a figure that is already exact to the cent.
 */
export function fmtMoney2(n: number): string {
  const v = roundToCents(n);
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
