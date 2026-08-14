// True Time, Phase 3a: turning one tech's RO lines into anonymized, poolable
// observations of what a job ACTUALLY takes versus what it books.
//
// Pure functions only — no I/O, no React — so the normalization rules that decide
// what pools with what are unit-testable in isolation. That matters more here
// than usual: these keys are written into stored rows, so a sloppy rule silently
// fragments the dataset (or worse, merges two different jobs) and the damage is
// only visible months later when the read surface ships.
//
// THE HARD PART is that each tech's op-code library is private and arbitrary.
// One shop's front brake job is "BRK-F", another's is "brk f", another's is
// "BF". Nothing forces agreement. So normalization is deliberately aggressive
// (case-folded, punctuation-stripped) to pool obvious variants, and we accept
// that cross-shop code alignment is imperfect in v1. The alternative — trying to
// match on free-text descriptions — is a fuzzy-matching problem that would put
// wrong jobs in the same bucket, which is worse than a fragmented one.
import type { Entry, EntryOpCode, OpCode } from "./types";
import { isMeasuredLine } from "./insights";
import { lineCode } from "./line-label";

/** A single measurement, ready to store. Shaped to labor_time_observations. */
export type NewLaborTimeObservation = {
  entryId: string | null;
  lineId: string | null;
  codeNorm: string;
  makeNorm: string;
  modelNorm: string;
  vehicleYear: number | null;
  flagHours: number;
  actualHours: number;
  observedMonth: string; // "YYYY-MM-01"
};

/**
 * Fold a code to its pooling key: uppercase, strip everything that isn't a
 * letter or digit.
 *
 * So "BRK-F", "brk f", and "brk.f" all become "BRKF" and pool together. The
 * sub-op-code separator lineCode() emits ("LOF · SYN") collapses the same way,
 * which is intended — a sub-variant is a distinct job and stays distinct
 * ("LOFSYN" is not "LOF"), it just loses the decoration.
 */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Same folding for make/model. Kept separate from normalizeCode so the two can
 * diverge later (e.g. a make-alias table) without touching code keys.
 */
export function normalizeVehiclePart(part: string): string {
  return part.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Plausible vehicle model years. Anything outside this is a typo or junk data
// (techs fat-finger "20211" and "0"), and a bad year would create a phantom
// bucket that never pools with anything.
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** Parse a vehicle year, or null when absent/implausible. */
export function parseVehicleYear(year: string): number | null {
  const t = year.trim();
  if (t === "") return null;
  if (!/^\d{4}$/.test(t)) return null;
  const n = Number(t);
  if (n < MIN_YEAR || n > MAX_YEAR) return null;
  return n;
}

/**
 * Coarsen a work date to the first of its month.
 *
 * Exact work dates are re-identifying once combined with a shop and a vehicle,
 * and month granularity is all the aggregation needs (and all a future
 * age-out-stale-observations rule needs). Returns null for a malformed date so a
 * bad row is dropped rather than stored with a bogus month.
 */
export function observedMonthFor(date: string): string | null {
  const m = date.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/**
 * Is this line worth pooling?
 *
 * The bar here is HIGHER than the bar for showing a number on the tech's own
 * page, and deliberately so. This pool is shared: a bad row does not mislead the
 * person who created it, it misleads every other tech who ever looks up that
 * code, and it cannot be un-mixed once it is in a median.
 *
 * Four guards:
 *  - actualHours null/0 means nobody timed it. There is no measurement.
 *  - flagHours 0 makes the flag-vs-actual ratio meaningless (and unbounded),
 *    which is the whole point of the dataset. Comebacks flag exactly zero, so
 *    without this guard every unpaid rework line would poison the ratio.
 *  - the reading has to be PHYSICALLY POSSIBLE. `> 0` let 0.12h against a 25h
 *    engine through, and a median is not robust against a value three orders of
 *    magnitude out. isMeasuredLine is imported rather than re-derived so this
 *    file and the insights page can never disagree about what a measurement is.
 *  - an ESTIMATE is not a measurement. A tech tapping "about 3 hours" from
 *    memory is a perfectly good input to their own coaching and a corrupting
 *    input to somebody else's peer median. null source is grandfathered as
 *    measured: those rows predate the column and were timer- or hand-entered.
 */
export function isPoolableLine(line: EntryOpCode): boolean {
  if (line.actualSource === "estimate") return false;
  return isMeasuredLine({
    flagHours: line.flagHours,
    actualHours: line.actualHours ?? null,
  });
}

// A code that carries no information — lineCode()'s fallbacks for a line whose
// library op code was deleted, or an unnamed custom line. Pooling these would
// create a giant meaningless bucket.
const UNINFORMATIVE_CODES = new Set(["", "CUSTOM"]);

/**
 * Build every poolable observation from one RO.
 *
 * Returns [] freely — most ROs contribute nothing, because most lines are never
 * timed. That is the normal case, not a failure.
 */
export function observationsFromEntry(
  entry: Entry,
  library: OpCode[],
): NewLaborTimeObservation[] {
  const observedMonth = observedMonthFor(entry.date);
  if (observedMonth === null) return [];

  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const makeNorm = normalizeVehiclePart(entry.vehicle.make ?? "");
  const modelNorm = normalizeVehiclePart(entry.vehicle.model ?? "");
  const vehicleYear = parseVehicleYear(entry.vehicle.year ?? "");

  const out: NewLaborTimeObservation[] = [];
  for (const line of entry.opCodes) {
    if (!isPoolableLine(line)) continue;
    const codeNorm = normalizeCode(lineCode(line, libraryById));
    // lineCode() returns an em-dash for a dangling library reference, which
    // normalizes to "" — caught here along with unnamed custom lines.
    if (UNINFORMATIVE_CODES.has(codeNorm)) continue;
    out.push({
      entryId: entry.id,
      lineId: line.id ?? null,
      codeNorm,
      makeNorm,
      modelNorm,
      vehicleYear,
      flagHours: line.flagHours,
      actualHours: line.actualHours as number,
      observedMonth,
    });
  }
  return out;
}

/**
 * Flag-vs-actual ratio for one observation. Below 1 means the job took LONGER
 * than book (you lost time); above 1 means you beat book.
 *
 * Named from the tech's perspective on purpose: "runs 1.4x book" in shop talk
 * means it takes 1.4x as long, which is actual/flag — the inverse of this. The
 * stored aggregate uses flag/actual so that "higher is better for the tech",
 * consistent with how efficiency reads everywhere else in the app.
 */
export function flagToActualRatio(obs: {
  flagHours: number;
  actualHours: number;
}): number | null {
  if (!Number.isFinite(obs.actualHours) || obs.actualHours <= 0) return null;
  return obs.flagHours / obs.actualHours;
}
