// Work schedules — the fallback efficiency denominator (schedule-based
// efficiency plan). A schedule answers one question: "how many paid hours was
// this tech supposed to work on date X?" Clocked hours, when entered, always
// beat the schedule; the schedule only fills silent days.
//
// Model:
//   - Schedules are effective-dated and append-only: the row that applies to
//     a date is the latest one with effectiveFrom <= date. History before a
//     schedule change never recalculates.
//   - rotationWeeks 1 or 2. Week A is the week containing effectiveFrom
//     (anchorMonday = Monday of that week); parity from anchorMonday decides
//     which week a date falls in.
//   - A day is either off (null) or a shift {start, end, breakMin}; paid
//     hours are derived, never stored.
//
// All date math is string-based ("YYYY-MM-DD"), same timezone-safe
// convention as src/lib/periods.ts and src/lib/streak.ts.

import { addDays } from "@/lib/periods";

export type ShiftDef = {
  start: string; // "HH:MM", 24h
  end: string; // "HH:MM", must be after start (no overnight shifts in v1)
  breakMin: number; // unpaid break, minutes
};

/** One week of the pattern. null = not a workday. */
export type ScheduleWeek = {
  mon: ShiftDef | null;
  tue: ShiftDef | null;
  wed: ShiftDef | null;
  thu: ShiftDef | null;
  fri: ShiftDef | null;
  sat: ShiftDef | null;
  sun: ShiftDef | null;
};

export type WorkSchedule = {
  id: string;
  effectiveFrom: string; // "YYYY-MM-DD"
  rotationWeeks: 1 | 2;
  anchorMonday: string; // Monday of week A
  weeks: ScheduleWeek[]; // length === rotationWeeks
  createdAt: string;
};

/** Index with weekdayOf() (0=Sun..6=Sat). */
export const WEEKDAY_KEYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** Weekday (0=Sun..6=Sat) from components at local midnight — same
 * timezone-safe convention as streak.ts/forecast.ts. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** Monday of the week containing `date` (weeks run Mon–Sun). */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** Whole days from `a` to `b` (negative if b < a). UTC math — DST-proof. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Paid hours of a shift: (end − start) − break, in hours. */
export function shiftPaidHours(shift: ShiftDef): number {
  return (minutesOf(shift.end) - minutesOf(shift.start) - shift.breakMin) / 60;
}

/** The schedule version in force on `date`: latest effectiveFrom <= date.
 * null before the earliest schedule — forward-only, no retroactive fallback. */
export function scheduleForDate(
  schedules: WorkSchedule[],
  date: string,
): WorkSchedule | null {
  let best: WorkSchedule | null = null;
  for (const s of schedules) {
    if (s.effectiveFrom > date) continue;
    if (!best || s.effectiveFrom > best.effectiveFrom) best = s;
  }
  return best;
}

/** Which rotation week (0-based) `date` falls in for `schedule`. */
export function weekIndexFor(schedule: WorkSchedule, date: string): number {
  const weeks = Math.floor(
    daysBetween(schedule.anchorMonday, mondayOf(date)) / 7,
  );
  const n = schedule.rotationWeeks;
  return ((weeks % n) + n) % n;
}

/** One-day departures from the pattern, keyed by ISO date. An override wins
 * over the pattern — including on pattern-off days and dates with no
 * schedule at all (it's explicit). Still a *plan*: provenance stays
 * "scheduled". */
export type ShiftOverrideMap = Record<string, ShiftDef>;

/** The shift scheduled on `date`, or null (off day / no schedule yet). */
export function shiftForDate(
  schedules: WorkSchedule[],
  date: string,
  overrides: ShiftOverrideMap = {},
): ShiftDef | null {
  const override = overrides[date];
  if (override) return override;
  const schedule = scheduleForDate(schedules, date);
  if (!schedule) return null;
  const week = schedule.weeks[weekIndexFor(schedule, date)];
  if (!week) return null;
  return week[WEEKDAY_KEYS[weekdayOf(date)]];
}

/** Scheduled paid hours for `date`, or null if it isn't a scheduled workday.
 * This is the efficiency fallback denominator — clocked hours always win. */
export function scheduledHoursFor(
  schedules: WorkSchedule[],
  date: string,
  overrides: ShiftOverrideMap = {},
): number | null {
  const shift = shiftForDate(schedules, date, overrides);
  return shift === null ? null : shiftPaidHours(shift);
}

/** Like scheduledHoursFor, but dates BEFORE the first schedule existed borrow
 * the EARLIEST schedule's pattern (weekIndexFor's modulo handles negative
 * week offsets). Display-only fallback for chart hover readouts — period
 * stats stay forward-only, so adding a schedule never rewrites history. */
export function scheduledHoursForRetro(
  schedules: WorkSchedule[],
  date: string,
  overrides: ShiftOverrideMap = {},
): number | null {
  const inForce = scheduledHoursFor(schedules, date, overrides);
  if (inForce !== null) return inForce;
  const current = scheduleForDate(schedules, date);
  if (current !== null) return null; // a schedule was in force — day is genuinely off
  let earliest: WorkSchedule | null = null;
  for (const s of schedules) {
    if (!earliest || s.effectiveFrom < earliest.effectiveFrom) earliest = s;
  }
  if (!earliest) return null;
  const week = earliest.weeks[weekIndexFor(earliest, date)];
  const shift = week ? week[WEEKDAY_KEYS[weekdayOf(date)]] : null;
  return shift === null ? null : shiftPaidHours(shift);
}

/** Build a ShiftDef from the hours-first editor inputs: paid hours + start
 * time + unpaid lunch. End time is derived. Null when the inputs don't form
 * a valid same-day shift. */
export function shiftFromHours(
  paidHours: number,
  start: string,
  breakMin: number,
): ShiftDef | null {
  if (!Number.isFinite(paidHours) || paidHours <= 0 || paidHours > 24) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return null;
  if (!Number.isInteger(breakMin) || breakMin < 0) return null;
  const [h, m] = start.split(":").map(Number);
  const endMin = h * 60 + m + Math.round(paidHours * 60) + breakMin;
  if (endMin >= 24 * 60) return null; // spills past midnight
  const eh = String(Math.floor(endMin / 60)).padStart(2, "0");
  const em = String(endMin % 60).padStart(2, "0");
  return { start, end: `${eh}:${em}`, breakMin };
}

// ------------------------------------------------------------------------
// Validation (shared by the editor and the server action)
// ------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** First problem found, or null if the weeks are valid. */
export function validateWeeks(
  weeks: ScheduleWeek[],
  rotationWeeks: number,
): string | null {
  if (weeks.length !== rotationWeeks)
    return "Schedule must define exactly one pattern per rotation week.";
  let workdays = 0;
  for (const week of weeks) {
    for (const key of WEEKDAY_KEYS) {
      const shift = week[key];
      if (shift === null) continue;
      workdays += 1;
      if (!TIME_RE.test(shift.start) || !TIME_RE.test(shift.end))
        return "Shift times must be HH:MM (24-hour).";
      if (minutesOf(shift.end) <= minutesOf(shift.start))
        return "Shift end must be after shift start.";
      if (!Number.isInteger(shift.breakMin) || shift.breakMin < 0)
        return "Break minutes must be zero or more.";
      if (shiftPaidHours(shift) <= 0)
        return "Break can't be as long as the whole shift.";
    }
  }
  if (workdays === 0) return "Schedule needs at least one workday.";
  return null;
}

// ------------------------------------------------------------------------
// Pre-fill inference — which weekdays does this tech actually work?
// Reuses the streak feature's rule (streak.ts): a weekday is a workday if it
// was logged on >= 3 of its last 4 occurrences. Times default to 8–5 with an
// hour break (8 paid hours); the editor is where the tech corrects them.
// ------------------------------------------------------------------------

const INFER_LOOKBACK = 4;
const INFER_MIN = 3;

export const DEFAULT_SHIFT: ShiftDef = {
  start: "08:00",
  end: "17:00",
  breakMin: 60,
};

export function emptyWeek(): ScheduleWeek {
  return {
    mon: null,
    tue: null,
    wed: null,
    thu: null,
    fri: null,
    sat: null,
    sun: null,
  };
}

/** Infer a single-week pattern from logging history, or null if there isn't
 * enough history to say anything (editor falls back to blank Mon–Fri). */
export function inferScheduleWeek(
  loggedDates: string[],
  today: string,
): ScheduleWeek | null {
  const logged = new Set(loggedDates.filter((d) => d < today));
  if (logged.size === 0) return null;

  const week = emptyWeek();
  let anyInferred = false;
  for (let w = 0; w < 7; w++) {
    // Walk back from the most recent past occurrence of weekday w.
    let d = addDays(today, -1);
    d = addDays(d, -((weekdayOf(d) - w + 7) % 7));
    let hits = 0;
    let seen = 0;
    for (; seen < INFER_LOOKBACK; d = addDays(d, -7)) {
      seen += 1;
      if (logged.has(d)) hits += 1;
    }
    if (hits >= INFER_MIN) {
      week[WEEKDAY_KEYS[w]] = { ...DEFAULT_SHIFT };
      anyInferred = true;
    }
  }
  return anyInferred ? week : null;
}
