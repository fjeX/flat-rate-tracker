// Whether the efficiency percentage is still worth printing — and when it is
// not, which state that is.
//
// ───────────────────────────────────────────────────────────────────────────
// THE BUG THIS EXISTS FOR (fingerprint `zero-efficiency-hero-copy`, 2026-08-18)
//
// The Pay Period hero rendered, as ONE sentence:
//
//     0% efficiency · well ahead of your goal so far
//
// Both halves were computed correctly and they contradicted each other.
//
//   - `efficiency` is gated per DAY by pairDay() in lib/stats. A day the app
//     cannot measure — unscheduled, a day off, or still in progress because
//     `date >= today` — contributes its flagged hours to NEITHER side of the
//     ratio. On 2026-08-18 all 42.0h of flagged work sat on two such days, and
//     the only day left in the denominator was one with no flagged work at all.
//     Numerator 0, denominator 8 → a genuinely computed 0%. Not a null coerced
//     to zero: arithmetic that answered a question nobody asked.
//   - The forecast beside it is built from `stats.flagHours`, the RAW headline
//     total, which still had all 42.0h in it. So it projected "well ahead".
//
// Two pipelines, one sentence, no shared notion of "this hour is measurable".
//
// The distinction being encoded here is the one from
// memory/feedback_undefined_is_not_absent.md: "0% of the hours we could
// measure" and "the hours that happened are not in this ratio at all" are
// different facts about the world, and overloading a single number with both
// erased 42 hours of work. So they get different names in the type.
//
// This is guaranteed to recur on the 1st and 16th of every month — the first
// day or two of a period is exactly when a large share of its flagged work sits
// on days that are still open.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The printed figure understates reality by at least this factor before it is
 * withheld.
 *
 * NOT a taste threshold. `counted / flagHours` is the share of the period's
 * flagged work that actually reaches the numerator, so the figure on screen is
 * understated by at least `flagHours / counted`. At a counted share of 1/2 the
 * number is wrong by more than it is right — 2× is the smallest factor for
 * which "withhold it" beats "print it and hope the caption is read". The
 * all-excluded case (counted share 0) understates by an unbounded factor and is
 * simply the limit of the same rule.
 *
 * Deliberately NOT keyed on `efficiency === 0`: a fully-measured 0% — clocked
 * hours with genuinely no flagged work on them — is a true, useful and
 * sometimes alarming fact, and it must keep printing.
 */
const MIN_UNDERSTATEMENT_FACTOR = 2;

/**
 * Below this many hours the counted numerator is treated as empty rather than
 * small. Flag hours are recorded in tenths, so anything under half a tenth is
 * float dust, not work.
 */
const EMPTY_HOURS = 0.05;

export type EfficiencyDisplay =
  /** A percentage that means what it says. */
  | { kind: "shown"; pct: number }
  /**
   * Every flagged hour in the period landed on a day with no measurable
   * length. There is no honest percentage to print — 0% would read as "you
   * produced nothing" when the truth is "nothing that happened is countable
   * yet".
   */
  | { kind: "all_excluded"; excludedHours: number; days: number }
  /**
   * Most of them did. A percentage exists but understates the period by
   * `MIN_UNDERSTATEMENT_FACTOR` or more.
   */
  | {
      kind: "mostly_excluded";
      excludedHours: number;
      totalHours: number;
      days: number;
    }
  /** Nothing measured and nothing excluded — no figure, and nothing to explain. */
  | { kind: "none" };

/**
 * Classify the efficiency figure for a range.
 *
 * Accepts the optional `unpaired*` fields rather than requiring `ScheduleStats`
 * so the plain `aggregateStats` shape (no schedule configured) passes straight
 * through: that aggregator divides period totals, never per-day, so it has no
 * excluded-day concept and correctly always lands on "shown".
 */
export function efficiencyDisplay(stats: {
  flagHours: number;
  efficiency: number | null;
  unpairedFlagHours?: number;
  unpairedDays?: number;
}): EfficiencyDisplay {
  // Non-finite in means non-finite out, and every comparison below is false
  // against NaN — so an unguarded NaN falls through to `shown` and renders
  // "NaN%" on the headline. Not reachable from today's producers; costs one
  // line to make unreachable by construction.
  const finite = (n: number | undefined) => (Number.isFinite(n) ? (n as number) : 0);
  const flagHours = finite(stats.flagHours);
  const excludedHours = finite(stats.unpairedFlagHours);
  // Exact, not an estimate: pairDay only ever files a day as unpaired when it
  // has flagged hours and no denominator, and an `unresolved` day always has
  // flag === 0. So the numerator behind `efficiency` is precisely this.
  const counted = flagHours - excludedHours;

  if (excludedHours > 0 && counted * MIN_UNDERSTATEMENT_FACTOR <= flagHours) {
    // `unpairedDays` is optional alongside a required-in-practice
    // `unpairedFlagHours`, so a caller can supply hours without days and the
    // copy renders "landed on 0 days". If we know hours were excluded, at
    // least one day held them — floor at 1 rather than print a falsehood.
    const days = Math.max(1, finite(stats.unpairedDays));
    if (counted < EMPTY_HOURS) {
      return { kind: "all_excluded", excludedHours, days };
    }
    return {
      kind: "mostly_excluded",
      excludedHours,
      totalHours: flagHours,
      days,
    };
  }

  if (stats.efficiency === null) return { kind: "none" };
  return { kind: "shown", pct: stats.efficiency };
}
