// Aggregation of entries + daily clocks over a date range.
import type { DailyClock, DenomSource, Entry, UnpaidTime } from "./types";
import { addDays } from "./periods";
import {
  scheduledHoursFor,
  type ShiftOverrideMap,
  type WorkSchedule,
} from "./schedule";
import { expandDaysOff } from "./streak";
import { upsellFlagHours } from "./upsells";

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
  /**
   * Flag hours on lines the tech marked as upsells — work they sold.
   *
   * A SUBSET of flagHours, not an addition to it: the same hours are already in
   * that total, and the useful figure is what share of the work you turned was
   * work you found. Never add it to anything.
   */
  upsellHours: number;
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
    // Through lib/upsells rather than another reduce here, so this figure and
    // the /insights trend cannot come to different conclusions about what an
    // upsold line is worth.
    upsellHours: includedEntries.reduce((s, e) => s + upsellFlagHours(e), 0),
  };
}

// Hours-to-text lives in lib/format now — one copy, so a rounding rule can
// never again be fixed on one surface and left broken on two others. Re-exported
// here because ~30 files already import fmtHours from this module.
export { fmtHours } from "./format";

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
  /**
   * Flag hours inside the range that landed on days with NO denominator, so
   * they are in `flagHours` (the headline total) but not in the efficiency
   * numerator. This is the whole reason `flagHours / denomHours` does not equal
   * `efficiency`, and a surface that prints all three owes the reader this
   * number — otherwise the arithmetic on screen simply looks wrong.
   */
  unpairedFlagHours: number;
  /** How many distinct days those unpaired hours came from. */
  unpairedDays: number;
};

// Dashboard walks are a month-ish; snapshot generation spans a whole career.
// The cap only guards against a malformed range hanging the request.
const MAX_RANGE_DAYS = 4000;

export type DayDenom = {
  hours: number;
  source: "clocked" | "scheduled";
};

type DayPairing =
  | { kind: "counted"; denom: DayDenom }
  /** Completed scheduled workday awaiting a day-off / real-zero decision. */
  | { kind: "unresolved" }
  /** No denominator at all: today, the future, a day off, or no schedule. */
  | { kind: "none" };

// ---------------------------------------------------------------------------
// The one per-day pairing rule. Every surface that divides flag hours by a
// day length goes through here.
//
// Clocked hours win. Scheduled hours fill COMPLETED days only — never today
// (mid-shift), never the future, never an explicit day off. A scheduled day
// with no flagged work counts only once the tech has confirmed it was a real
// zero; until then it is UNRESOLVED and contributes to neither side.
//
// aggregateStatsWithSchedule and dailyDenominators were two hand-synced copies
// of this, under a comment claiming they were "identical on purpose". They were
// not: dailyDenominators counted every completed scheduled day unconditionally
// and never consulted confirmedZeroDays, so any period holding an unresolved
// scheduled day read one efficiency on /pay-period and a lower one on
// /insights — the same surface disagreement 7cbbdda was meant to close, still
// live for every period nobody happened to check. Two functions answering one
// real-world question drift; there is now one function.
// ---------------------------------------------------------------------------
function pairDay(
  date: string,
  flag: number,
  clocked: number,
  today: string,
  schedule: ScheduleContext | null,
  off: Set<string>,
  confirmedZero: Set<string>,
): DayPairing {
  if (clocked > 0) {
    return { kind: "counted", denom: { hours: clocked, source: "clocked" } };
  }
  if (!schedule || date >= today || off.has(date)) return { kind: "none" };
  const scheduled = scheduledHoursFor(
    schedule.schedules,
    date,
    schedule.shiftOverrides ?? {},
  );
  // A valid shift always has positive paid hours (shiftFromHours rejects 0), so
  // `<= 0` and `null` are the same answer: this day has no scheduled length.
  if (scheduled === null || scheduled <= 0) return { kind: "none" };
  if (flag > 0 || confirmedZero.has(date)) {
    return { kind: "counted", denom: { hours: scheduled, source: "scheduled" } };
  }
  return { kind: "unresolved" };
}

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
  let unpairedFlagHours = 0;
  let unpairedDays = 0;
  const unresolvedDays: string[] = [];

  let d = range.start;
  for (let i = 0; d <= range.end && i < MAX_RANGE_DAYS; i++, d = addDays(d, 1)) {
    const flag = flagByDay.get(d) ?? 0;
    const clocked = clockByDay.get(d) ?? 0;
    const paired = pairDay(d, flag, clocked, ctx.today, ctx, off, confirmedZero);

    if (paired.kind === "counted") {
      numerator += flag;
      denomHours += paired.denom.hours;
      if (paired.denom.source === "clocked") clockedDays += 1;
      else scheduledDays += 1;
      continue;
    }
    if (paired.kind === "unresolved") unresolvedDays.push(d);
    // Flagged work on a day the app can't measure. An unresolved day always has
    // flag === 0 (flag > 0 would have counted it), so this only ever fires for
    // "none" days: today, the future, days off, days with no schedule at all.
    if (flag > 0) {
      unpairedFlagHours += flag;
      unpairedDays += 1;
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
    unpairedFlagHours,
    unpairedDays,
  };
}

// ---------------------------------------------------------------------------
// Per-day denominators — chart hover readouts and the /insights trend.
// One call to pairDay per day, the same call aggregateStatsWithSchedule makes,
// so a day counts here if and only if it counts there. Days with no
// denominator are simply absent — the chart shows hours only, no efficiency.
//
// `entries` is not optional and not cosmetic: the pairing rule needs to know
// whether a scheduled day had flagged work on it before it can tell a real
// zero from an unanswered question. Leaving entries out is exactly how this
// function drifted from the period stats in the first place.
//
// Days before the first schedule existed used to borrow the earliest
// schedule's pattern here (a "display-only" retro fallback, for hover
// readouts). That leaked: periodTrend builds the /insights headline efficiency
// and its delta caption from this map, so the same period read "no data" on
// /pay-period (forward-only) and 508% on /insights. A schedule you did not
// have last month must not invent a denominator for last month — on any
// surface.
// ---------------------------------------------------------------------------

export function dailyDenominators(
  entries: Entry[],
  clocks: DailyClock[],
  range: { start: string; end: string },
  today: string,
  schedule: ScheduleContext | null,
): Record<string, DayDenom> {
  const out: Record<string, DayDenom> = {};
  const flagByDay = new Map<string, number>();
  for (const e of entries) {
    if (!inRange(e.date, range.start, range.end)) continue;
    flagByDay.set(e.date, (flagByDay.get(e.date) ?? 0) + e.flagHours);
  }
  const clockByDay = new Map<string, number>();
  for (const c of clocks) {
    if (inRange(c.date, range.start, range.end)) clockByDay.set(c.date, c.hours);
  }
  const off = schedule ? expandDaysOff(schedule.daysOff) : new Set<string>();
  const confirmedZero = new Set(schedule?.confirmedZeroDays ?? []);

  let d = range.start;
  for (let i = 0; d <= range.end && i < MAX_RANGE_DAYS; i++, d = addDays(d, 1)) {
    const paired = pairDay(
      d,
      flagByDay.get(d) ?? 0,
      clockByDay.get(d) ?? 0,
      today,
      schedule,
      off,
      confirmedZero,
    );
    if (paired.kind === "counted") out[d] = paired.denom;
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
