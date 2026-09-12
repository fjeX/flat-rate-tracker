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
import { openWorkDates, openWorkRows } from "./open-tickets";

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
  /**
   * Hours worked on OPEN TICKETS in the range (Open Tickets plan, decision
   * 7/10): teardown and diag time on a job whose op codes don't exist yet.
   *
   * Its OWN bucket. Not in unpaidHours (those hours are paid late, not never),
   * not in flagHours (the flag pays on the close day), and not in efficiency
   * (decision 7 — the raw number never moves; attribution sits beside it, as
   * "8.0h on 1 open ticket"). Adding it to any of the three is the bug.
   */
  openTicketHours: number;
  /** Distinct open tickets those hours were on. */
  openTicketCount: number;
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
  let openTicketHours = 0;
  const openTickets = new Set<string>();
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
      case "open_work":
        // Deliberately NOT added to any unpaid figure (decision 10). Counted
        // under its own name so the day can say where the hours went.
        openTicketHours += u.hours;
        openTickets.add(u.entryId ?? "");
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
    openTicketHours,
    openTicketCount: openTickets.size,
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
  /**
   * The SAME hours and days as the two fields above, split by WHY the day had
   * no denominator.
   *
   * The counts were always right; the explanation was the bug. `pairDay` folds
   * four unrelated situations into one `{kind:"none"}` — a shift still running,
   * an explicit day off, a day the schedule doesn't cover, and no schedule at
   * all — and both surfaces that print a caption printed the same "clock them
   * or add them to your schedule" sentence for every one of them. On a day
   * still in progress that sentence sends the tech to fix something that isn't
   * broken. Splitting the tally is what lets the caption say which it is.
   */
  unpairedByReason: UnpairedByReason;
};

/**
 * Why a day contributed to neither side of the efficiency percentage.
 *
 * `in_progress` is the only one that resolves itself: the shift is still
 * running, so there are no hours to divide by YET. The other three are days the
 * app cannot measure at all until the tech acts.
 */
export type UnpairedReason =
  | "in_progress" // today or later, nothing clocked — the shift is still running
  | "day_off" // an explicit days_off entry covers the date
  | "unscheduled" // a schedule exists, but it puts no shift on this day
  | "no_schedule"; // no work schedule at all

export type UnpairedTally = { flagHours: number; days: number };
export type UnpairedByReason = Record<UnpairedReason, UnpairedTally>;

export function emptyUnpairedByReason(): UnpairedByReason {
  return {
    in_progress: { flagHours: 0, days: 0 },
    day_off: { flagHours: 0, days: 0 },
    unscheduled: { flagHours: 0, days: 0 },
    no_schedule: { flagHours: 0, days: 0 },
  };
}

/**
 * "This day isn't measurable YET" — today or later with nothing clocked.
 *
 * The ONE predicate for an in-progress day, exported so the three surfaces that
 * describe one cannot drift into three different answers. It is deliberately
 * identical to `wage-check.ts`'s `isOngoing` (`date >= schedule.today &&
 * !clockDaySet.has(date)`, where clockDays are the dates with hours > 0), which
 * is where the correct wording for this case already lives — WorkCostCard has
 * been saying "that shift is still in progress" from it while the two captions
 * below said the opposite about the same day.
 *
 * Not imported from wage-check: that module imports `earnings`/`bonuses` and is
 * the pay half of the app, while this is the aggregation half — the dependency
 * runs stats → (nothing), and wiring it the other way to share four tokens
 * would be the first edge of a cycle. The predicate is three terms and it is
 * pinned by a test in both modules.
 */
export function isInProgressDay(
  date: string,
  today: string,
  clockedHours: number,
  /**
   * Does the tech have a work schedule at all? wage-check's `isOngoing` opens
   * with `schedule !== null` and this predicate used to omit it, which was
   * harmless at `pairDay`'s call site (the `!schedule` early return runs first)
   * and wrong at `periodTrend`'s, which calls it with no such guard: a tech
   * with no schedule got "that shift is still in progress" on /insights for a
   * today-dated entry while `pairDay` called the same day `no_schedule`. NOT
   * optional and NOT defaulted — a default is how the term went missing on one
   * of two call sites in the first place.
   */
  hasSchedule: boolean,
): boolean {
  return hasSchedule && clockedHours <= 0 && date >= today;
}

/**
 * One caption's worth of unpaired hours: the tally plus the sentence to print.
 *
 * ONE NOTE PER REASON — the note's kind IS the reason, so nothing is folded.
 * An earlier pass split the tally four ways and then re-merged three of the
 * buckets into a single "unmeasured" note, which put the no_schedule sentence
 * ("…no schedule … add them to your schedule") under a day that was on the
 * schedule and marked off. The counts were right and the instruction was still
 * wrong, which is the same defect this whole field exists to fix.
 *
 * Both surfaces that print this go through here, so the pay-period page and
 * /insights cannot describe the same excluded day in two different ways again.
 *
 * `total` is the fallback for a caller that has the old flat pair and no
 * breakdown (a snapshot, a stats object built before this field existed). It
 * keeps the pre-existing single sentence rather than dropping the caption.
 */
export type UnpairedNoteKind = UnpairedReason;
export type UnpairedNote = {
  kind: UnpairedNoteKind;
  flagHours: number;
  days: number;
};

/** Fixed print order: the one that resolves itself first, then the three the
 *  tech has to act on, cheapest correction first. */
const NOTE_ORDER: readonly UnpairedReason[] = [
  "in_progress",
  "day_off",
  "unscheduled",
  "no_schedule",
];

export function unpairedNotes(
  by: UnpairedByReason | null | undefined,
  total: UnpairedTally,
): UnpairedNote[] {
  // The pre-breakdown caption said "no clocked hours and no schedule", which IS
  // the no_schedule sentence — so the fallback is that reason, not a fifth kind
  // meaning "we didn't look".
  const flat: UnpairedNote[] =
    total.flagHours > 0
      ? [{ kind: "no_schedule", flagHours: total.flagHours, days: total.days }]
      : [];
  if (!by) return flat;

  const notes: UnpairedNote[] = NOTE_ORDER.filter(
    (reason) => by[reason].flagHours > 0,
  ).map((reason) => ({ kind: reason, ...by[reason] }));

  // A breakdown that explains none of the hours it was handed is worse than no
  // breakdown: the caption would vanish and the excluded hours would go unsaid.
  return notes.length > 0 ? notes : flat;
}

/**
 * Which surface is printing the caption. NOT a styling flag — the two surfaces
 * disagree on a FACT.
 *
 * `ScheduleStats.flagHours` is the raw period total and `unpairedFlagHours` is
 * a subset of it, so on /pay-period these hours ARE in the headline figure
 * above the caption. `PeriodTrendPoint.flagHours` is the PAIRED total only —
 * the trend's pairing loop adds an unpaired day's hours to `unpairedFlagHours`
 * and never to `flagHours` — so on /insights they are not in any figure on
 * screen. One sentence for both would be false on one of them; two hand-written
 * captions is the duplication that caused this escalation. Hence one clause
 * builder with one interchangeable sentence in the middle.
 */
export type UnpairedSurface = "period" | "trend";

const PLACEMENT: Record<UnpairedSurface, string> = {
  period:
    "They're in your flagged total above, but in neither side of the percentage.",
  trend: "They're in neither side of the percentage.",
};

/**
 * Cause and correction for each reason, singular and plural.
 *
 * One row per reason and no row shared between two of them: folding day_off and
 * unscheduled back into no_schedule is exactly what made this caption tell a
 * tech with a schedule to "add them to your schedule" for a day that was
 * already on it, marked off. The corrections are three different actions.
 *
 * The in_progress cause is WorkCostCard's, unchanged: that card has printed
 * "that shift is still in progress" off wage-check's `ongoingDays` all along,
 * and one situation gets one sentence.
 */
type ClausePair = { one: string; many: string };
const CAUSE: Record<UnpairedReason, ClausePair> = {
  in_progress: {
    one: "— that shift is still in progress, so there are no hours to divide it by yet.",
    many: "— those shifts are still in progress, so there are no hours to divide them by yet.",
  },
  day_off: {
    one: "— that day is marked off on your schedule, so it has no shift length to divide by.",
    many: "— those days are marked off on your schedule, so they have no shift length to divide by.",
  },
  unscheduled: {
    one: "— your schedule puts no shift on that day, so the app can't tell how long it was.",
    many: "— your schedule puts no shift on those days, so the app can't tell how long they were.",
  },
  no_schedule: {
    one: "with no clocked hours and no work schedule — the app can't tell how long that day was.",
    many: "with no clocked hours and no work schedule — the app can't tell how long those days were.",
  },
};

const ACTION: Record<UnpairedReason, ClausePair> = {
  // The only reason that needs no action: waiting IS the correct behaviour.
  in_progress: {
    one: "It counts once you clock out.",
    many: "They count once you clock out.",
  },
  day_off: {
    one: "Clock it, or clear the day off, to include it.",
    many: "Clock them, or clear those days off, to include them.",
  },
  unscheduled: {
    one: "Clock it, or add a shift for that day, to include it.",
    many: "Clock them, or add shifts for those days, to include them.",
  },
  no_schedule: {
    one: "Clock it or add it to your schedule to include it.",
    many: "Clock them or add them to your schedule to include them.",
  },
};

/**
 * The clause that follows "…flagged across N days" in both captions.
 *
 * cause → where the hours actually are (per surface) → what to do about it.
 */
export function unpairedNoteClause(
  note: UnpairedNote,
  surface: UnpairedSurface,
): string {
  const n: keyof ClausePair = note.days === 1 ? "one" : "many";
  return `${CAUSE[note.kind][n]} ${PLACEMENT[surface]} ${ACTION[note.kind][n]}`;
}

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
  /**
   * No denominator at all: today, the future, a day off, or no schedule.
   * `reason` says WHICH — the four used to be indistinguishable downstream.
   */
  | { kind: "none"; reason: UnpairedReason };

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
  // Same three tests, same short-circuit order as before — each one now says
  // which of them fired. `clocked > 0` already returned above, so reaching the
  // in-progress test means the day has no clock entry, which is exactly
  // wage-check's `isOngoing` (see isInProgressDay).
  if (!schedule) return { kind: "none", reason: "no_schedule" };
  if (isInProgressDay(date, today, clocked, true)) {
    return { kind: "none", reason: "in_progress" };
  }
  if (off.has(date)) return { kind: "none", reason: "day_off" };
  const scheduled = scheduledHoursFor(
    schedule.schedules,
    date,
    schedule.shiftOverrides ?? {},
  );
  // A valid shift always has positive paid hours (shiftFromHours rejects 0), so
  // `<= 0` and `null` are the same answer: this day has no scheduled length.
  if (scheduled === null || scheduled <= 0) {
    return { kind: "none", reason: "unscheduled" };
  }
  if (flag > 0 || confirmedZero.has(date)) {
    return { kind: "counted", denom: { hours: scheduled, source: "scheduled" } };
  }
  return { kind: "unresolved" };
}

/**
 * A day with open-ticket hours is a WORKED day (Open Tickets, decision 7): no
 * unresolved-day prompt, the streak continues, schedule inference sees a
 * shift. In the pairing rule that is exactly what a confirmed real-zero day
 * already is — a day the tech was at the shop and flagged nothing — so the
 * open_work dates are folded into `confirmedZeroDays` here, in ONE place,
 * rather than taught to pairDay, dailyDenominators and wage-check's fill
 * separately (the two-figures escalation was three copies of one rule).
 *
 * "Worked — unpaid" set the precedent: it reuses the confirmed_zero_day
 * marker for the same reason (src/app/actions/schedule.ts).
 *
 * The efficiency arithmetic is untouched by this: the day's flag is still 0
 * and its scheduled hours still count, exactly as they would once the tech
 * confirmed the day by hand. What changes is that the app no longer ASKS.
 */
export function withOpenWorkDays(
  ctx: ScheduleContext,
  unpaid: UnpaidTime[],
  range: { start: string; end: string },
): ScheduleContext {
  const dates = openWorkDates(unpaid, range.start, range.end);
  if (dates.size === 0) return ctx;
  return {
    ...ctx,
    confirmedZeroDays: [...new Set([...ctx.confirmedZeroDays, ...dates])],
  };
}

export function aggregateStatsWithSchedule(
  entries: Entry[],
  clocks: DailyClock[],
  range: { start: string; end: string },
  schedCtx: ScheduleContext,
  unpaid: UnpaidTime[] = [],
): ScheduleStats {
  const base = aggregateStats(entries, clocks, range, unpaid);
  const ctx = withOpenWorkDays(schedCtx, unpaid, range);

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
  const unpairedByReason = emptyUnpairedByReason();
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
      // Same day, same hours, one extra fact: which of the four "none" cases
      // this was. The totals above are untouched — the breakdown sums to them.
      if (paired.kind === "none") {
        const tally = unpairedByReason[paired.reason];
        tally.flagHours += flag;
        tally.days += 1;
      }
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
    unpairedByReason,
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
  // Optional so every existing caller keeps working. Passed by the surfaces
  // that have the ledger, so a day with open-ticket hours pairs here exactly
  // as it pairs in aggregateStatsWithSchedule — see withOpenWorkDays.
  unpaid: UnpaidTime[] = [],
): Record<string, DayDenom> {
  const out: Record<string, DayDenom> = {};
  if (schedule && openWorkRows(unpaid).length > 0) {
    schedule = withOpenWorkDays(schedule, unpaid, range);
  }
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
): Stats & {
  denomHours?: number;
  denomSource?: DenomSource | null;
  // Present whenever the schedule branch ran. Widened onto the union so callers
  // that have to CLASSIFY the efficiency (lib/efficiency-display) can read the
  // excluded hours the schedule aggregator already computed, instead of being
  // handed a number with no way to tell whether it means anything.
  unpairedFlagHours?: number;
  unpairedDays?: number;
  // Same reason, one level further: a caller that has to EXPLAIN the excluded
  // hours (PeriodStats' caption) needs to know which of the four cases they
  // were, and the schedule branch already worked it out.
  unpairedByReason?: UnpairedByReason;
} {
  if (schedule && schedule.schedules.length > 0) {
    return aggregateStatsWithSchedule(entries, clocks, range, schedule, unpaid);
  }
  return aggregateStats(entries, clocks, range, unpaid);
}
