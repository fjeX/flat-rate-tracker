// Pure snapshot-stats builder (gamification Phase 1 — docs/gamification.md).
//
// A snapshot at threshold N freezes stats over the tech's chronologically
// FIRST N repair orders — so a backfilled snapshot (existing user on ship
// day) is a true historical record "as of RO #N", identical to what live
// generation at the crossing would have produced.
//
// Sparse data degrades gracefully: avgVsBook is null without enough lines
// carrying actual hours; topOps may be shorter than 3; photoCount can be 0.

import type { Entry, OpCode, SnapshotStats, SnapshotTopOp } from "./types";

/** Minimum lines with actual hours before avg-vs-book is trustworthy. */
const MIN_BOOK_LINES = 5;

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
): SnapshotStats {
  const byId = new Map(library.map((oc) => [oc.id, oc]));

  let totalFlagHours = 0;
  let bookFlagSum = 0;
  let bookActualSum = 0;
  let bookLines = 0;
  const opCounts = new Map<string, SnapshotTopOp>();
  const dates = new Set<string>();

  for (const e of firstN) {
    totalFlagHours += e.flagHours;
    dates.add(e.date);
    for (const line of e.opCodes) {
      if (line.actualHours !== null && line.flagHours > 0) {
        bookFlagSum += line.flagHours;
        bookActualSum += line.actualHours;
        bookLines += 1;
      }
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

  return {
    roCount: firstN.length,
    totalFlagHours: Math.round(totalFlagHours * 100) / 100,
    avgVsBook:
      bookLines >= MIN_BOOK_LINES && bookFlagSum > 0
        ? Math.round((bookActualSum / bookFlagSum) * 100) / 100
        : null,
    photoCount,
    topOps,
    firstDate: sortedDates[0] ?? "",
    lastDate: sortedDates[sortedDates.length - 1] ?? "",
    workDays: dates.size,
  };
}
