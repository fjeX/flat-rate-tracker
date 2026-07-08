// Pure "wage check-up" math. No I/O, no React — a plain function of a period's
// entries, daily clocks, bonuses, and rate map, so it's trivially unit-testable
// and safe from Server Components, client components, and tests alike. Mirrors
// the shape of lib/stats.ts and lib/earnings.ts.
//
// What it surfaces (numbers only — NEVER a legal conclusion):
//  - Effective hourly = (flag pay + bonuses) ÷ clocked hours. This is the figure
//    California piece-rate rules care about: flag pay alone can't lawfully average
//    out to cover unproductive time.
//  - Clock-vs-flag gap = clocked hrs − flagged hrs (the magnitude of time on the
//    clock that produced no flagged work).
//  - Floor comparison against a USER-ENTERED reference rate. No wage law, minimum
//    wage figure, or city/state rate is hardcoded anywhere in this module — the
//    reference is always something the user typed in settings.
//
// Design notes:
//  - Missing clock data is the NORM, not the exception. Effective hourly is null
//    whenever any day that had flagged work lacks a clock entry — the caller is
//    told exactly WHICH days are missing so it can say so, never silently averaging
//    an incomplete denominator.
//  - Everything degrades: no rates → dollars are null (hours-only gap still works);
//    no clock → effective hourly null; no reference rate → no comparison.
import type { Bonus, DailyClock, Entry } from "./types";
import { hasAnyRate, periodEarnings, type RateMap } from "./earnings";
import { sumBonuses } from "./bonuses";

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

// Distinct, sorted list of dates, deduped.
function distinctDates(dates: string[]): string[] {
  return Array.from(new Set(dates)).sort();
}

// Why effective hourly can't be shown, or "ok" when it can.
//  - no_clock:        no clocked hours logged in the period at all
//  - incomplete_clock: some day had flagged work but no clock entry
//  - no_rates:        clock is complete but no pay rate is priced (dollars unknown)
//  - ok:              a real effective hourly figure is available
export type WageCheckStatus =
  | "ok"
  | "no_clock"
  | "incomplete_clock"
  | "no_rates";

export type EffectiveHourly = {
  // (flagPay + bonuses) ÷ clockedHours. null unless status === "ok".
  hourly: number | null;
  flagPay: number | null; // null when no rates are priced (dollars unknown)
  bonusTotal: number; // always real — spiffs need no rates
  totalPay: number | null; // flagPay + bonuses; null when flagPay is null
  flagHours: number;
  clockedHours: number;
  workDays: string[]; // distinct dates that had flagged work (an RO)
  clockDays: string[]; // distinct dates with clocked hours > 0
  missingClockDays: string[]; // workDays with no clock entry — the incomplete set
  status: WageCheckStatus;
};

// Effective hourly for one period. Pass the period's entries/clocks/bonuses (the
// function re-filters to `range` defensively, mirroring aggregateStats) plus the
// rate map. Returns a rich result so the UI can label partial data precisely.
export function effectiveHourly(
  entries: Entry[],
  clocks: DailyClock[],
  bonuses: Bonus[],
  rates: RateMap,
  range: { start: string; end: string },
): EffectiveHourly {
  const includedEntries = entries.filter((e) =>
    inRange(e.date, range.start, range.end),
  );
  const includedClocks = clocks.filter((c) =>
    inRange(c.date, range.start, range.end),
  );
  const includedBonuses = bonuses.filter((b) =>
    inRange(b.date, range.start, range.end),
  );

  const flagHours = includedEntries.reduce((s, e) => s + e.flagHours, 0);
  const clockedHours = includedClocks.reduce((s, c) => s + c.hours, 0);

  const flagPay = hasAnyRate(rates)
    ? periodEarnings(includedEntries, rates)
    : null;
  const bonusTotal = sumBonuses(includedBonuses);
  const totalPay = flagPay === null ? null : flagPay + bonusTotal;

  const workDays = distinctDates(includedEntries.map((e) => e.date));
  const clockDays = distinctDates(
    includedClocks.filter((c) => c.hours > 0).map((c) => c.date),
  );
  const clockDaySet = new Set(clockDays);
  const missingClockDays = workDays.filter((d) => !clockDaySet.has(d));

  // Resolve the reason we can (or can't) show a figure, in priority order.
  let status: WageCheckStatus;
  let hourly: number | null;
  if (clockedHours <= 0) {
    status = "no_clock";
    hourly = null;
  } else if (missingClockDays.length > 0) {
    // A day of flagged work with no clock entry would inflate effective hourly —
    // never average over an incomplete denominator. Show the gap, hide the rate.
    status = "incomplete_clock";
    hourly = null;
  } else if (totalPay === null) {
    status = "no_rates";
    hourly = null;
  } else {
    status = "ok";
    hourly = totalPay / clockedHours;
  }

  return {
    hourly,
    flagPay,
    bonusTotal,
    totalPay,
    flagHours,
    clockedHours,
    workDays,
    clockDays,
    missingClockDays,
    status,
  };
}

// Clocked hours minus flagged hours — the "unproductive time" magnitude. Positive
// means time on the clock that produced no flagged work; negative means flag hours
// outran the clock (high efficiency). Pure subtraction so tests can pass raw numbers.
export function clockFlagGap(clockedHours: number, flagHours: number): number {
  return clockedHours - flagHours;
}

// Dollar value of the clock-vs-flag gap at the customer-pay rate — "that window
// represents $X of unflagged time". null when CP is unpriced or the gap isn't
// positive (no unproductive time to value). Uses customer_pay only: it's the
// baseline productive rate, and this is an illustration, not a pay calculation.
export function unflaggedTimeValue(
  gapHours: number,
  rates: RateMap,
): number | null {
  const cp = rates.customer_pay;
  if (cp === undefined || gapHours <= 0) return null;
  return cp * gapHours;
}

export type FloorComparison = {
  effective: number;
  reference: number;
  delta: number; // effective − reference; positive = above the reference
  atOrAbove: boolean; // effective >= reference
};

// Compare an effective hourly figure against the user-entered reference rate.
// null when either side is missing (no figure yet, or no reference set) or the
// reference is non-positive — the UI hides the comparison row entirely in that
// case. Presents the delta as a plain number; the caller adds no verdict.
export function floorComparison(
  effective: number | null,
  reference: number | null,
): FloorComparison | null {
  if (effective === null) return null;
  if (reference === null || !Number.isFinite(reference) || reference <= 0) {
    return null;
  }
  const delta = effective - reference;
  return {
    effective,
    reference,
    delta,
    atOrAbove: delta >= 0,
  };
}
