// Aggregation of entries + daily clocks over a date range.
import type { DailyClock, DenomSource, Entry } from "./types";
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

  return {
    flagHours,
    clockedHours,
    efficiency: computeEfficiency(flagHours, clockedHours),
    roCount: includedEntries.length,
    actualHours,
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
): ScheduleStats {
  const base = aggregateStats(entries, clocks, range);

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
