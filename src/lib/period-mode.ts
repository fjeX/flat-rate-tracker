// Which of three states a pay period is in, and what the hero says about it.
//
// The Pay Period page asks a different question depending on where the period
// sits in the pay cycle:
//   in_progress  — still running.        "Am I on pace?"
//   awaiting_pay — closed, no stub yet.  "Did the check come?"
//   settled      — paid hours recorded.  "Was it right?"
//
// This is presentation ordering ONLY. Nothing here hides content: every card
// renders in every mode (see PayPeriodView) — the mode decides emphasis, order,
// and what starts expanded. A tech who wants a card the mode demoted still
// finds it, under the "Reference" divider.
//
// Pure functions over data the page already loads. No new schema: the mode
// falls out of the period's end date and whether paid_period_hours has a row.
import type { Forecast } from "./forecast";

export type PeriodMode = "in_progress" | "awaiting_pay" | "settled";

/**
 * Derive the mode from the period range and what's been recorded against it.
 *
 * Dates are "YYYY-MM-DD" strings compared lexicographically, matching the rest
 * of lib/periods — no Date objects at the boundary, so server and client
 * timezones can't disagree about which day it is.
 *
 * Entering paid hours wins over the calendar: an explicit user action is a
 * stronger signal than a date. That also means a period paid early (or one
 * whose custom dates were edited afterwards) still reads as settled.
 */
export function periodMode(opts: {
  end: string;
  today: string;
  paidFlagHours: number | null;
}): PeriodMode {
  if (opts.paidFlagHours !== null) return "settled";
  // end is inclusive, so a period ending today is still running.
  if (opts.end >= opts.today) return "in_progress";
  return "awaiting_pay";
}

export type ProjectionLabel =
  | { kind: "none" }
  | { kind: "no_history" }
  | { kind: "implausible"; state: Forecast["state"] }
  | { kind: "projected"; projected: number; goal: number; state: Forecast["state"] };

// A recent-pace average extrapolated from the first day or two of a period can
// project an absurd multiple of the goal ("486h of 88h"). The arithmetic is
// honest but the number reads as a bug, so past this multiple the hero reports
// the state and drops the figure.
//
// Exported because the dashboard makes the identical call about the identical
// forecast and used to hold its own hand-copied `1.5`. One judgement, one
// number — see memory/feedback_duplicate_derivations_drift.md.
export const IMPLAUSIBLE_MULTIPLE = 1.5;

/**
 * What the in-progress hero should say about where the period lands.
 *
 * Returns a discriminated union rather than a string so the component owns the
 * wording and this stays testable. Degrades in the same order the forecast
 * itself does: no goal → nothing to project against; no history → say so;
 * wild extrapolation → state only.
 */
export function projectionLabel(
  forecast: Forecast,
  goalHours: number,
): ProjectionLabel {
  if (goalHours <= 0) return { kind: "none" };
  if (forecast.state === "insufficient-history" || forecast.projected === null) {
    return { kind: "no_history" };
  }
  if (forecast.projected >= goalHours * IMPLAUSIBLE_MULTIPLE) {
    return { kind: "implausible", state: forecast.state };
  }
  return {
    kind: "projected",
    projected: forecast.projected,
    goal: goalHours,
    state: forecast.state,
  };
}
