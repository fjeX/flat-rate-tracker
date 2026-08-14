// Job mix — what actually makes a day big.
//
// Every other analysis in this app measures HOW FAST the tech worked. This one
// measures WHAT THEY WERE HANDED, and it exists because the production data says
// that is the larger lever by a wide margin.
//
// Two techs, ~90 days each, independently:
//
//   correlation between a day's flag hours and...
//                          Liem     Christian
//     # of heavy lines     0.572      0.704
//     # of quick lines     0.067     -0.027
//
// The number of quick maintenance jobs turned in a day has NO relationship to
// what the day paid. Christian's is faintly negative — on his best days he does
// fewer of them. Meanwhile his worst quartile averaged 6.2 flag hours and his
// best 15.5, on a line count that barely moved (8.7 → 10.3) and a heavy-line
// count that moved 0.1 → 2.1.
//
// That finding is why the app does not ask a tech to time an oil change. Perfect
// measurement of the maintenance grind would describe something that does not
// vary with the paycheck. This module measures the thing that does.
//
// NOTHING HERE NEEDS A TIMER. Every figure is computed from flag hours and line
// composition, both of which are already recorded on every RO. That is the whole
// point: it pays off on day one, for every user, without asking anyone to change
// how they log.
//
// Pure functions. No I/O, no React.
import type { DayDenom } from "./stats";
import { computeEfficiency } from "./stats";
import type { Entry } from "./types";

/**
 * The flag-hours line above which a job is worth measuring individually.
 *
 * TWO HOURS. Lines at or above it are 32% of all lines logged and 63.6% of all
 * flag hours — the minority of work that carries the majority of the money. It
 * is also the threshold above which timing a job is worth the interruption: at
 * roughly one such line per day, asking is a once-a-day event rather than the
 * ten-times-a-day nag that made the timer feel pointless.
 *
 * Not user-configurable yet, deliberately. A threshold every tech tunes
 * differently is a threshold no two of them can compare notes on, and the peer
 * aggregates in labor_time_aggregates depend on a shared definition.
 */
export const HEAVY_FLAG_HOURS = 2;

/**
 * At or below this, a job is quick maintenance — the LOF/rotate/filter grind.
 *
 * 30% of all lines, 9.2% of all flag hours. Tracked ONLY so the page can show
 * that doing more of them does not move the day, which is the single most
 * counter-intuitive and most useful thing this module has to say.
 */
export const QUICK_FLAG_HOURS = 0.5;

/**
 * Days needed before quartile bands mean anything.
 *
 * TWELVE, so the smallest band still holds three days. Below that a single
 * unusual day IS a band, and the page would present noise as a pattern — the
 * exact failure the min-sample rules elsewhere in this codebase exist to stop.
 */
export const MIN_DAYS_FOR_BANDS = 12;

/**
 * Days needed before a correlation is reported at all.
 *
 * TEN. Pearson's r on fewer points swings wildly with one outlier, and this
 * module's headline claim IS a correlation. Reporting r = 0.9 from six days
 * would be the most confident wrong number on the page.
 */
export const MIN_DAYS_FOR_CORRELATION = 10;

// ---------------------------------------------------------------------------
// The shape of one day
// ---------------------------------------------------------------------------

export type DayShape = {
  date: string;
  /** Flag hours the day earned. */
  flagHours: number;
  /** Every line logged that day, whatever its size. */
  lines: number;
  /** Lines at or above HEAVY_FLAG_HOURS. */
  heavyLines: number;
  /** Flag hours contributed by those heavy lines alone. */
  heavyFlagHours: number;
  /** Lines at or below QUICK_FLAG_HOURS. */
  quickLines: number;
  /**
   * The day's denominator, or null when the app does not know how long the day
   * was. Carried so the UI can show efficiency where it is known WITHOUT this
   * module ever computing its own — see the header of lib/insights.ts for what
   * happens when two surfaces derive efficiency separately.
   */
  denomHours: number | null;
  efficiency: number | null;
};

/**
 * One row per day the tech either logged work on or was known to be at the shop.
 *
 * Both sources, not just entries — a day the tech was there and flagged nothing
 * is the most extreme mix there is, and it has no RO to be found by. This
 * mirrors periodTrend, which takes the same union for the same reason.
 *
 * Comeback lines are counted in `lines` but contribute no flag hours (they flag
 * zero by DB CHECK), so they can never inflate a band. They are not excluded,
 * because the tech's day genuinely contained them.
 */
export function dayShapes(
  entries: Entry[],
  denomByDay: Record<string, DayDenom>,
): DayShape[] {
  const byDate = new Map<string, DayShape>();

  const touch = (date: string): DayShape => {
    let day = byDate.get(date);
    if (!day) {
      day = {
        date,
        flagHours: 0,
        lines: 0,
        heavyLines: 0,
        heavyFlagHours: 0,
        quickLines: 0,
        denomHours: null,
        efficiency: null,
      };
      byDate.set(date, day);
    }
    return day;
  };

  for (const entry of entries) {
    const day = touch(entry.date);
    for (const line of entry.opCodes) {
      day.lines += 1;
      day.flagHours += line.flagHours;
      if (line.flagHours >= HEAVY_FLAG_HOURS) {
        day.heavyLines += 1;
        day.heavyFlagHours += line.flagHours;
      } else if (line.flagHours > 0 && line.flagHours <= QUICK_FLAG_HOURS) {
        // `> 0` matters: a comeback flags zero and is not a quick job, it is
        // unpaid rework. Counting it here would make a day of free work look
        // like a day of easy money.
        day.quickLines += 1;
      }
    }
  }

  for (const [date, denom] of Object.entries(denomByDay)) {
    touch(date).denomHours = denom.hours;
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of days) {
    day.efficiency =
      day.denomHours === null
        ? null
        : computeEfficiency(day.flagHours, day.denomHours);
  }
  return days;
}

// ---------------------------------------------------------------------------
// Bands — the quartile table
// ---------------------------------------------------------------------------

export type MixBand = {
  /** 1 = the quietest quarter of days, 4 = the biggest. */
  quartile: 1 | 2 | 3 | 4;
  days: number;
  avgFlagHours: number;
  avgLines: number;
  avgHeavyLines: number;
  avgHeavyFlagHours: number;
  avgQuickLines: number;
  /** Share of the band's flag hours that came from heavy lines, 0–100. */
  pctFlagFromHeavy: number;
};

/**
 * Every day sorted by flag hours and cut into quarters, quietest first.
 *
 * Returns null rather than a short table when there is not enough history. A
 * quartile built from two days is not a quartile, and the honest move is to say
 * so — the UI renders the shortfall instead of a chart, the same way the op-code
 * table renders "never timed" instead of inventing a ratio.
 *
 * Ties are NOT grouped: two days with identical flag hours can land either side
 * of a boundary. That is acceptable here because the bands describe a
 * distribution, not individual days, and forcing tie-groups together would give
 * bands of wildly unequal size on a tech whose days cluster.
 */
export function mixBands(days: DayShape[]): MixBand[] | null {
  if (days.length < MIN_DAYS_FOR_BANDS) return null;

  const sorted = [...days].sort((a, b) => a.flagHours - b.flagHours);
  const size = sorted.length / 4;
  const bands: MixBand[] = [];

  for (let q = 0; q < 4; q++) {
    // Boundaries by proportion rather than a fixed count, so 13 days split
    // 4/3/3/3 instead of leaving a remainder band of one.
    const from = Math.round(q * size);
    const to = q === 3 ? sorted.length : Math.round((q + 1) * size);
    const slice = sorted.slice(from, to);
    if (slice.length === 0) return null;

    const sum = (pick: (d: DayShape) => number) =>
      slice.reduce((total, d) => total + pick(d), 0);
    const avgFlag = sum((d) => d.flagHours) / slice.length;
    const avgHeavyFlag = sum((d) => d.heavyFlagHours) / slice.length;

    bands.push({
      quartile: (q + 1) as 1 | 2 | 3 | 4,
      days: slice.length,
      avgFlagHours: avgFlag,
      avgLines: sum((d) => d.lines) / slice.length,
      avgHeavyLines: sum((d) => d.heavyLines) / slice.length,
      avgHeavyFlagHours: avgHeavyFlag,
      avgQuickLines: sum((d) => d.quickLines) / slice.length,
      pctFlagFromHeavy: avgFlag > 0 ? (avgHeavyFlag / avgFlag) * 100 : 0,
    });
  }
  return bands;
}

// ---------------------------------------------------------------------------
// Drivers — what a day's size actually tracks with
// ---------------------------------------------------------------------------

/**
 * Pearson correlation, or null when it is not defined.
 *
 * Null on a constant series is not a technicality worth papering over: if a tech
 * logged exactly two heavy lines every single day, the correlation between that
 * and anything else is genuinely undefined, and returning 0 would report "no
 * relationship" where the honest answer is "no variation to relate".
 */
export function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

export type MixDriver = {
  key: "heavyLines" | "quickLines" | "lines";
  label: string;
  /** Pearson r against the day's flag hours, or null when undefined. */
  r: number | null;
};

export type MixDrivers = {
  days: number;
  /** Null when there is too little history to report any correlation at all. */
  drivers: MixDriver[] | null;
};

/**
 * How strongly each kind of line count tracks the day's flag hours.
 *
 * Three deliberately chosen candidates, because the comparison IS the insight:
 * heavy lines and quick lines are the two things a tech can chase, and raw line
 * count is the intuition both of them get tested against ("a busy day is a good
 * day"). Reporting only the winner would leave the tech's actual belief
 * unexamined.
 */
export function mixDrivers(days: DayShape[]): MixDrivers {
  if (days.length < MIN_DAYS_FOR_CORRELATION) {
    return { days: days.length, drivers: null };
  }
  const flag = days.map((d) => d.flagHours);
  return {
    days: days.length,
    drivers: [
      {
        key: "heavyLines",
        label: `Big jobs (${HEAVY_FLAG_HOURS}h+)`,
        r: correlation(
          days.map((d) => d.heavyLines),
          flag,
        ),
      },
      {
        key: "quickLines",
        label: `Quick jobs (${QUICK_FLAG_HOURS}h or less)`,
        r: correlation(
          days.map((d) => d.quickLines),
          flag,
        ),
      },
      {
        key: "lines",
        label: "Total jobs logged",
        r: correlation(
          days.map((d) => d.lines),
          flag,
        ),
      },
    ],
  };
}

/**
 * How to read a correlation on this page, in words a tech would use.
 *
 * Thresholds are conventional (0.5 / 0.3 / 0.1) rather than tuned to this data —
 * tuning cut points to the sample you are describing is how a chart is made to
 * say what you wanted before you plotted it.
 */
export type DriverStrength = "strong" | "moderate" | "weak" | "none";

export function driverStrength(r: number | null): DriverStrength | null {
  if (r === null) return null;
  const a = Math.abs(r);
  if (a >= 0.5) return "strong";
  if (a >= 0.3) return "moderate";
  if (a >= 0.1) return "weak";
  return "none";
}

/**
 * Drivers ordered strongest-relationship first, with undefined ones pinned LAST.
 *
 * Lives here rather than in the component because the obvious one-liner is
 * wrong in a way that reads as fine: sorting on `Math.abs(r ?? -1)` scores a
 * NULL correlation as 1.0 and floats a driver with no measurable relationship
 * to the top of the list, directly above the ones that had something to say.
 */
export function rankedDrivers(drivers: MixDriver[]): MixDriver[] {
  const strength = (r: number | null) => (r === null ? -1 : Math.abs(r));
  return [...drivers].sort((a, b) => strength(b.r) - strength(a.r));
}

/**
 * The driver worth highlighting, or null when the strongest one is undefined
 * (highlighting "we can't tell" is worse than highlighting nothing).
 */
export function leadDriver(drivers: MixDriver[]): MixDriver | null {
  const top = rankedDrivers(drivers)[0];
  return top && top.r !== null ? top : null;
}

// ---------------------------------------------------------------------------
// The headline
// ---------------------------------------------------------------------------

export type MixSummary = {
  /** Flag hours on an average day in the quietest quarter. */
  worstFlagHours: number;
  /** …and in the biggest quarter. */
  bestFlagHours: number;
  /** Heavy lines on an average day, quietest vs biggest quarter. */
  worstHeavyLines: number;
  bestHeavyLines: number;
  /** Quick lines, same comparison. This is the one that barely moves. */
  worstQuickLines: number;
  bestQuickLines: number;
  /** Extra flag hours a big day carries over a quiet one. */
  spreadHours: number;
  /**
   * True when quick-job volume genuinely fails to explain the spread — the
   * finding this whole module exists to surface. Requires the quick-line
   * correlation to be measurable AND weak-or-none, so a tech whose data says
   * otherwise is never told a story their own history contradicts.
   */
  quickJobsDontMove: boolean;
};

export function mixSummary(
  bands: MixBand[] | null,
  drivers: MixDrivers,
): MixSummary | null {
  if (!bands || bands.length !== 4) return null;
  const worst = bands[0];
  const best = bands[3];
  const quick = drivers.drivers?.find((d) => d.key === "quickLines");
  const strength = driverStrength(quick?.r ?? null);

  return {
    worstFlagHours: worst.avgFlagHours,
    bestFlagHours: best.avgFlagHours,
    worstHeavyLines: worst.avgHeavyLines,
    bestHeavyLines: best.avgHeavyLines,
    worstQuickLines: worst.avgQuickLines,
    bestQuickLines: best.avgQuickLines,
    spreadHours: best.avgFlagHours - worst.avgFlagHours,
    quickJobsDontMove: strength === "weak" || strength === "none",
  };
}
