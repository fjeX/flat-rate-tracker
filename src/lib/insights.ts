// Shop intelligence — the cross-period questions the Pay Period page is not
// allowed to answer.
//
// Pay Period is scoped to ONE period on purpose: every figure on it describes
// the period in the title bar. That rule is what keeps the page readable, and it
// left the genuinely lifetime questions ("which jobs always run long?", "are my
// disputes getting paid?") with nowhere to live. They live here.
//
// Pure functions over data the caller already loaded. No I/O, no React.
//
// EFFICIENCY IS NOT RECOMPUTED HERE. Both aggregates below take the per-day
// denominator map from stats.dailyDenominators — the same map the dashboard
// hover readout and the period stats use. Summing flag hours against raw clock
// totals would have been simpler and would have quietly produced a THIRD answer
// to "how efficient was I", which is exactly how the last round of drift
// started: a weekday with one unclocked heavy day would read 300%.
import { computeEfficiency, type DayDenom } from "./stats";
import { formatPeriodLabel, getPeriodForDate } from "./periods";
import type { DailyClock, Entry, OpCode, PeriodOverride } from "./types";

// ---------------------------------------------------------------------------
// Where your time goes — per-op-code actual vs flag
// ---------------------------------------------------------------------------

export type OpCodePerformance = {
  key: string; // stable grouping id ("lib:<uuid>", "custom:<CODE>")
  code: string;
  description: string;
  uses: number; // every line of this op code, timed or not
  // Lines behind `ratio`: a real measurement against real book time. Three
  // kinds of line are counted in `uses` and excluded here:
  //   - never timed (actualHours null) — nothing to measure
  //   - actualHours 0 — no job takes zero time; that is a timer saved empty,
  //     and letting it through renders "0.00×", which reads as a job that costs
  //     nothing and outranks every genuine measurement on the page
  //   - flagHours 0 — a comeback (the DB forces those to zero flag) or a
  //     goodwill job, which would divide by zero
  timedUses: number;
  flagTotal: number;
  actualTotal: number;
  // actual ÷ flag. LOWER IS BETTER: 1.0 means the book time was right, 1.4 means
  // the job eats 40% more clock than it pays. null when never timed.
  ratio: number | null;
};

// A line's grouping identity. Sub-op-code variants roll up to their PARENT
// library code — a tech thinks "brakes", not "brakes, front, ceramic" — but each
// line still contributes its own flag hours, so the variant's book time is
// respected in the totals.
function groupKey(
  line: Entry["opCodes"][number],
  libraryById: Map<string, OpCode>,
): { key: string; code: string; description: string } | null {
  if (line.custom) {
    const code = (line.customCode ?? "").trim().toUpperCase();
    const desc = (line.customDescription ?? "").trim();
    if (code) return { key: `custom:${code}`, code, description: desc };
    // Custom lines with no code at all group by what they were called instead of
    // collapsing every one of them into a single "Custom" row.
    if (desc) {
      return {
        key: `customdesc:${desc.toUpperCase()}`,
        code: "Custom",
        description: desc,
      };
    }
    return { key: "custom:", code: "Custom", description: "" };
  }
  if (line.opCodeId) {
    const oc = libraryById.get(line.opCodeId);
    // A line pointing at a deleted library entry still happened. Keeping it under
    // its own id stops several deleted codes merging into one meaningless row.
    if (!oc) {
      return { key: `lib:${line.opCodeId}`, code: "—", description: "" };
    }
    return { key: `lib:${oc.id}`, code: oc.code, description: oc.description };
  }
  return null;
}

/**
 * Per-op-code performance across every entry passed in, worst ratio first.
 *
 * Never-timed codes sort last regardless of use count — they have nothing to say
 * yet, and floating them to the top on volume alone would bury the codes that
 * actually cost money.
 */
export function opCodePerformance(
  entries: Entry[],
  library: OpCode[],
): OpCodePerformance[] {
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const byKey = new Map<string, OpCodePerformance>();

  for (const entry of entries) {
    for (const line of entry.opCodes) {
      const id = groupKey(line, libraryById);
      if (!id) continue;
      let row = byKey.get(id.key);
      if (!row) {
        row = {
          key: id.key,
          code: id.code,
          description: id.description,
          uses: 0,
          timedUses: 0,
          flagTotal: 0,
          actualTotal: 0,
          ratio: null,
        };
        byKey.set(id.key, row);
      }
      row.uses += 1;
      if (line.actualHours !== null && line.actualHours > 0 && line.flagHours > 0) {
        row.timedUses += 1;
        row.flagTotal += line.flagHours;
        row.actualTotal += line.actualHours;
      }
    }
  }

  const rows = [...byKey.values()];
  for (const row of rows) {
    row.ratio = row.flagTotal > 0 ? row.actualTotal / row.flagTotal : null;
  }

  return rows.sort((a, b) => {
    if (a.ratio === null && b.ratio === null) return b.uses - a.uses;
    if (a.ratio === null) return 1;
    if (b.ratio === null) return -1;
    return b.ratio - a.ratio || b.uses - a.uses;
  });
}

export type RatioTier = "good" | "warn" | "bad";

/**
 * Colour tier for an actual÷flag ratio.
 *
 * Deliberately NOT stats.efficiencyTier: that one reads flag÷clock, where higher
 * is better. Feeding a ratio to it inverts every colour on the page — a job
 * bleeding 40% of its time would render green.
 */
export function ratioTier(ratio: number | null): RatioTier | null {
  if (ratio === null) return null;
  if (ratio <= 1.05) return "good";
  if (ratio <= 1.25) return "warn";
  return "bad";
}

// ---------------------------------------------------------------------------
// Best days — efficiency by weekday
// ---------------------------------------------------------------------------

export type WeekdayEfficiency = {
  weekday: number; // 0 = Sunday
  flagHours: number;
  denomHours: number;
  days: number; // how many of that weekday had a denominator at all
  efficiency: number | null; // percentage, null when the weekday was never worked
};

// "2026-07-06" → 1 (Monday). Parsed component-wise on purpose: new Date(iso)
// reads a bare date as UTC midnight, so anywhere west of Greenwich every date
// reports the PREVIOUS weekday. Every Monday in LA would be filed as Sunday.
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * Efficiency bucketed by day of the week.
 *
 * Driven by the denominator map rather than the entry list: a day only counts if
 * the app knows how long it was — clocked in, or scheduled and past. A day with
 * ROs and no denominator is invisible here (as it is everywhere else), and a day
 * with a denominator and no ROs counts as the zero it was.
 */
export function weekdayEfficiency(
  entries: Entry[],
  denomByDay: Record<string, DayDenom>,
): WeekdayEfficiency[] {
  const out: WeekdayEfficiency[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    flagHours: 0,
    denomHours: 0,
    days: 0,
    efficiency: null,
  }));

  const flagByDate = new Map<string, number>();
  for (const entry of entries) {
    flagByDate.set(entry.date, (flagByDate.get(entry.date) ?? 0) + entry.flagHours);
  }

  for (const [date, denom] of Object.entries(denomByDay)) {
    const row = out[weekdayOf(date)];
    row.denomHours += denom.hours;
    row.days += 1;
    row.flagHours += flagByDate.get(date) ?? 0;
  }

  for (const row of out) {
    row.efficiency = computeEfficiency(row.flagHours, row.denomHours);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trend — efficiency per pay period
// ---------------------------------------------------------------------------

export type PeriodTrendPoint = {
  key: string;
  label: string;
  start: string;
  // Carried so a caller can tell a FINISHED period from one still running. A
  // period two days in has two days of hours; comparing it against a complete
  // one reports a collapse that hasn't happened.
  end: string;
  flagHours: number;
  denomHours: number;
  efficiency: number | null;
};

/**
 * Efficiency per pay period, oldest → newest, capped to the most recent `limit`.
 *
 * Periods are resolved through lib/periods, so a tech whose shop's boundaries
 * drift (and who has period overrides recorded) gets their real periods here,
 * not idealised halves of a month.
 */
export function periodTrend(
  entries: Entry[],
  denomByDay: Record<string, DayDenom>,
  opts: {
    splitDay: number;
    periodOverrides?: Record<string, PeriodOverride>;
    limit?: number;
  },
): PeriodTrendPoint[] {
  const { splitDay, periodOverrides = {}, limit = 6 } = opts;
  const byKey = new Map<string, PeriodTrendPoint>();

  const touch = (date: string): PeriodTrendPoint => {
    const range = getPeriodForDate(date, splitDay, periodOverrides);
    let point = byKey.get(range.key);
    if (!point) {
      point = {
        key: range.key,
        label: formatPeriodLabel(range),
        start: range.start,
        end: range.end,
        flagHours: 0,
        denomHours: 0,
        efficiency: null,
      };
      byKey.set(range.key, point);
    }
    return point;
  };

  // Both loops, not just entries: a period where the tech clocked in and flagged
  // nothing is the most important point on this chart, and it has no entries to
  // find it by.
  for (const entry of entries) touch(entry.date).flagHours += entry.flagHours;
  for (const [date, denom] of Object.entries(denomByDay)) {
    touch(date).denomHours += denom.hours;
  }

  const points = [...byKey.values()].sort((a, b) => a.start.localeCompare(b.start));
  for (const point of points) {
    point.efficiency = computeEfficiency(point.flagHours, point.denomHours);
  }
  return points.slice(-limit);
}

// ---------------------------------------------------------------------------
// Span of the data, for the denominator map the caller has to build
// ---------------------------------------------------------------------------

/**
 * Earliest and latest date across entries and clocks, or null when there is
 * nothing at all. The page needs a range to ask dailyDenominators for, and
 * hardcoding "last N days" would silently truncate the trend for anyone who
 * logs in after a break.
 */
export function dataRange(
  entries: Entry[],
  clocks: DailyClock[],
): { start: string; end: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  const see = (date: string) => {
    if (start === null || date < start) start = date;
    if (end === null || date > end) end = date;
  };
  for (const entry of entries) see(entry.date);
  for (const clock of clocks) see(clock.date);
  return start !== null && end !== null ? { start, end } : null;
}
