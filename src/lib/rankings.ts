// Deterministic "where does this one sit" sentences.
//
// Same data in, same sentence out: no model, no randomness, no clock. Two
// surfaces use it — an op-code line on the RO detail ("3rd fastest of 9 BRK-F
// jobs you've timed") and a History bar's readout ("4th best week of 31") — and
// both go through the same ranking rule so they cannot disagree about ties.
//
// TIE RULE (standard competition ranking, "1224"): a value's rank is 1 plus the
// number of pool values STRICTLY better than it. Values within RANK_EPSILON of
// each other are tied and share a rank — the epsilon only exists so 1.5/2.0 and
// 0.75/1.0 (same pace, different float noise) land on the same rung. Ties are
// said out loud ("Tied 2nd fastest") rather than broken by date or id, because a
// tie-break would make the sentence depend on row order, and a tech who edits
// one RO should never see an unrelated line's rank change.
//
// These are ink-and-dim sentences: nothing here judges. "Slowest of 9" is a
// position, not a verdict — some jobs are the slow ones.
import { isMeasuredLine, opCodeGroupId } from "./insights";
import type { Entry, EntryOpCode } from "./types";

/** Values closer than this are the same value. */
const RANK_EPSILON = 1e-9;

/** A ranking needs at least this many in the pool; a "rank" of 2 in 2 is noise. */
export const MIN_RANK_POOL = 3;

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 12 -> "12th", 21 -> "21st". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Where `value` sits in `pool` (which must contain it). `better` says which
 * direction is the good one. */
export function competitionRank(
  value: number,
  pool: readonly number[],
  better: "low" | "high",
): { rank: number; tied: boolean; of: number } {
  let ahead = 0;
  let same = 0;
  for (const p of pool) {
    if (Math.abs(p - value) <= RANK_EPSILON) same += 1;
    else if (better === "low" ? p < value : p > value) ahead += 1;
  }
  return { rank: ahead + 1, tied: same > 1, of: pool.length };
}

// ---------------------------------------------------------------------------
// Op-code lines
// ---------------------------------------------------------------------------

/** One measured job, reduced to what a ranking needs. Slim on purpose: History
 * ships one of these per timed line, not the whole RO. */
export type JobTiming = {
  entryId: string;
  /** insights.ts op-code identity: "lib:<id>" | "custom:<CODE>" | "customdesc:…" */
  key: string;
  /** actual ÷ flag. Lower is faster. Ratio, not raw time, so a 2.0h and a 1.5h
   * book time on the same code compare fairly. */
  ratio: number;
};

/** A line's grouping identity — insights.ts's own, never re-derived here. */
export const lineKey = (line: EntryOpCode): string | null => opCodeGroupId(line);

function timingOf(entryId: string, line: EntryOpCode): JobTiming | null {
  // The app's one definition of "a real measurement" — not redefined here.
  if (!isMeasuredLine(line)) return null;
  const key = lineKey(line);
  if (!key) return null;
  return { entryId, key, ratio: (line.actualHours as number) / line.flagHours };
}

/** Every measured line across `entries`, slimmed for ranking. */
export function toJobTimings(entries: readonly Entry[]): JobTiming[] {
  const out: JobTiming[] = [];
  for (const e of entries) {
    for (const line of e.opCodes) {
      const t = timingOf(e.id, line);
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * The sentence for one job against the others on the same code, or null when
 * there is nothing honest to say (fewer than MIN_RANK_POOL timed jobs).
 *
 * `ratios` is every measured job on the code INCLUDING this one. `scope` is a
 * trailing phrase for pools that are not all-time ("in the last 90 days") —
 * claiming "of 9 jobs you've timed" over a 90-day window would be a lie.
 */
export function jobRankSentence(
  ratio: number,
  ratios: readonly number[],
  label: string,
  scope?: string,
): string | null {
  const n = ratios.length;
  if (n < MIN_RANK_POOL) return null;
  const fast = competitionRank(ratio, ratios, "low");
  const slow = competitionRank(ratio, ratios, "high");
  const what = `${label} jobs you've timed${scope ? ` ${scope}` : ""}`;

  if (fast.rank === 1 && slow.rank === 1) return `Same pace on all ${n} ${what}`;
  if (fast.rank === 1) return `${fast.tied ? "Tied for fastest" : "Your fastest"} of ${n} ${what}`;
  if (slow.rank === 1) return `${slow.tied ? "Tied for slowest" : "Slowest"} of ${n} ${what}`;
  return `${fast.tied ? "Tied " : ""}${ordinal(fast.rank)} fastest of ${n} ${what}`;
}

/**
 * Sentences for each line of `entry`, keyed by line id. Lines without one (not
 * measured, comeback, no code, too few jobs) are simply absent.
 *
 * The pool is the OTHER ROs' timings plus this RO's own lines read live, so an
 * actual-hours edit shows up here even before the parent's list has refreshed.
 * Two lines of one code on this RO are two jobs.
 */
export function jobRankSentences(
  entry: Pick<Entry, "id" | "opCodes">,
  timings: readonly JobTiming[],
  labelOf: (line: EntryOpCode) => string | null,
  scope?: string,
): Map<string, string> {
  const result = new Map<string, string>();
  const own: Array<{ line: EntryOpCode; t: JobTiming }> = [];
  for (const line of entry.opCodes) {
    const t = timingOf(entry.id, line);
    if (t) own.push({ line, t });
  }
  if (own.length === 0) return result;

  const byKey = new Map<string, number[]>();
  for (const t of timings) {
    if (t.entryId === entry.id) continue;
    const arr = byKey.get(t.key);
    if (arr) arr.push(t.ratio);
    else byKey.set(t.key, [t.ratio]);
  }
  for (const { t } of own) {
    const arr = byKey.get(t.key);
    if (arr) arr.push(t.ratio);
    else byKey.set(t.key, [t.ratio]);
  }
  for (const { line, t } of own) {
    // No displayable code (a bare "—") means nothing to name the jobs by.
    const label = labelOf(line);
    if (!label) continue;
    const s = jobRankSentence(t.ratio, byKey.get(t.key) ?? [], label, scope);
    if (s) result.set(line.id, s);
  }
  return result;
}

// ---------------------------------------------------------------------------
// History bars
// ---------------------------------------------------------------------------

/**
 * "4th best week of 31". `efficiencies` is every rankable bar's efficiency
 * (the caller decides who is rankable) INCLUDING this one; higher is better.
 * `scope` names a pool that is not obviously everything ("last 90d").
 */
export function barRankSentence(
  efficiency: number,
  efficiencies: readonly number[],
  unit: string,
  scope?: string,
): string | null {
  const n = efficiencies.length;
  if (n < MIN_RANK_POOL) return null;
  const { rank, tied } = competitionRank(efficiency, efficiencies, "high");
  // Says "efficiency" outright: the same card's footer already calls the
  // most-HOURS bar the "best period", so a bare "best" here meant two things.
  const tail = `${n} ${unit}s${scope ? `, ${scope}` : ""}`;
  if (rank === 1) return `${tied ? "Tied for highest" : "Highest"} efficiency of ${tail}`;
  return `${tied ? "Tied " : ""}${ordinal(rank)} highest efficiency of ${tail}`;
}
