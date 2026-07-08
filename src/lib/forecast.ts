// Forward projection of the current pay period — "will I hit my number?"
//
// Pure math, no I/O. Everything here is deterministic and unit-tested so the
// tech can verify the number on a napkin. Date inputs/outputs are
// "YYYY-MM-DD" strings and follow the same string-date convention as
// src/lib/periods.ts — no Date objects at the boundaries, so server/client
// timezones can never disagree.
import type { Entry } from "./types";
import { addDays } from "./periods";

// ------------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------------

// JS getDay() order: 0 = Sunday .. 6 = Saturday.
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// Default assumption when a tech has no history yet: a standard Mon–Fri week.
export const DEFAULT_WORKED_WEEKDAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

// Below this many distinct worked days in the lookback window, an average
// isn't trustworthy — the UI shows "not enough history yet" instead.
const MIN_WORKED_DAYS = 5;

// ------------------------------------------------------------------------
// Date primitives (string-based, timezone-safe)
// ------------------------------------------------------------------------

// Weekday (0=Sun..6=Sat) for a "YYYY-MM-DD" string. Built from explicit
// components at local midnight, so the result never shifts with timezone.
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

// ------------------------------------------------------------------------
// Worked-days accounting
// ------------------------------------------------------------------------

// Sum flagged hours per calendar date within [from, to] (inclusive).
// Only dates with at least one entry appear — a sick day (no entries) never
// shows up, so it can't drag an average down.
function flagHoursByDate(
  entries: Entry[],
  from: string,
  to: string,
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.flagHours);
  }
  return byDate;
}

/**
 * Infer which weekdays the tech actually works, from days with any flagged
 * hours over the last `lookbackWeeks` weeks (default 8). Returns a set of
 * JS weekday indices (0=Sun..6=Sat).
 *
 * When there's no history and `fallbackToDefault` is true (the default), the
 * standard Mon–Fri week is returned so the UI can still count remaining days.
 * Pass `fallbackToDefault: false` to get the raw inferred set (may be empty).
 */
export function inferWorkedWeekdays(
  entries: Entry[],
  opts: { today: string; lookbackWeeks?: number; fallbackToDefault?: boolean },
): Set<number> {
  const lookbackWeeks = opts.lookbackWeeks ?? 8;
  const fallbackToDefault = opts.fallbackToDefault ?? true;
  const from = addDays(opts.today, -(lookbackWeeks * 7 - 1));

  const worked = new Set<number>();
  for (const [date, hours] of flagHoursByDate(entries, from, opts.today)) {
    if (hours > 0) worked.add(weekdayOf(date));
  }

  if (worked.size === 0 && fallbackToDefault) {
    return new Set(DEFAULT_WORKED_WEEKDAYS);
  }
  return worked;
}

/**
 * Count the tech's working days left in the period — days strictly after
 * `today` up to and including `periodEnd` whose weekday is in `workedWeekdays`.
 *
 * "Today" is excluded because `current` flagged hours already reflect whatever
 * was flagged today; remaining days are the ones still to come. Returns 0 once
 * the period has ended (today >= periodEnd).
 */
export function workingDaysRemaining(
  periodEnd: string,
  today: string,
  workedWeekdays: ReadonlySet<number>,
): number {
  if (today >= periodEnd) return 0;
  let count = 0;
  let cursor = addDays(today, 1);
  while (cursor <= periodEnd) {
    if (workedWeekdays.has(weekdayOf(cursor))) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
}

/**
 * Average flagged hours per worked day over a lookback window ending at
 * `today`. Returns null when there aren't enough worked days to trust
 * (< `minWorkedDays`, default 5) — the caller shows an insufficient-history
 * state rather than a shaky projection.
 *
 * `workedDaysOnly` (default true) divides by distinct worked days; set false
 * to divide by every calendar day in the window instead.
 */
export function recentDailyAverage(
  entries: Entry[],
  opts: {
    today: string;
    lookbackDays?: number;
    workedDaysOnly?: boolean;
    minWorkedDays?: number;
  },
): number | null {
  const lookbackDays = opts.lookbackDays ?? 30;
  const workedDaysOnly = opts.workedDaysOnly ?? true;
  const minWorkedDays = opts.minWorkedDays ?? MIN_WORKED_DAYS;
  const from = addDays(opts.today, -(lookbackDays - 1));

  const byDate = flagHoursByDate(entries, from, opts.today);

  let total = 0;
  let workedDays = 0;
  for (const hours of byDate.values()) {
    total += hours;
    if (hours > 0) workedDays++;
  }

  if (workedDays < minWorkedDays) return null;

  if (workedDaysOnly) return total / workedDays;
  return total / lookbackDays;
}

// ------------------------------------------------------------------------
// Projection
// ------------------------------------------------------------------------

export type Projection = {
  projected: number;
  goal: number;
  gap: number; // projected - goal; negative = short, positive = over
  requiredPerDay: number | null; // hrs/day still needed to hit goal; null when no days left
};

/**
 * Project the period-end total from where the tech stands now.
 *
 * projected      = current + avgPerDay × daysRemaining
 * gap            = projected − goal (signed)
 * requiredPerDay = remaining hours to goal ÷ working days left
 *                  (0 once the goal is met, null when no working days remain)
 */
export function projectPeriod(
  current: number,
  avgPerDay: number,
  daysRemaining: number,
  goal: number,
): Projection {
  const projected = current + avgPerDay * daysRemaining;
  const remainingToGoal = Math.max(0, goal - current);
  const requiredPerDay = daysRemaining > 0 ? remainingToGoal / daysRemaining : null;
  return {
    projected,
    goal,
    gap: projected - goal,
    requiredPerDay,
  };
}

// ------------------------------------------------------------------------
// Weekday pattern (shared with a future insights page)
// ------------------------------------------------------------------------

export type WeekdayStat = {
  weekday: number; // 0=Sun..6=Sat
  label: string; // "Mon"
  meanFlagHours: number; // average over worked instances of this weekday (0 if never worked)
  workedDays: number; // how many distinct dates of this weekday were worked
};

/**
 * Average flagged hours by weekday over the last `weeks` weeks (default 8),
 * on a worked-days basis. Returns all 7 weekdays in Sun..Sat order so a chart
 * can render a stable axis. Shared shape for the dashboard and a later
 * insights page.
 */
export function weekdayPattern(
  entries: Entry[],
  opts: { today: string; weeks?: number },
): WeekdayStat[] {
  const weeks = opts.weeks ?? 8;
  const from = addDays(opts.today, -(weeks * 7 - 1));

  const totalByDow = new Array(7).fill(0);
  const workedByDow = new Array(7).fill(0);

  for (const [date, hours] of flagHoursByDate(entries, from, opts.today)) {
    if (hours <= 0) continue;
    const dow = weekdayOf(date);
    totalByDow[dow] += hours;
    workedByDow[dow]++;
  }

  return DAY_SHORT.map((label, dow) => ({
    weekday: dow,
    label,
    meanFlagHours: workedByDow[dow] > 0 ? totalByDow[dow] / workedByDow[dow] : 0,
    workedDays: workedByDow[dow],
  }));
}

// ------------------------------------------------------------------------
// Dashboard orchestrator
// ------------------------------------------------------------------------

export type ForecastState = "ahead" | "close" | "behind" | "insufficient-history";

export type Forecast = {
  state: ForecastState;
  current: number; // flagged hours so far this period
  goal: number;
  avgPerDay: number | null; // recent flagged hrs per worked day
  daysRemaining: number; // working days left in the period
  projected: number | null; // period-end projection (null when history is insufficient)
  gap: number | null; // projected - goal (null when no projection)
  requiredPerDay: number | null; // hrs/day still needed to hit goal
  workedWeekdays: number[]; // inferred working weekdays, sorted (0=Sun..6=Sat)
};

// A projection within this fraction below goal counts as "close" rather than
// "behind" — 10% per the plan.
const CLOSE_BAND = 0.1;

/**
 * One-call forecast for the dashboard server component. Everything is derived
 * from data already loaded (entries + settings) — no fetches. Determines the
 * four display states:
 *   - insufficient-history: not enough worked days to average yet
 *   - ahead:  projected ≥ goal
 *   - close:  projected within 10% below goal
 *   - behind: projected more than 10% below goal
 */
export function computeForecast(
  entries: Entry[],
  opts: {
    today: string;
    periodEnd: string;
    current: number;
    goal: number;
    lookbackDays?: number;
    lookbackWeeks?: number;
  },
): Forecast {
  const workedSet = inferWorkedWeekdays(entries, {
    today: opts.today,
    lookbackWeeks: opts.lookbackWeeks,
  });
  const workedWeekdays = [...workedSet].sort((a, b) => a - b);
  const daysRemaining = workingDaysRemaining(opts.periodEnd, opts.today, workedSet);

  const avgPerDay = recentDailyAverage(entries, {
    today: opts.today,
    lookbackDays: opts.lookbackDays,
  });

  if (avgPerDay === null) {
    return {
      state: "insufficient-history",
      current: opts.current,
      goal: opts.goal,
      avgPerDay: null,
      daysRemaining,
      projected: null,
      gap: null,
      requiredPerDay: null,
      workedWeekdays,
    };
  }

  const { projected, gap, requiredPerDay } = projectPeriod(
    opts.current,
    avgPerDay,
    daysRemaining,
    opts.goal,
  );

  let state: ForecastState;
  if (projected >= opts.goal) {
    state = "ahead";
  } else if (projected >= opts.goal * (1 - CLOSE_BAND)) {
    state = "close";
  } else {
    state = "behind";
  }

  return {
    state,
    current: opts.current,
    goal: opts.goal,
    avgPerDay,
    daysRemaining,
    projected,
    gap,
    requiredPerDay,
    workedWeekdays,
  };
}
