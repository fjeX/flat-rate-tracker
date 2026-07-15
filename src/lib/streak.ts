// Work-day logging streak (gamification Phase 1 — docs/gamification.md).
//
// The streak counts days the tech WORKED AND LOGGED, keyed by RO date (not
// entry timestamp), so logging yesterday's RO tonight repairs yesterday.
// Days that don't break it:
//   - explicit days off (days_off ranges — vacation, injury)
//   - days that aren't "expected" work days, inferred from recent history:
//     a weekday only counts as expected if the tech logged on that weekday
//     at least EXPECTED_MIN of the trailing EXPECTED_LOOKBACK occurrences.
//     With little history nothing is expected, so a new user's streak can
//     grow but never break — forgiving by design.
//   - today, while it's still unlogged (the day isn't over)
//   - one isolated missed expected day (grace) — only two consecutive missed
//     expected work days break the streak. One sick day without a days_off
//     entry is a freeze, not a reset; that's the streak-anxiety guard.
//
// Everything is derived at read time from entry dates. No stored counters.

import { addDays } from "@/lib/periods";

/** Weekday must be logged in >= 3 of its last 4 occurrences to be "expected". */
const EXPECTED_LOOKBACK = 4;
const EXPECTED_MIN = 3;
/** Consecutive missed expected days tolerated before the streak resets. */
const MISS_GRACE = 1;

/** Streak milestone ladder for the heat gauge. */
export const STREAK_MILESTONES = [5, 10, 15, 30, 50, 75, 100, 150, 200, 365];

export type StreakResult = {
  /** Consecutive expected work days logged, up to and including today. */
  current: number;
  /** All-time longest run (high-water mark — display never decreases it). */
  longest: number;
  /** Whether today already has a log. */
  todayLogged: boolean;
  /** Next milestone above `current`, or null past the ladder. */
  nextMilestone: number | null;
  /** Milestones at or below `current`. */
  milestonesHit: number[];
};

export type StreakInput = {
  /** Distinct ISO dates ("YYYY-MM-DD") that have at least one RO. Any order. */
  loggedDates: string[];
  /** Explicit off ranges, inclusive on both ends. */
  daysOff: { startDate: string; endDate: string }[];
  /** Today in the user's timezone. */
  today: string;
};

// Weekday (0=Sun..6=Sat) from explicit components at local midnight — same
// timezone-safe convention as src/lib/forecast.ts.
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** Expand off ranges into a Set of ISO dates (capped defensively). */
export function expandDaysOff(
  ranges: { startDate: string; endDate: string }[],
): Set<string> {
  const out = new Set<string>();
  for (const r of ranges) {
    let d = r.startDate;
    // Cap each range at 2 years so a bad row can't hang the walk.
    for (let i = 0; d <= r.endDate && i < 731; i++) {
      out.add(d);
      d = addDays(d, 1);
    }
  }
  return out;
}

export function computeStreak(input: StreakInput): StreakResult {
  const logged = new Set(input.loggedDates.filter((d) => d <= input.today));
  const off = expandDaysOff(input.daysOff);
  const todayLogged = logged.has(input.today);

  if (logged.size === 0) {
    return {
      current: 0,
      longest: 0,
      todayLogged: false,
      nextMilestone: STREAK_MILESTONES[0],
      milestonesHit: [],
    };
  }

  const first = [...logged].sort()[0];

  // Rolling per-weekday history of the trailing EXPECTED_LOOKBACK occurrences.
  // seen[w] counts occurrences walked so far; loggedRecent[w] is a FIFO of
  // booleans for the last EXPECTED_LOOKBACK occurrences of weekday w.
  const recent: boolean[][] = Array.from({ length: 7 }, () => []);

  let current = 0;
  let longest = 0;
  let missedRun = 0; // consecutive missed EXPECTED days, reset by any log

  for (let d = first; d <= input.today; d = addDays(d, 1)) {
    const w = weekdayOf(d);
    const hist = recent[w];
    // Expected = enough history AND the tech usually logs this weekday.
    const expected =
      hist.length >= EXPECTED_LOOKBACK &&
      hist.filter(Boolean).length >= EXPECTED_MIN;

    if (logged.has(d)) {
      current += 1;
      missedRun = 0;
    } else if (d === input.today) {
      // Today isn't over — never break on it, just don't count it yet.
    } else if (off.has(d) || !expected) {
      // Frozen: explicit day off, or not an expected work day.
    } else {
      missedRun += 1;
      if (missedRun > MISS_GRACE) current = 0;
    }
    if (current > longest) longest = current;

    // Days off don't teach the pattern — skip them from expectation history
    // so a two-week vacation doesn't mark every weekday "unexpected".
    if (!off.has(d)) {
      hist.push(logged.has(d));
      if (hist.length > EXPECTED_LOOKBACK) hist.shift();
    }
  }

  const nextMilestone =
    STREAK_MILESTONES.find((m) => m > current) ?? null;
  const milestonesHit = STREAK_MILESTONES.filter((m) => m <= current);

  return { current, longest, todayLogged, nextMilestone, milestonesHit };
}

/**
 * Marks for the heat gauge: a window of the ladder around `current` — every
 * hit milestone up to two back, plus the next two ahead. The gauge maxes at
 * the last mark so the fill always has somewhere to go.
 */
export function gaugeMarks(current: number): number[] {
  const nextIdx = STREAK_MILESTONES.findIndex((m) => m > current);
  if (nextIdx === -1) return STREAK_MILESTONES.slice(-4);
  const start = Math.max(0, nextIdx - 2);
  return STREAK_MILESTONES.slice(start, start + 4);
}
