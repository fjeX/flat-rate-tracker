// Aggregation of entries + daily clocks over a date range.
import type { DailyClock, DenomSource, Entry, UnpaidTime } from "./types";
import { addDays } from "./periods";
import {
  scheduledHoursFor,
  type ShiftOverrideMap,
  type WorkSchedule,
} from "./schedule";
import { expandDaysOff } from "./streak";

export type Stats = {
  flagHours: number;
  clockedHours: number;
  efficiency: number | null; // percentage; null if clockedHours === 0
  roCount: number;
  actualHours: number; // sum of entry_op_codes.actual_hours (where provided)
  /**
   * Hours worked or waited that flagged nothing (Unpaid Time Engine).
   *
   * ADDITIVE — reported BESIDE efficiency, never folded into it. computeEfficiency
   * is untouched by design (decision #7): raw efficiency is the number the shop
   * pays on, and quietly "correcting" it would replace the tech's real figure
   * with one nobody else agrees with. The point is to show the gap, not hide it.
   */
  unpaidHours: number; // comeback + waiting + shop time
  comebackHours: number; // rework performed free — RO-side lines AND ledger rows
  waitingHours: number; // wait_parts + wait_approval
  shopHours: number; // meetings, cleanup, dispatch limbo
};

export function computeEfficiency(
  flagHours: number,
  clockedHours: number,
): number | null {
  if (clockedHours <= 0) return null;
  return (flagHours / clockedHours) * 100;
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function aggregateStats(
  entries: Entry[],
  clocks: DailyClock[],
  range: { start: string; end: string },
  // Optional so every existing caller keeps working and simply reports zero
  // unpaid time. Guest mode has no ledger at all (matching every other pay
  // feature being signed-in-only), so it never passes this.
  unpaid: UnpaidTime[] = [],
): Stats {
  const includedEntries = entries.filter((e) =>
    inRange(e.date, range.start, range.end),
  );
  const includedClocks = clocks.filter((c) =>
    inRange(c.date, range.start, range.end),
  );

  const flagHours = includedEntries.reduce((s, e) => s + e.flagHours, 0);
  const clockedHours = includedClocks.reduce((s, c) => s + c.hours, 0);
  const actualHours = includedEntries.reduce(
    (s, e) =>
      s + e.opCodes.reduce((ss, oc) => ss + (oc.actualHours ?? 0), 0),
    0,
  );

  // Comeback time arrives from two places that never overlap:
  //   - RO-side: lines marked isComeback on a ticket. Their ACTUAL hours are
  //     the cost; flag is zero by construction, so summing flag would report 0.
  //   - Ledger: comebacks with no ticket at all (another tech's work you never
  //     wrote up, same-visit rework caught before the car left).
  // A comeback written as an RO is never also a ledger row, so adding them is
  // not double counting.
  const roComebackHours = includedEntries.reduce(
    (s, e) =>
      s +
      e.opCodes.reduce(
        (ss, oc) => ss + (oc.isComeback ? (oc.actualHours ?? 0) : 0),
        0,
      ),
    0,
  );

  const includedUnpaid = unpaid.filter((u) =>
    inRange(u.date, range.start, range.end),
  );
  let ledgerComeback = 0;
  let waitingHours = 0;
  let shopHours = 0;
  for (const u of includedUnpaid) {
    switch (u.kind) {
      case "comeback_own":
      case "comeback_other":
      case "rework_same_visit":
        ledgerComeback += u.hours;
        break;
      case "wait_parts":
      case "wait_approval":
        waitingHours += u.hours;
        break;
      case "shop_time":
        shopHours += u.hours;
        break;
    }
  }

  const comebackHours = roComebackHours + ledgerComeback;

  return {
    flagHours,
    clockedHours,
    // Deliberately the SAME call as before — unpaid hours do not enter it.
    efficiency: computeEfficiency(flagHours, clockedHours),
    roCount: includedEntries.length,
    actualHours,
    unpaidHours: comebackHours + waitingHours + shopHours,
    comebackHours,
    waitingHours,
    shopHours,
  };
}

// Round to 1 decimal for display. 10.05 → 10.1, 10.04 → 10.
export function fmtHours(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function fmtPct(n: number | null): string {
  if (n === null) return "—";
  return `${Math.round(n)}%`;
}

/**
 * Maps an efficiency percentage (flag ÷ clock × 100, as returned by
 * computeEfficiency) to a status tier for colour-coding. Thresholds mirror
 * the dashboard pace bar: ≥95% on pace, 80–94% slightly behind, <80% behind.
 * Returns null when efficiency is unknown (no clock).
 */
export type EfficiencyTier = "good" | "warn" | "bad";

export function efficiencyTier(eff: number | null): EfficiencyTier | null {
  if (eff === null) return null;
  if (eff >= 95) return "good";
  if (eff >= 80) return "warn";
  return "bad";
}

// ---------------------------------------------------------------------------
// Schedule-aware efficiency (schedule-based efficiency plan).
//
// Efficiency is paired per day: a day contributes flag hours to the numerator
// only if it also contributes a denominator. Per-day denominator hierarchy:
//   1. clocked hours entered (> 0)      — ground truth, always wins
//   2. scheduled paid hours             — only for COMPLETED days (< today);
//      today gets no schedule fallback, so a half-worked shift can't tank
//      the period stat (the Today card's live pace handles today)
//   3. neither                          — the day contributes nothing
//
// A completed scheduled workday with no ROs and no clock entry is HELD OUT
// (reported in unresolvedDays) until the tech resolves it: a days_off entry
// excludes it, a confirmed_zero_days entry counts its full scheduled hours
// against efficiency. Forgotten vacation marks don't silently tank the number;
// confirmed slow days honestly do.
// ---------------------------------------------------------------------------

export type { DenomSource } from "./types";

export type ScheduleContext = {
  schedules: WorkSchedule[];
  daysOff: { startDate: string; endDate: string }[];
  /** ISO dates the tech confirmed as real zero-work days. */
  confirmedZeroDays: string[];
  /** Today in the user's timezone. */
  today: string;
  /** One-day shift departures from the pattern (still "scheduled" provenance). */
  shiftOverrides?: ShiftOverrideMap;
};

export type ScheduleStats = Stats & {
  /** Total denominator hours behind `efficiency`. */
  denomHours: number;
  /** Where the denominator came from — the provenance badge. */
  denomSource: DenomSource | null;
  /** Completed scheduled workdays awaiting a day-off / real-zero decision. */
  unresolvedDays: string[];
};

// Dashboard walks are a month-ish; snapshot generation spans a whole career.
// The cap only guards against a malformed range hanging the request.
const MAX_RANGE_DAYS = 4000;

export function aggregateStatsWithSchedule(
  entries: Entry[],
  clocks: DailyClock[],
  range: { start: string; end: string },
  ctx: ScheduleContext,
  unpaid: UnpaidTime[] = [],
): ScheduleStats {
  const base = aggregateStats(entries, clocks, range, unpaid);

  const flagByDay = new Map<string, number>();
  for (const e of entries) {
    if (!inRange(e.date, range.start, range.end)) continue;
    flagByDay.set(e.date, (flagByDay.get(e.date) ?? 0) + e.flagHours);
  }
  const clockByDay = new Map<string, number>();
  for (const c of clocks) {
    if (inRange(c.date, range.start, range.end)) clockByDay.set(c.date, c.hours);
  }
  const off = expandDaysOff(ctx.daysOff);
  const confirmedZero = new Set(ctx.confirmedZeroDays);

  let numerator = 0;
  let denomHours = 0;
  let clockedDays = 0;
  let scheduledDays = 0;
  const unresolvedDays: string[] = [];

  let d = range.start;
  for (let i = 0; d <= range.end && i < MAX_RANGE_DAYS; i++, d = addDays(d, 1)) {
    const flag = flagByDay.get(d) ?? 0;
    const clocked = clockByDay.get(d) ?? 0;

    if (clocked > 0) {
      numerator += flag;
      denomHours += clocked;
      clockedDays += 1;
      continue;
    }
    // No clock entry. Schedule fallback applies to completed days only —
    // never today (mid-shift) or the future — and never to explicit days off.
    if (d >= ctx.today || off.has(d)) continue;
    const scheduled = scheduledHoursFor(ctx.schedules, d, ctx.shiftOverrides ?? {});
    if (scheduled === null) continue;

    if (flag > 0 || confirmedZero.has(d)) {
      numerator += flag;
      denomHours += scheduled;
      scheduledDays += 1;
    } else {
      unresolvedDays.push(d);
    }
  }

  const denomSource: DenomSource | null =
    clockedDays > 0 && scheduledDays > 0
      ? "mixed"
      : clockedDays > 0
        ? "clocked"
        : scheduledDays > 0
          ? "scheduled"
          : null;

  return {
    ...base,
    efficiency: denomHours > 0 ? (numerator / denomHours) * 100 : null,
    denomHours,
    denomSource,
    unresolvedDays,
  };
}

// ---------------------------------------------------------------------------
// Per-day denominators — chart hover readouts.
// Same hierarchy as aggregateStatsWithSchedule, per single day: clocked hours
// win; scheduled paid hours fill COMPLETED days (never today mid-shift, never
// explicit days off). Days with no denominator are simply absent — the chart
// shows hours only, no efficiency.
//
// Identical to the period stats on purpose — same function, same answer. Days
// before the first schedule existed used to borrow the earliest schedule's
// pattern here (a "display-only" retro fallback, for hover readouts). That
// leaked: periodTrend builds the /insights headline efficiency and its delta
// caption from this map, so the same period read "no data" on /pay-period
// (forward-only) and 508% on /insights. A schedule you did not have last month
// must not invent a denominator for last month — on any surface.
// ---------------------------------------------------------------------------

export type DayDenom = {
  hours: number;
  source: "clocked" | "scheduled";
};

export function dailyDenominators(
  clocks: DailyClock[],
  range: { start: string; end: string },
  today: string,
  schedule: ScheduleContext | null,
): Record<string, DayDenom> {
  const out: Record<string, DayDenom> = {};
  const clockByDay = new Map<string, number>();
  for (const c of clocks) {
    if (inRange(c.date, range.start, range.end)) clockByDay.set(c.date, c.hours);
  }
  const off = schedule ? expandDaysOff(schedule.daysOff) : new Set<string>();

  let d = range.start;
  for (let i = 0; d <= range.end && i < MAX_RANGE_DAYS; i++, d = addDays(d, 1)) {
    const clocked = clockByDay.get(d) ?? 0;
    if (clocked > 0) {
      out[d] = { hours: clocked, source: "clocked" };
      continue;
    }
    if (!schedule || d >= today || off.has(d)) continue;
    const scheduled = scheduledHoursFor(
      schedule.schedules,
      d,
      schedule.shiftOverrides ?? {},
    );
    if (scheduled !== null && scheduled > 0) {
      out[d] = { hours: scheduled, source: "scheduled" };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// One rule for "which aggregator applies"
// ---------------------------------------------------------------------------

/**
 * Aggregate a range using the schedule when there is one, plain clocked hours
 * when there isn't.
 *
 * The choice used to be made inline at each call site. That was fine while the
 * pay-period page was the only caller; it stopped being fine the moment a second
 * surface (the custom-dates impact preview) had to predict the very numbers that
 * page would show. Two copies of "is there a schedule?" is exactly how a preview
 * ends up promising a figure the page then contradicts.
 */
export function aggregateStatsAuto(
  entries: Entry[],
  clocks: DailyClock[],
  range: { start: string; end: string },
  unpaid: UnpaidTime[] = [],
  schedule: ScheduleContext | null = null,
): Stats & { denomHours?: number; denomSource?: DenomSource | null } {
  if (schedule && schedule.schedules.length > 0) {
    return aggregateStatsWithSchedule(entries, clocks, range, schedule, unpaid);
  }
  return aggregateStats(entries, clocks, range, unpaid);
}
