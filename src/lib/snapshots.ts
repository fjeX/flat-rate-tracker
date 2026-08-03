// Pure snapshot-stats builder (gamification Phase 1 — docs/gamification.md).
//
// A snapshot at threshold N freezes stats over the tech's chronologically
// FIRST N repair orders — so a backfilled snapshot (existing user on ship
// day) is a true historical record "as of RO #N", identical to what live
// generation at the crossing would have produced.
//
// Sparse data degrades gracefully: avgVsBook is null without enough lines
// carrying actual hours; topOps may be shorter than 3; photoCount can be 0.

import { aggregateStatsWithSchedule, type ScheduleContext } from "./stats";
import type { DailyClock, Entry, OpCode, SnapshotStats, SnapshotTopOp } from "./types";

/** Minimum lines with actual hours before avg-vs-book is trustworthy. */
const MIN_BOOK_LINES = 5;

/** Minimum summed actual hours before avg-vs-book is trustworthy — a handful
 * of seconds-long timer runs (0.02h actuals) can clear MIN_BOOK_LINES and
 * produce a meaningless "0.01×". */
const MIN_BOOK_ACTUAL_HOURS = 1;

/** Trust floor for DISPLAYING a stored ratio. Snapshots are frozen records, so
 * ratios computed before the MIN_BOOK_ACTUAL_HOURS guard existed may persist
 * junk like 0.01× — no human beats book 20:1 in either direction, so anything
 * below this renders as "—" instead. */
export const MIN_PLAUSIBLE_AVG_VS_BOOK = 0.05;

/** Clock rows + schedule context for the overall-efficiency stat. Null when
 * the tech has no schedule — the snapshot field stays absent, same as
 * snapshots frozen before the feature existed. */
export type SnapshotScheduleData = {
  clocks: DailyClock[];
  ctx: ScheduleContext;
} | null;

/** Overall efficiency over a snapshot's first-N entries — shared by live
 * generation and the backfill of snapshots frozen before the field existed.
 * Per-day clocked hours win, scheduled hours fill silent days, unresolved
 * days contribute nothing. Backfill-safe: generation-day "today" is at or
 * after lastDate, so every day in range counts as completed. */
export function snapshotEfficiency(
  firstN: Entry[],
  scheduleData: SnapshotScheduleData,
): Pick<SnapshotStats, "overallEfficiency" | "efficiencySource"> {
  if (!scheduleData || firstN.length === 0) {
    return { overallEfficiency: null, efficiencySource: null };
  }
  const dates = firstN.map((e) => e.date).sort();
  const s = aggregateStatsWithSchedule(
    firstN,
    scheduleData.clocks,
    { start: dates[0], end: dates[dates.length - 1] },
    scheduleData.ctx,
  );
  return {
    overallEfficiency:
      s.efficiency === null ? null : Math.round(s.efficiency * 10) / 10,
    efficiencySource: s.denomSource,
  };
}

/**
 * How long the rows behind a snapshot must sit still before it is frozen.
 *
 * A snapshot is permanent, so it must not be minted from an RO that is about to
 * be taken back. Production case: a disposable test RO was the 100th, froze
 * "Portfolio snapshot #4" at 100 ROs on the next dashboard load, and was deleted
 * seconds later — leaving a permanent record of a milestone that never happened.
 *
 * An hour is the trade. It is far longer than the "logged it, spotted the
 * mistake, deleted it" window that causes this, and short enough that a tech who
 * really does hit RO #100 still sees it before the end of the shift. Deferring
 * costs nothing: the next dashboard load picks the threshold up again.
 */
export const SNAPSHOT_SETTLE_MS = 60 * 60 * 1000;

/**
 * The subset of `missing` whose underlying rows have stopped moving.
 *
 * Keyed on the NEWEST createdAt among the first N, not on the Nth row alone: a
 * backdated RO inserted today can land inside an earlier threshold's window and
 * change what "the first 100" even means. Both cases are the same question —
 * has anything behind this snapshot changed recently — so they get one rule.
 *
 * An unparseable createdAt settles rather than blocks; a bad timestamp should
 * not freeze a tech's milestones out forever.
 */
export function settledThresholds(
  all: Entry[],
  missing: number[],
  nowMs: number,
): number[] {
  return missing.filter((threshold) => {
    if (all.length < threshold) return false;
    let newest = 0;
    for (const e of all.slice(0, threshold)) {
      const t = Date.parse(e.createdAt);
      if (Number.isFinite(t) && t > newest) newest = t;
    }
    if (newest === 0) return true; // nothing parseable to wait on
    return nowMs - newest >= SNAPSHOT_SETTLE_MS;
  });
}

/**
 * Snapshots claiming more ROs than the tech currently has.
 *
 * The rows such a snapshot froze have since been deleted, so it records a
 * milestone that did not happen. STRICTLY greater-than is the safety property
 * worth stating outright: a tech at 149 ROs who deletes one keeps every
 * snapshot up to 100, because those thresholds are still genuinely cleared.
 * Only the contradiction case is caught.
 */
export function unbackedSnapshots<T extends { roThreshold: number }>(
  existing: T[],
  roCount: number,
): T[] {
  return existing.filter((s) => s.roThreshold > roCount);
}

/** Sort entries into log order: date asc, then created_at asc. */
export function chronological(entries: Entry[]): Entry[] {
  return entries
    .slice()
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1
      : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
    );
}

export function buildSnapshotStats(
  firstN: Entry[],
  library: OpCode[],
  photoEntryIds: string[],
  scheduleData: SnapshotScheduleData = null,
): SnapshotStats {
  const byId = new Map(library.map((oc) => [oc.id, oc]));

  let totalFlagHours = 0;
  let bookFlagSum = 0;
  let bookActualSum = 0;
  let bookLines = 0;
  let comebackHours = 0;
  const opCounts = new Map<string, SnapshotTopOp>();
  const dates = new Set<string>();

  for (const e of firstN) {
    totalFlagHours += e.flagHours;
    dates.add(e.date);
    for (const line of e.opCodes) {
      // Comeback lines are EXCLUDED from avg-vs-book, deliberately.
      //
      // avgVsBook answers one question: "when the book says 2.0h, how long does
      // it actually take me?" A comeback has no book time to be measured
      // against — the flag is zero because nobody is paying for the redo, not
      // because the job is instant. Including it would divide real hours by a
      // book time that was never quoted, dragging the ratio toward nonsense and
      // making a tech who eats comebacks look slower at ordinary work.
      //
      // The `flagHours > 0` guard already excluded them incidentally; this is
      // explicit so the exclusion survives someone relaxing that guard. Their
      // hours are reported separately as comebackHours instead of vanishing.
      if (line.isComeback) {
        comebackHours += line.actualHours ?? 0;
      } else if (line.actualHours !== null && line.flagHours > 0) {
        bookFlagSum += line.flagHours;
        bookActualSum += line.actualHours;
        bookLines += 1;
      }
      // NB: falls through to the topOps tally either way — you performed the
      // op whether or not you were paid for it.
      const lib = line.opCodeId ? byId.get(line.opCodeId) : undefined;
      const code = lib?.code ?? line.customCode ?? "";
      if (!code) continue;
      const key = code.toUpperCase();
      const existing = opCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        opCounts.set(key, {
          code,
          description: lib?.description ?? line.customDescription ?? "",
          count: 1,
        });
      }
    }
  }

  const entryIdSet = new Set(firstN.map((e) => e.id));
  const photoCount = photoEntryIds.filter((id) => entryIdSet.has(id)).length;

  const topOps = [...opCounts.values()]
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 3);

  const sortedDates = [...dates].sort();

  const { overallEfficiency, efficiencySource } = snapshotEfficiency(
    firstN,
    scheduleData,
  );

  return {
    overallEfficiency,
    efficiencySource,
    roCount: firstN.length,
    totalFlagHours: Math.round(totalFlagHours * 100) / 100,
    avgVsBook:
      bookLines >= MIN_BOOK_LINES &&
      bookFlagSum > 0 &&
      bookActualSum >= MIN_BOOK_ACTUAL_HOURS
        ? Math.round((bookActualSum / bookFlagSum) * 100) / 100
        : null,
    comebackHours: Math.round(comebackHours * 100) / 100,
    photoCount,
    topOps,
    firstDate: sortedDates[0] ?? "",
    lastDate: sortedDates[sortedDates.length - 1] ?? "",
    workDays: dates.size,
  };
}
