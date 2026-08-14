// Inferring how long the maintenance grind takes — WITHOUT a single timer press.
//
// THE IDEA. A tech's day is an equation they already fill in every shift:
//
//     clock hours = daily overhead + Σ (how long each job takes × how many)
//
// Everything on the right except the durations is already recorded — the day's
// length comes from daily_clock_hours or the schedule, and the job counts come
// from the ROs. Over enough days with enough VARIATION in the mix, the durations
// are the only unknowns left, and least squares solves for them.
//
// This is the answer to "how do we measure the 68% of lines nobody will ever put
// a stopwatch on". You do not measure them. You solve for them, from data the
// tech is already producing, and you spend the timer budget on the 2h+ jobs where
// an individual reading is actually worth having (see lib/retro-capture.ts).
//
// WHAT IT CANNOT DO, stated up front because a regression that oversells itself
// is worse than no regression:
//
//  - It yields an AVERAGE per code, never a per-job reading. "LOF takes about
//    22 minutes" is the whole output; "that LOF took 31 minutes" is not knowable
//    this way, ever.
//  - Codes that always ride together cannot be separated. In production, 10KB
//    and LOF co-occur on 30 of one tech's 37 days. Least squares will still
//    print two confident-looking numbers for them, and those two numbers are
//    substantially arbitrary — only their SUM is pinned down. This module
//    detects that and marks the pair rather than letting the page lie.
//  - The intercept absorbs everything not on a ticket: cleanup, dispatch limbo,
//    waiting. That is a feature (it is the only estimate of shop overhead the
//    app can produce) but it also means it soaks up any systematic error.
//
// Pure functions. No I/O, no React.
import type { DayDenom } from "./stats";
import type { Entry, OpCode } from "./types";

/**
 * Days needed before solving is attempted at all.
 *
 * Twenty, and additionally at least 3 days per code being solved for (see
 * MIN_DAYS_PER_CODE). Least squares will happily return an exact fit when the
 * day count approaches the code count — every residual zero, every coefficient
 * meaningless. The guard is what keeps a perfect-looking fit off the page.
 */
export const MIN_DAYS_TO_SOLVE = 20;

/** A code must appear on this many separate days to be solved for. */
export const MIN_DAYS_PER_CODE = 5;

/**
 * Days required per coefficient, so the system stays over-determined.
 *
 * THREE. This is the budget that decides how many codes get their own number:
 * days ÷ 3, minus one for the intercept. Anything beyond that is folded into
 * overhead and reported. Without a budget, a tech with 39 clocked days and 18
 * frequent codes gets 19 knobs for 39 observations — a fit that looks superb and
 * means nothing.
 */
export const MIN_DAYS_PER_PARAM = 3;

/**
 * Ridge penalty. Small — enough to keep a near-singular system invertible and to
 * pull hopelessly collinear coefficients toward each other rather than letting
 * them fly to ±huge, without meaningfully biasing a well-conditioned solve.
 */
export const RIDGE_LAMBDA = 0.05;

/**
 * Above this correlation between two codes' daily counts, neither coefficient is
 * trustworthy on its own. 0.9 is strict on purpose: this module's failure mode is
 * confident nonsense, so it would rather withhold two numbers than print two
 * arbitrary ones.
 */
export const COLLINEAR_THRESHOLD = 0.9;

/**
 * The day length has to actually VARY for any of this to work.
 *
 * This is the assumption the whole method rests on, and in this trade it is
 * frequently false. The model says "a longer day is a day with more work on it";
 * a flat-rate tech clocks the same eight hours whether they turned four jobs or
 * fourteen, and absorbs the difference by working faster, not by staying later.
 * Run against one real tech's 39 clocked days (mean 8.15h, nearly all between
 * 7.6 and 9.0) the solve put 7.41 of 8.15 hours into the intercept, priced an
 * oil change at nine minutes, and explained 19% of the variance — a confident,
 * fully-populated table of nonsense.
 *
 * So: below this coefficient of variation in day length, refuse. The honest
 * message ("your days are all the same length, there is nothing here to solve
 * against") is worth more than a table that has to be disbelieved.
 */
export const MIN_DAY_LENGTH_CV = 0.12;

/**
 * Minimum share of variance the model must explain before its numbers are shown.
 *
 * A regression that explains a fifth of the variation is not a description of
 * the tech's days, and printing per-code minutes off the back of it invites a
 * decision no one should make on that evidence.
 */
export const MIN_R_SQUARED = 0.5;

export type CodeDuration = {
  key: string;
  code: string;
  description: string;
  /** Days this code appeared on. */
  days: number;
  /** Total times it was logged. */
  uses: number;
  /** Solved average hours per instance. Never negative — see clampAndFlag. */
  hours: number;
  /**
   * False when this code's daily count moves almost in lockstep with another's,
   * so the split between them is arbitrary. The UI must not print an unreliable
   * figure as though it were solved.
   */
  reliable: boolean;
  /** The code it is tangled with, when that is why it is unreliable. */
  tangledWith: string | null;
  /**
   * WHY a row is unreliable, which "tangledWith === null" could not express:
   * a coefficient clamped up from negative is untrustworthy too, and it has no
   * partner to name. Rendering that case produced "tangled with null".
   */
  unreliableReason: "tangled" | "no-signal" | null;
};

export type InferenceResult = {
  /** Days that fed the solve. */
  days: number;
  /**
   * Codes that appeared often enough to matter but were left out because the
   * day count could not support that many coefficients. Their time is absorbed
   * into dailyOverheadHours.
   *
   * REPORTED, never silently dropped. A model that quietly truncates its inputs
   * reads as though it covered everything, and the overhead figure would look
   * mysteriously large with no explanation on the page.
   */
  foldedIntoOverhead: string[];
  /**
   * Hours a day costs before any job is touched — cleanup, dispatch limbo,
   * waiting. Null when the solve put it at or below zero, which means the model
   * found no overhead rather than negative overhead.
   */
  dailyOverheadHours: number | null;
  durations: CodeDuration[];
  /**
   * Share of the variation in day length the model explains, 0-1. Reported
   * because a tech deserves to know whether this is a description of their days
   * or a curve through noise.
   */
  rSquared: number;
};

/** Why a solve could not be run. Rendered to the tech verbatim, not swallowed. */
export type InferenceRefusal =
  | { reason: "not-enough-days"; days: number; needed: number }
  | { reason: "not-enough-codes" }
  | { reason: "too-few-days-per-code"; days: number; needed: number }
  /** Clocked days are all about the same length — see MIN_DAY_LENGTH_CV. */
  | { reason: "days-too-uniform"; variation: number; needed: number }
  /** It solved, and the answer does not describe the tech's days. */
  | { reason: "poor-fit"; rSquared: number; needed: number }
  | { reason: "unsolvable" };

export type Inference =
  | ({ ok: true } & InferenceResult)
  | ({ ok: false } & InferenceRefusal);

type CodeColumn = {
  key: string;
  code: string;
  description: string;
  counts: number[];
  days: number;
  uses: number;
};

/**
 * Solve for average job durations from day shapes alone.
 *
 * Only days with a KNOWN length take part. A day with ROs and no denominator
 * would contribute an equation with no left-hand side, and dropping it is the
 * same rule the rest of the app follows.
 */
export function inferCodeDurations(
  entries: Entry[],
  denomByDay: Record<string, DayDenom>,
  library: OpCode[],
): Inference {
  const dates = Object.keys(denomByDay).sort();
  if (dates.length < MIN_DAYS_TO_SOLVE) {
    return {
      ok: false,
      reason: "not-enough-days",
      days: dates.length,
      needed: MIN_DAYS_TO_SOLVE,
    };
  }

  const lengths = dates.map((d) => denomByDay[d].hours);
  const variation = coefficientOfVariation(lengths);
  if (variation < MIN_DAY_LENGTH_CV) {
    return {
      ok: false,
      reason: "days-too-uniform",
      variation,
      needed: MIN_DAY_LENGTH_CV,
    };
  }

  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const columns = new Map<string, CodeColumn>();

  for (const entry of entries) {
    const row = dateIndex.get(entry.date);
    if (row === undefined) continue;
    for (const line of entry.opCodes) {
      // A comeback flags zero and is unpaid rework, not a unit of dispatched
      // work. It still consumed clock time, so leaving it out lets the
      // intercept absorb it — which is the honest place for it.
      if (line.isComeback) continue;
      const id = identify(line, libraryById);
      if (!id) continue;
      let col = columns.get(id.key);
      if (!col) {
        col = { ...id, counts: new Array(dates.length).fill(0), days: 0, uses: 0 };
        columns.set(id.key, col);
      }
      if (col.counts[row] === 0) col.days += 1;
      col.counts[row] += 1;
      col.uses += 1;
    }
  }

  const eligible = [...columns.values()]
    .filter((c) => c.days >= MIN_DAYS_PER_CODE)
    // Best-supported first, so when the budget below bites it drops the codes
    // the data had least to say about.
    .sort((a, b) => b.days - a.days || b.uses - a.uses);
  if (eligible.length === 0) return { ok: false, reason: "not-enough-codes" };

  // How many coefficients this many days can actually carry, minus one for the
  // intercept. Adaptive rather than fixed: a tech with 120 days should get a
  // richer model than one with 25, and neither should get a model that fits
  // every day exactly because it has as many knobs as observations.
  const budget = Math.floor(dates.length / MIN_DAYS_PER_PARAM) - 1;
  if (budget < 1) {
    return {
      ok: false,
      reason: "too-few-days-per-code",
      days: dates.length,
      needed: MIN_DAYS_PER_PARAM * 2,
    };
  }
  const kept = eligible.slice(0, budget);
  const foldedIntoOverhead = eligible.slice(budget).map((c) => c.code);

  // Design matrix: an intercept column of 1s, then one column per code.
  const y = dates.map((d) => denomByDay[d].hours);
  const X = dates.map((_, row) => [1, ...kept.map((c) => c.counts[row])]);

  const beta = ridgeSolve(X, y, RIDGE_LAMBDA);
  if (!beta) return { ok: false, reason: "unsolvable" };

  const tangles = findTangles(kept);
  const intercept = beta[0];
  const fit = rSquared(X, y, beta);
  if (fit < MIN_R_SQUARED) {
    return { ok: false, reason: "poor-fit", rSquared: fit, needed: MIN_R_SQUARED };
  }

  return {
    ok: true,
    days: dates.length,
    foldedIntoOverhead,
    dailyOverheadHours: intercept > 0 ? intercept : null,
    rSquared: fit,
    durations: kept
      .map((c, i) => {
        const tangledWith = tangles.get(c.key) ?? null;
        // A job cannot take negative time. A negative coefficient is the model
        // saying it could not separate this code, not a discovery — clamped to
        // zero AND marked, never printed as "this job takes no time".
        const noSignal = beta[i + 1] <= 0;
        const unreliableReason = tangledWith
          ? ("tangled" as const)
          : noSignal
            ? ("no-signal" as const)
            : null;
        return {
          key: c.key,
          code: c.code,
          description: c.description,
          days: c.days,
          uses: c.uses,
          hours: Math.max(0, beta[i + 1]),
          reliable: unreliableReason === null,
          tangledWith,
          unreliableReason,
        };
      })
      .sort((a, b) => b.uses - a.uses),
  };
}

function identify(
  line: Entry["opCodes"][number],
  libraryById: Map<string, OpCode>,
): { key: string; code: string; description: string } | null {
  if (line.custom) {
    const code = (line.customCode ?? "").trim().toUpperCase();
    if (!code) return null;
    return {
      key: `custom:${code}`,
      code,
      description: (line.customDescription ?? "").trim(),
    };
  }
  if (line.opCodeId) {
    const oc = libraryById.get(line.opCodeId);
    if (!oc) return null;
    return { key: `lib:${oc.id}`, code: oc.code, description: oc.description };
  }
  return null;
}

/**
 * Codes whose daily counts move together closely enough that least squares is
 * guessing at the split between them.
 */
function findTangles(columns: CodeColumn[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      const r = pearson(columns[i].counts, columns[j].counts);
      if (r !== null && Math.abs(r) >= COLLINEAR_THRESHOLD) {
        if (!out.has(columns[i].key)) out.set(columns[i].key, columns[j].code);
        if (!out.has(columns[j].key)) out.set(columns[j].key, columns[i].code);
      }
    }
  }
  return out;
}

/** Standard deviation over the mean. Zero mean yields 0 — nothing varies. */
function coefficientOfVariation(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean <= 0) return 0;
  const variance =
    xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance) / mean;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
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

/**
 * Ridge regression via the normal equations: (XᵀX + λI)β = Xᵀy.
 *
 * The intercept is deliberately NOT penalised (its diagonal entry gets no λ) —
 * shrinking it toward zero would push the overhead it represents into the job
 * durations, inflating every one of them.
 */
function ridgeSolve(X: number[][], y: number[], lambda: number): number[] | null {
  const n = X.length;
  const p = X[0].length;
  const A: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const b: number[] = new Array(p).fill(0);

  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let sum = 0;
      for (let r = 0; r < n; r++) sum += X[r][i] * X[r][j];
      A[i][j] = sum;
    }
    let sum = 0;
    for (let r = 0; r < n; r++) sum += X[r][i] * y[r];
    b[i] = sum;
    if (i > 0) A[i][i] += lambda;
  }
  return gaussianSolve(A, b);
}

/** Gaussian elimination with partial pivoting. Null when singular. */
function gaussianSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];

    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
    x[i] = sum / M[i][i];
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

function rSquared(X: number[][], y: number[], beta: number[]): number {
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let r = 0; r < y.length; r++) {
    const pred = X[r].reduce((sum, v, i) => sum + v * beta[i], 0);
    ssRes += (y[r] - pred) ** 2;
    ssTot += (y[r] - mean) ** 2;
  }
  if (ssTot === 0) return 0;
  // Clamped: ridge can overshoot on a badly conditioned fit, and a negative or
  // >1 "share of variance explained" is a number nobody can read.
  return Math.min(1, Math.max(0, 1 - ssRes / ssTot));
}
