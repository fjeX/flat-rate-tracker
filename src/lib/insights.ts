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
  //   - actualHours below MIN_MEASURED_HOURS — a timer tapped and saved, not a
  //     job. Letting it through renders "0.00×", which reads as a job that
  //     costs nothing and outranks every genuine measurement on the page
  //   - flagHours 0 — a comeback (the DB forces those to zero flag) or a
  //     goodwill job, which would divide by zero
  timedUses: number;
  flagTotal: number;
  actualTotal: number;
  // actual ÷ flag. LOWER IS BETTER: 1.0 means the book time was right, 1.4 means
  // the job eats 40% more clock than it pays. null when never timed.
  ratio: number | null;
  // Rework this code cost, in hours: the actual time on its comeback lines.
  //
  // These lines are excluded from `ratio` above and always will be — their flag
  // is zero by DB CHECK, so there is no book time to divide by. But excluding
  // them from the ROW as well is what made this table lie. An op code whose
  // recent lines are ALL comebacks accumulated no flagTotal, no actualTotal and
  // a null ratio, so it rendered as "never timed" with dashes for hours — the
  // page reporting NO DATA for the four consecutive days it was quietly eating
  // 3.3 unpaid hours. The failure got worse as the problem got worse: the more
  // completely a code degenerates into rework, the more totally it disappeared.
  //
  // Summed the same way buildUnpaidSummary sums it (isComeback, actualHours ?? 0,
  // no per-line floor) so the two cannot report different hours for the same
  // lines. The MIN_MEASURED_HOURS floor is applied to this TOTAL at the point of
  // display instead — see opCodeState.
  unpaidHours: number;
  unpaidUses: number;
};

/**
 * What a row actually has to say, which is not the same question as "is ratio
 * null". Two very different rows share a null ratio: one measured nothing, the
 * other measured real rework that pays nothing. Only the first is "never timed".
 */
export type OpCodeState =
  | "measured" // a real ratio against real book time
  | "unpaid" // no book time, but real hours went into rework
  | "untimed"; // nothing recorded

export function opCodeState(row: OpCodePerformance): OpCodeState {
  if (row.ratio !== null) return "measured";
  return row.unpaidHours >= MIN_MEASURED_HOURS ? "unpaid" : "untimed";
}

/**
 * The flag and actual hours a row PUTS ON THE PAGE, or null for an em-dash.
 *
 * Exported because the table both renders and sorts by these: reading the raw
 * totals in the sort comparator while rendering something else is how a column
 * ends up ordered by numbers the user cannot see. An unpaid row shows 0.0h flag
 * (a comeback flags zero by construction) against the hours it really took.
 */
export function displayedHours(
  row: OpCodePerformance,
): { flag: number; actual: number } | null {
  switch (opCodeState(row)) {
    case "measured":
      return { flag: row.flagTotal, actual: row.actualTotal };
    case "unpaid":
      return { flag: 0, actual: row.unpaidHours };
    case "untimed":
      return null;
  }
}

/**
 * Where a row sits when the table is ordered by "actual vs flag", worst first.
 *
 * Unpaid rework ranks WORST — above every finite ratio. That is not a UI
 * preference, it is the arithmetic: real hours against zero flag is an infinite
 * ratio, and no measured job can be worse than one that paid nothing at all.
 * Untimed rows return null and stay pinned last in both directions, as before.
 */
export function ratioOrder(row: OpCodePerformance): number | null {
  switch (opCodeState(row)) {
    case "measured":
      return row.ratio;
    case "unpaid":
      return Number.POSITIVE_INFINITY;
    case "untimed":
      return null;
  }
}

/**
 * The shortest actual-hours value that can be a real measurement, in hours.
 *
 * SIX MINUTES. Nothing on a flat-rate ticket — not a battery, not an oil
 * change — is opened, worked and closed in less than that, so anything under it
 * is a timer that was started and saved by accident.
 *
 * This exists because guarding `actualHours > 0` was not enough. actual_hours is
 * numeric(5,2), so a mis-saved timer lands on 0.01 rather than exactly 0 and
 * walks straight through a `> 0` check — then 0.01h against a 14h head gasket
 * divides to 0.0007 and prints as "0.00×". The production data splits cleanly
 * either side of this number: 34 lines sit at 0.01–0.09 (0.09h against an 18h
 * job), the next value up is 0.30, and there is nothing in between.
 */
export const MIN_MEASURED_HOURS = 0.1;

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
 * Per-op-code performance across every entry passed in, worst first.
 *
 * Order is unpaid rework → worst ratio → best ratio → never timed. Rework leads
 * because it is the most expensive thing this table can find (see ratioOrder),
 * and because the window chips are exactly where it used to hide: narrow the
 * range to the current period and a code's older paid lines drop out, leaving
 * only comebacks and a row that claimed to have no data.
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
          unpaidHours: 0,
          unpaidUses: 0,
        };
        byKey.set(id.key, row);
      }
      row.uses += 1;
      if (line.isComeback) {
        // Counted whether or not it was timed: the rework happened either way,
        // and unpaidUses is how many times, not how many were on a timer.
        row.unpaidUses += 1;
        row.unpaidHours += line.actualHours ?? 0;
        // No `continue` needed — a comeback flags zero by DB CHECK, so it can
        // never clear the flagHours > 0 test below.
      }
      if (
        line.actualHours !== null &&
        line.actualHours >= MIN_MEASURED_HOURS &&
        line.flagHours > 0
      ) {
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
    const ao = ratioOrder(a);
    const bo = ratioOrder(b);
    if (ao === null && bo === null) return b.uses - a.uses;
    if (ao === null) return 1;
    if (bo === null) return -1;
    // Equality first, and not only for tidiness: both-unpaid means both are
    // Infinity, and Infinity - Infinity is NaN, which a comparator silently
    // reads as "equal" and leaves the block in arbitrary order.
    if (ao === bo) return b.unpaidHours - a.unpaidHours || b.uses - a.uses;
    return bo - ao || b.uses - a.uses;
  });
}

/**
 * An actual÷flag ratio as it appears on the page, WITHOUT the "×".
 *
 * The backstop for the invariant that a displayed ratio is never "0.00". A row
 * only reaches this function because it cleared MIN_MEASURED_HOURS, but the
 * floor is per line and the ratio is an aggregate, so a single 0.10h line
 * against a 74h flag total still rounds to zero at two decimals. Zero is not a
 * possible answer to "how long did this take" — say the measurement is smaller
 * than the page can show, rather than that the job was free.
 */
export function formatRatio(ratio: number): string {
  return ratio > 0 && ratio < 0.01 ? "<0.01" : ratio.toFixed(2);
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
