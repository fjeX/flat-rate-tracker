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
import {
  scheduledHoursFor,
  type ShiftOverrideMap,
  type WorkSchedule,
} from "./schedule";
import { expandDaysOff } from "./streak";

/**
 * The subset of ScheduleContext effectiveHourly needs to fill unclocked days.
 * Structurally compatible with lib/stats' ScheduleContext, so a caller can pass
 * the same object to both and they cannot drift apart.
 */
export type ScheduleFallback = {
  schedules: WorkSchedule[];
  daysOff: { startDate: string; endDate: string }[];
  /** Today in the user's timezone — the fallback never applies to a day still
   *  in progress, or to the future. */
  today: string;
  shiftOverrides?: ShiftOverrideMap;
};

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
  // (flagPay + bonuses) ÷ denomHours. null unless status === "ok".
  hourly: number | null;
  flagPay: number | null; // null when no rates are priced (dollars unknown)
  bonusTotal: number; // always real — spiffs need no rates
  totalPay: number | null; // flagPay + bonuses; null when flagPay is null
  flagHours: number;
  clockedHours: number; // hours from real clock entries ONLY
  // The denominator actually used: clocked hours, plus scheduled shift hours
  // for completed days that have flagged work but no clock entry. Equals
  // clockedHours when no schedule context is supplied.
  denomHours: number;
  // Where denomHours came from, for honest labelling. null when there is no
  // denominator at all.
  denomSource: "clocked" | "scheduled" | "mixed" | null;
  workDays: string[]; // distinct dates that had flagged work (an RO)
  clockDays: string[]; // distinct dates with clocked hours > 0
  // Work days filled in from the schedule rather than a clock entry.
  scheduledDays: string[];
  // Work days with NEITHER a clock entry nor a schedule to fall back on — the
  // genuinely unknown set. A scheduled day is not missing: the schedule IS the
  // answer, which is the whole reason the shift-override exists.
  missingClockDays: string[];
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
  // Optional schedule fallback, mirroring aggregateStatsWithSchedule exactly.
  //
  // Without it this function only knows about real clock entries, and any day
  // with flagged work but no clock entry blocks the rate entirely. That was
  // wrong: efficiency has ALWAYS filled those days from the work schedule, so
  // the same period could show a schedule-derived efficiency alongside "no
  // effective hourly yet" — two functions disagreeing about the same hours.
  //
  // A scheduled day is a known-good default, not missing data. The shift
  // override on the dashboard and schedule pages exists precisely so the tech
  // can correct it when a day wasn't normal.
  //
  // Omitted → identical behaviour to before (denomHours === clockedHours).
  schedule?: ScheduleFallback | null,
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

  // Fill unclocked work days from the schedule, on exactly the terms
  // aggregateStatsWithSchedule uses: completed days only (never today, which is
  // mid-shift, and never the future), and never an explicit day off.
  const scheduledDays: string[] = [];
  let scheduledHours = 0;
  if (schedule) {
    const off = expandDaysOff(schedule.daysOff);
    for (const d of workDays) {
      if (clockDaySet.has(d)) continue;
      if (d >= schedule.today || off.has(d)) continue;
      const hours = scheduledHoursFor(
        schedule.schedules,
        d,
        schedule.shiftOverrides ?? {},
      );
      if (hours === null || hours <= 0) continue;
      scheduledDays.push(d);
      scheduledHours += hours;
    }
  }
  const scheduledDaySet = new Set(scheduledDays);

  // Only days with neither a clock entry nor a schedule are genuinely unknown.
  const missingClockDays = workDays.filter(
    (d) => !clockDaySet.has(d) && !scheduledDaySet.has(d),
  );

  const denomHours = clockedHours + scheduledHours;
  const denomSource: EffectiveHourly["denomSource"] =
    clockedHours > 0 && scheduledHours > 0
      ? "mixed"
      : clockedHours > 0
        ? "clocked"
        : scheduledHours > 0
          ? "scheduled"
          : null;

  // Resolve the reason we can (or can't) show a figure, in priority order.
  let status: WageCheckStatus;
  let hourly: number | null;
  if (denomHours <= 0) {
    status = "no_clock";
    hourly = null;
  } else if (missingClockDays.length > 0) {
    // A day of flagged work with NO clock entry and NO schedule would inflate
    // effective hourly — never average over an incomplete denominator. Show the
    // gap, hide the rate.
    status = "incomplete_clock";
    hourly = null;
  } else if (totalPay === null) {
    status = "no_rates";
    hourly = null;
  } else {
    status = "ok";
    hourly = totalPay / denomHours;
  }

  return {
    hourly,
    flagPay,
    bonusTotal,
    totalPay,
    flagHours,
    clockedHours,
    denomHours,
    denomSource,
    workDays,
    clockDays,
    scheduledDays,
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

// What the clock-vs-flag gap is MADE OF, once the Unpaid Time Engine has some
// of those hours on record. The gap itself is unchanged — this only splits an
// existing number into named parts, so the Pay Check-Up can answer "where did
// those hours go?" with the tech's own records instead of leaving it a mystery.
//
// `unaccountedHours` is the remainder nothing explains yet. It is clamped at
// zero: recorded unpaid time can legitimately EXCEED the gap (comeback actual
// hours run alongside flagged work on the same day), and a negative "unaccounted"
// figure would read as a bug rather than as the real relationship.
export type GapComposition = {
  gapHours: number;
  comebackHours: number;
  waitingHours: number;
  shopHours: number;
  trackedHours: number; // comeback + waiting + shop
  unaccountedHours: number; // gap − tracked, never below zero
  overTracked: boolean; // tracked meets or exceeds the whole gap
};

// null when there is no positive gap to explain, or nothing recorded to explain
// it with — the caller renders no breakdown at all in that case rather than a
// row of zeros.
export function gapComposition(
  gapHours: number,
  parts: { comebackHours: number; waitingHours: number; shopHours: number },
): GapComposition | null {
  if (!Number.isFinite(gapHours) || gapHours <= 0) return null;
  const trackedHours =
    parts.comebackHours + parts.waitingHours + parts.shopHours;
  if (trackedHours <= 0) return null;
  return {
    gapHours,
    comebackHours: parts.comebackHours,
    waitingHours: parts.waitingHours,
    shopHours: parts.shopHours,
    trackedHours,
    unaccountedHours: Math.max(0, gapHours - trackedHours),
    overTracked: trackedHours >= gapHours,
  };
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
