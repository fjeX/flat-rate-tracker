// Upsold work — the hours a tech SOLD rather than the hours they were handed.
//
// WHAT COUNTS
// A line marked `isUpsell`, valued at its FLAG hours. Flag, not actual: an
// upsell is a sale, and what you sold is book time. Actual hours answer "how
// long did it take me", which is the efficiency question and lives elsewhere.
//
// WHY THE DENOMINATOR IS PLAIN FLAG HOURS
// The share is upsold flag hours over ALL flag hours in the same window —
// deliberately NOT the paired flag hours that `periodTrend` uses. That figure
// excludes days the app can't put a length to (no clock entry, no schedule),
// because it is the numerator of an efficiency percentage and has to match its
// denominator. Upsold work on an unclocked Saturday is still upsold. Using the
// paired number here would produce shares above 100% the moment an upsell
// landed on one of those days.
//
// Everything here is a pure function of entries so both surfaces that report
// upsells (the Pay Period stat row, the /insights section) compute from the same
// primitive rather than each summing lines their own way.
import { getPeriodForDate, formatPeriodLabel } from "./periods";
import type { Entry, OpCode, PeriodOverride } from "./types";

/**
 * Flag hours this RO sold. The one place a line's upsell value is decided —
 * `aggregateStats` calls it too, so the period stat and these aggregates cannot
 * disagree about what an upsell is worth.
 */
export function upsellFlagHours(entry: Entry): number {
  return entry.opCodes.reduce(
    (sum, line) => sum + (line.isUpsell ? line.flagHours : 0),
    0,
  );
}

export type UpsellSummary = {
  /** Flag hours on lines marked as upsells. */
  upsellHours: number;
  /** Total flag hours in the same set of ROs — the denominator. */
  flagHours: number;
  /**
   * upsellHours ÷ flagHours, 0–1.
   *
   * null when there are no flag hours at all, which is NOT the same as 0%. "You
   * sold none of the work you did" and "you did no work" are different answers,
   * and rendering the second as the first invents a bad month out of an empty
   * one.
   */
  share: number | null;
  /** Upsold lines, and the ROs holding at least one. */
  lineCount: number;
  roCount: number;
};

export function upsellSummary(entries: Entry[]): UpsellSummary {
  let upsellHours = 0;
  let flagHours = 0;
  let lineCount = 0;
  let roCount = 0;

  for (const entry of entries) {
    flagHours += entry.flagHours;
    let hasUpsell = false;
    for (const line of entry.opCodes) {
      if (!line.isUpsell) continue;
      upsellHours += line.flagHours;
      lineCount += 1;
      hasUpsell = true;
    }
    if (hasUpsell) roCount += 1;
  }

  return {
    upsellHours,
    flagHours,
    share: flagHours > 0 ? upsellHours / flagHours : null,
    lineCount,
    roCount,
  };
}

export type UpsellPeriodPoint = UpsellSummary & {
  key: string;
  label: string;
  start: string;
  end: string;
};

export type UpsellByPeriodOptions = {
  splitDay: number;
  periodOverrides?: Record<string, PeriodOverride>;
  /** Most recent N periods, oldest → newest. */
  limit?: number;
};

/**
 * Upsold hours per pay period, oldest → newest.
 *
 * Periods resolve through lib/periods so a tech with drifted boundaries gets
 * their real periods, the same as every other per-period figure in the app.
 *
 * Only periods that HAVE ROs appear. A period with no work has no share to
 * report — `share` would be null for every one of them, and a run of empty bars
 * reads as a collapse in selling rather than as time off.
 */
export function upsellByPeriod(
  entries: Entry[],
  opts: UpsellByPeriodOptions,
): UpsellPeriodPoint[] {
  const { splitDay, periodOverrides = {}, limit = 6 } = opts;
  const byKey = new Map<string, { point: UpsellPeriodPoint; entries: Entry[] }>();

  for (const entry of entries) {
    const range = getPeriodForDate(entry.date, splitDay, periodOverrides);
    let bucket = byKey.get(range.key);
    if (!bucket) {
      bucket = {
        point: {
          key: range.key,
          label: formatPeriodLabel(range),
          start: range.start,
          end: range.end,
          upsellHours: 0,
          flagHours: 0,
          share: null,
          lineCount: 0,
          roCount: 0,
        },
        entries: [],
      };
      byKey.set(range.key, bucket);
    }
    bucket.entries.push(entry);
  }

  return [...byKey.values()]
    .map(({ point, entries: periodEntries }) => ({
      ...point,
      ...upsellSummary(periodEntries),
    }))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(-limit);
}

export type UpsoldCode = {
  /** Library id, or null for a custom (typed-in) line. */
  opCodeId: string | null;
  code: string;
  description: string;
  hours: number;
  count: number;
};

/**
 * Which op codes get upsold most, by flag hours sold.
 *
 * Custom lines are grouped by their typed-in code rather than dropped: a tech
 * whose best upsell isn't in their library yet is exactly the person this list
 * is for. Lines with neither a library match nor a custom code are skipped —
 * there is nothing to name them by.
 */
export function topUpsoldCodes(
  entries: Entry[],
  library: OpCode[],
  limit = 5,
): UpsoldCode[] {
  const byId = new Map(library.map((oc) => [oc.id, oc]));
  const acc = new Map<string, UpsoldCode>();

  for (const entry of entries) {
    for (const line of entry.opCodes) {
      if (!line.isUpsell) continue;

      const ref = line.opCodeId ? byId.get(line.opCodeId) : undefined;
      const code = line.custom
        ? (line.customCode ?? "").trim()
        : (ref?.code ?? "");
      if (!code) continue;

      // Keyed by library id when there is one, so renaming a code in the
      // library doesn't split its history into two rows.
      const key = ref ? `id:${ref.id}` : `custom:${code.toLowerCase()}`;
      const existing = acc.get(key);
      if (existing) {
        existing.hours += line.flagHours;
        existing.count += 1;
        continue;
      }
      acc.set(key, {
        opCodeId: ref?.id ?? null,
        code,
        description: line.custom
          ? (line.customDescription ?? "").trim()
          : (ref?.description ?? ""),
        hours: line.flagHours,
        count: 1,
      });
    }
  }

  return [...acc.values()]
    .sort((a, b) => b.hours - a.hours || b.count - a.count)
    .slice(0, limit);
}
