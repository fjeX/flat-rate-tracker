// Retro capture — asking "how long did that one take?" once, after the fact.
//
// WHY THIS EXISTS, and why it does not just nag harder about the timer.
//
// A tech turns 5-10 ROs a day and roughly 68% of the lines on them flag under an
// hour. Running a stopwatch on a 20-minute oil change, eight times a day, is an
// interruption with no payoff — and the production data agrees it has no payoff:
// across two techs and ~90 days each, the number of quick jobs in a day
// correlates with that day's flag hours at 0.067 and -0.027. Perfect measurement
// of the grind would describe something that does not move the paycheck.
//
// Big jobs are the opposite. Lines at or above HEAVY_FLAG_HOURS are ~3.6% of
// lines and 22% of flag hours, they correlate with a day's earnings at 0.57-0.70,
// and they are the jobs a tech actually makes decisions about ("do I want the
// water pump?"). There is about ONE of them a day.
//
// So the ask is made once a day, on the job where the answer is worth having,
// and it is made AFTER the work instead of before — because "remember to start a
// timer" is a bet on memory at the exact moment a tech is least able to spare
// attention, while "how long did that take?" is a question they can still answer
// an hour later.
//
// The answer is coarse ON PURPOSE. Six-minute precision on a 5-hour job is false
// rigour; half an hour either way still tells you whether you beat the book. And
// it is stored as `actualSource: "estimate"` so nothing downstream ever mistakes
// it for a clock reading — see lib/true-time.ts.
//
// Pure functions. No I/O, no React.
import { lineCode, lineDescription } from "./line-label";
import { HEAVY_FLAG_HOURS } from "./mix";
import type { Entry, OpCode } from "./types";

/** A line the app would like a time for, paired with what to call it. */
export type RetroCandidate = {
  lineId: string;
  code: string;
  description: string;
  flagHours: number;
};

/**
 * The lines on a just-saved RO worth asking about.
 *
 * Three exclusions, each load-bearing:
 *  - anything under HEAVY_FLAG_HOURS. Asking about the grind is the behaviour
 *    that made the timer feel pointless; doing it in a modal would be worse.
 *  - anything that already has actualHours. The timer already answered, and
 *    re-asking would invite a memory to overwrite a measurement.
 *  - comebacks. They flag zero by DB CHECK, so they can never clear the heavy
 *    threshold anyway — but the intent matters if that ever changes: unpaid
 *    rework is tracked in hours, not measured against book time.
 */
export function retroCandidates(
  entry: Entry,
  library: OpCode[] = [],
): RetroCandidate[] {
  // Labelled through line-label like every other surface, so the modal calls a
  // line exactly what the RO detail and the dispute pack call it.
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  return entry.opCodes
    .filter(
      (line) =>
        line.flagHours >= HEAVY_FLAG_HOURS &&
        line.actualHours === null &&
        !line.isComeback,
    )
    .map((line) => ({
      lineId: line.id,
      code: lineCode(line, libraryById),
      description: lineDescription(line, libraryById),
      flagHours: line.flagHours,
    }));
}

export type RetroBucket = {
  /** What the chip says. */
  label: string;
  /** The hours actually stored if this chip is tapped. */
  hours: number;
};

/**
 * The step size the ladder climbs in, for a job that books `flagHours`.
 *
 * Resolution tracks job size so the worst-case error stays proportional: half a
 * step either way is ~10% on any job the ladder covers. A fixed 15-minute step
 * would give a 14-hour engine forty chips; a fixed 2-hour step would make a
 * 2.5-hour job unanswerable.
 */
export function retroStep(flagHours: number): number {
  if (flagHours <= 3) return 0.5;
  if (flagHours <= 6) return 1;
  if (flagHours <= 12) return 2;
  return 4;
}

/**
 * The chips offered for one line, shortest first.
 *
 * The ladder is plain clock hours and the book time is NOT marked on it. That is
 * deliberate: a chip labelled "5.0h (book)" would be picked by anyone unsure,
 * and the readings this feature exists to collect are exactly the ones where the
 * tech's real time and the book time differ.
 *
 * The top chip is open-ended ("8h+") and stores its LOWER bound, which
 * under-states an overrun rather than inventing one. When this feature is wrong
 * it should be wrong in the direction that flatters the tech least on their own
 * behalf — an under-stated overrun costs them a nudge, an over-stated one is a
 * number they never earned.
 */
export function retroBuckets(flagHours: number): RetroBucket[] {
  const step = retroStep(flagHours);
  // Cover a genuinely fast run through a bad overrun, capped so the row of chips
  // stays tappable on a phone.
  const top = Math.max(step * 2, roundToStep(flagHours * 1.5, step));
  const buckets: RetroBucket[] = [];

  for (let h = step; h <= top; h += step) {
    buckets.push({ label: `${trim(h)}h`, hours: h });
    if (buckets.length >= 6) break;
  }
  const last = buckets[buckets.length - 1];
  buckets.push({ label: `${trim(last.hours)}h+`, hours: last.hours });
  // The final two would otherwise read "6h" and "6h+" — same number, different
  // meaning, and no way to tell which one you tapped afterwards.
  buckets[buckets.length - 2] = {
    label: `${trim(last.hours)}h`,
    hours: last.hours,
  };
  return dedupeTop(buckets);
}

/** "2" not "2.0"; "2.5" stays "2.5". */
function trim(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

function roundToStep(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

/**
 * The open-ended chip stores the same hours as the closed one below it, which is
 * correct (it is a lower bound) but makes two chips that write the same value.
 * Nudging the open one up by half a step keeps them distinguishable in the data
 * without claiming to know how far over the job ran.
 */
function dedupeTop(buckets: RetroBucket[]): RetroBucket[] {
  if (buckets.length < 2) return buckets;
  const last = buckets.length - 1;
  const step = buckets.length > 1 ? buckets[1].hours - buckets[0].hours : 0.5;
  return buckets.map((b, i) =>
    i === last ? { ...b, hours: round2(b.hours + step / 2) } : b,
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
