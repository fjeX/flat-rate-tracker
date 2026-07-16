// Today's live pace — the instantaneous gauge, distinct from period
// efficiency (schedule-based efficiency plan). Period stats never include an
// unclocked today; this carves out the scheduled shift as it passes so a
// morning oil change doesn't read as a bad day.
//
// The unpaid break isn't stored with a time-of-day, so it's smeared
// proportionally across the shift: elapsed paid time = elapsed wall time ×
// (paid / total). Smooth, and never off by more than the break length.
//
// Pure functions only — `nowMin` (minutes since midnight in the user's
// timezone) is always passed in, so everything here is testable and the
// component owns the ticking clock.

import { shiftPaidHours, type ShiftDef } from "./schedule";

/** Below this many elapsed paid hours the pace is withheld — a 7:05 AM RO
 * shouldn't flash 4,000%. */
export const PACE_MIN_ELAPSED_HOURS = 1;

export type Pace = {
  /** before: shift hasn't started · early: under the floor · live: ticking ·
   * done: shift over (pace = flag over the full scheduled day). */
  status: "before" | "early" | "live" | "done";
  /** flag ÷ elapsed paid hours, percent. Null when before/early. */
  pacePct: number | null;
  /** Paid hours elapsed so far, clamped to the shift's paid hours. */
  elapsedPaidHours: number;
};

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function shiftPace(
  shift: ShiftDef,
  flagHours: number,
  nowMin: number,
): Pace {
  const startMin = minutesOf(shift.start);
  const endMin = minutesOf(shift.end);
  const totalMin = endMin - startMin;
  const paidHours = shiftPaidHours(shift);

  if (nowMin <= startMin) {
    return { status: "before", pacePct: null, elapsedPaidHours: 0 };
  }
  if (nowMin >= endMin) {
    return {
      status: "done",
      pacePct: paidHours > 0 ? (flagHours / paidHours) * 100 : null,
      elapsedPaidHours: paidHours,
    };
  }
  const elapsedPaidHours = ((nowMin - startMin) / totalMin) * paidHours;
  if (elapsedPaidHours < PACE_MIN_ELAPSED_HOURS) {
    return { status: "early", pacePct: null, elapsedPaidHours };
  }
  return {
    status: "live",
    pacePct: (flagHours / elapsedPaidHours) * 100,
    elapsedPaidHours,
  };
}

/** Minutes since midnight in `tz` (empty tz → device local time). Lives here
 * so the Intl plumbing stays next to the math that consumes it. */
export function minutesNowInTz(tz: string, now: Date = new Date()): number {
  if (!tz) return now.getHours() * 60 + now.getMinutes();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}
