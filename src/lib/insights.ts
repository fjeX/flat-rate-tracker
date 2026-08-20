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
import { HEAVY_FLAG_HOURS } from "./mix";
import { computeEfficiency, type DayDenom } from "./stats";
import {
  efficiencyDisplay,
  type EfficiencyDisplay,
} from "./efficiency-display";
import { formatPeriodLabel, getPeriodForDate } from "./periods";
import {
  isComebackKind,
  UNPAID_TIME_KIND_LABELS,
  type DailyClock,
  type Entry,
  type OpCode,
  type PeriodOverride,
  type UnpaidTimeKind,
} from "./types";
// The ledger half of the leak board comes in already flattened by
// buildUnpaidSummary — see the note on leakBoard. Importing the TYPE only keeps
// this module pure; the caller does the building.
import type { UnpaidLine } from "./unpaid-summary";

// ---------------------------------------------------------------------------
// Where your time goes — per-op-code actual vs flag
// ---------------------------------------------------------------------------

export type OpCodePerformance = {
  key: string; // stable grouping id ("lib:<uuid>", "custom:<CODE>")
  code: string;
  description: string;
  uses: number; // every line of this op code, timed or not
  // Lines behind `ratio`: a real measurement against real book time. Three
  // kinds of line are counted in `uses` and excluded here — see isMeasuredLine,
  // which is the one gate all of this module's consumers share:
  //   - never timed (actualHours null) — nothing to measure
  //   - actualHours below minPlausibleActual(flagHours) — a timer tapped and
  //     saved, not a job. Below six minutes outright, or below 15% of the book
  //     time on anything bigger. Letting the first through renders "0.00×",
  //     which reads as a job that costs nothing; letting the SECOND through is
  //     worse, because 0.12h against a 25h engine renders as the biggest win on
  //     the page rather than as anything broken
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
  /**
   * Lines that carry a timer reading which cannot be true — see
   * MIN_PLAUSIBLE_RATIO. Not measurements, not rework, not "never timed": a
   * fourth thing, and the only one the tech can repair by editing the RO.
   */
  implausibleUses: number;
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

/**
 * The smallest fraction of book time a real measurement can be.
 *
 * MIN_MEASURED_HOURS is an ABSOLUTE floor, and that is only half the guard. Six
 * minutes is a plausible read on a 0.3h oil change; it is not a plausible read
 * on a 25h engine. The same mis-saved timer that lands on 0.01 against a small
 * job lands on 0.12 against a big one, clears the absolute floor untouched, and
 * divides to 0.005 — which does not print as "0.00×" and so was never caught by
 * the earlier fix. It prints as a HUGE WIN: 24.9 hours "saved", the number one
 * row in "Where you're winning".
 *
 * That is the worse failure. A ratio of 0.00 looks broken and gets ignored; a
 * ratio of 0.005 on a 25h job looks like the best day of the tech's career.
 *
 * Production data splits cleanly here too. The four implausible lines sit at
 * 0.005, 0.023, 0.030 and 0.085 — every one of them a small actual against a
 * 5h+ flag. The next value up is 0.389 (0.70h against a 1.80h job), and there is
 * nothing in between. 0.15 sits in the empty gap.
 *
 * Deliberately generous, because BEATING THE BOOK IS THE JOB. A water pump that
 * flags 5.0h and takes 1.5h is a 0.30 ratio, and that reading is the entire
 * reason this app exists — it must survive. This threshold rejects only
 * measurements no wrench could produce, not merely impressive ones.
 */
export const MIN_PLAUSIBLE_RATIO = 0.15;

/**
 * The shortest actual-hours value that can be a real measurement OF THIS JOB.
 *
 * Scales with the book time instead of being flat, so the guard is proportional
 * to what it is guarding. The absolute floor still governs small jobs (a 0.3h
 * flag yields 0.045 here, so MIN_MEASURED_HOURS wins) and the relative floor
 * takes over above ~0.67h of flag, which is exactly where the flat floor stopped
 * being able to tell a measurement from a mis-tap.
 */
export function minPlausibleActual(flagHours: number): number {
  return Math.max(MIN_MEASURED_HOURS, flagHours * MIN_PLAUSIBLE_RATIO);
}

/**
 * Is this line a measurement at all?
 *
 * The single gate every consumer must use, exported so the ratio table, the leak
 * board and the true-time collector cannot drift into three different answers to
 * "does this line count" — which is the same class of bug the module header
 * warns about for efficiency.
 */
export function isMeasuredLine(line: {
  flagHours: number;
  actualHours: number | null;
}): boolean {
  return (
    line.actualHours !== null &&
    line.flagHours > 0 &&
    line.actualHours >= minPlausibleActual(line.flagHours)
  );
}

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
          implausibleUses: 0,
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
      if (isMeasuredLine(line)) {
        row.timedUses += 1;
        row.flagTotal += line.flagHours;
        row.actualTotal += line.actualHours as number;
      } else if (
        line.actualHours !== null &&
        line.actualHours > 0 &&
        line.flagHours > 0 &&
        !line.isComeback
      ) {
        // Timed, non-zero, against real book time — and still not a measurement.
        // Counted rather than dropped silently: these are almost always a timer
        // saved by accident, the tech is the only one who can fix them, and a
        // number they never see is a number they never fix. Comebacks are
        // excluded because their zero flag makes them unmeasurable BY DESIGN,
        // not by mistake — flagging those as suspect would cry wolf on the one
        // thing the tech recorded correctly.
        row.implausibleUses += 1;
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
// What's costing you — every leak in one currency: hours
// ---------------------------------------------------------------------------

/**
 * Why a leak leaked. The three are measured differently and must stay
 * distinguishable on the page: an overrun is a job that pays SOME of its time,
 * rework is a job that pays NONE of it, and unpaid clock is time with no job on
 * it at all. Collapsing them into "hours lost" in the UI as well as the
 * arithmetic would hide the difference that matters most — a tech fixes an
 * overrun by working differently, a comeback by working better, and waiting on
 * parts by talking to somebody.
 *
 * "unpaid_clock" was added 2026-08-19 because the board had NO third kind and
 * therefore no way to show a ledger row. Waiting on parts, waiting on approval
 * and shop time are precisely the unpaid hours a flat-rate tech has no op code
 * for, so a leaderboard built only from OpCodePerformance could never reach
 * them: on 2026-08-18 that hid 3.50h — 51% of the period's real unpaid time —
 * behind a subtitle claiming "every source the app can measure".
 */
export type LeakKind = "overrun" | "rework" | "unpaid_clock";

/**
 * Which of buildUnpaidSummary's two sources a row came from.
 *
 * Carried because the wording differs and nothing else can tell them apart: an
 * RO-side rework row is N comeback LINES on tickets, a ledger-side rework row is
 * N ENTRIES the tech typed with no ticket at all. Same kind, same arithmetic,
 * two different sentences.
 */
export type LeakSource = "opcode" | "ledger";

export type Leak = {
  key: string;
  code: string;
  description: string;
  kind: LeakKind;
  source: LeakSource;
  /** Hours on the clock that no flag hour paid for. */
  hours: number;
  /**
   * Rows behind the number — timed uses for an overrun, comeback lines for
   * RO-side rework, ledger entries for anything from the ledger.
   */
  uses: number;
  /** Present for an overrun so the row can show what the job runs at. */
  ratio: number | null;
};

export type LeakBoard = {
  leaks: Leak[];
  /** Sum of `hours`. A real sum — see the note below on double counting. */
  totalHours: number;
};

/**
 * The tiebreak, when two leaks cost the same hours over the same number of rows.
 *
 * An overrun at least PAID some of its time; rework and unpaid clock paid none
 * of it, so at equal hours the unpaid kind is the worse finding and ranks
 * above. That rule is documented (bot/INSTRUCTIONS.md §7e) and was, until this
 * map existed, true only by accident: the comparator stopped at hours-then-uses
 * and the rest came from Array.prototype.sort's stability plus the order the
 * loop above happens to push in — which pushes the OVERRUN first, i.e. exactly
 * backwards. It never showed up because an exact hours-and-uses tie has never
 * occurred in real data. Latent, not harmless: sort stability is the wrong
 * thing to encode a product rule in.
 *
 * rework and unpaid_clock share a rank on purpose. Both paid nothing and no
 * rule says which of the two is worse, so inventing an order between them here
 * would be a preference dressed up as arithmetic. Keyed on the kind rather than
 * "is this an overrun" so a fourth kind has to state its rank instead of
 * defaulting into one — the same reason LeakSection colours by kind.
 */
const LEAK_KIND_RANK: Record<LeakKind, number> = {
  rework: 0,
  unpaid_clock: 0,
  overrun: 1,
};

/**
 * Every source of unpaid time this page can measure, ranked worst first.
 *
 * THE TOTAL IS A REAL SUM, and that is the whole reason this function exists
 * rather than a looser "what's costing you" list. Two properties hold:
 *
 *   - Overrun and rework never count the same hour. A comeback flags zero by DB
 *     CHECK, so its lines cannot clear the `flagHours > 0` test in
 *     opCodePerformance and contribute nothing to flagTotal/actualTotal. The two
 *     buckets are disjoint by construction, not by convention.
 *   - Weekday efficiency is deliberately NOT a row here. A slow Monday is slow
 *     largely BECAUSE the jobs on it overran, so its hours are already counted
 *     above and adding them would inflate the headline with hours that exist
 *     once in the shop and twice on the page. Best days stays its own section,
 *     as a pattern rather than a quantity. Truth over comfort cuts both ways:
 *     the bigger number would have been the flattering one to print.
 *
 * Built from the same OpCodePerformance rows the table below renders, so the
 * leaderboard and the table can never report different hours for one op code.
 *
 * TWO SOURCES, NOT ONE — and the second argument is required for that reason.
 * `rows` can only ever describe work that HAS an op code. The unpaid-time ledger
 * (waiting on parts, waiting on approval, shop time, and comebacks with no
 * ticket) has none by definition, so for as long as this function took one
 * argument those hours were structurally unreachable, not merely missing. A
 * defaulted parameter would let a caller reproduce that silently, so there
 * isn't one.
 *
 * `unpaidLines` is buildUnpaidSummary's OWN output — the same flattening, the
 * same kinds, the same note fallback — rather than a second derivation of the
 * ledger written here. Two functions answering "how much unpaid time" WILL
 * drift; only the *ledger* half is read (`source === "ledger"`), because the
 * RO-comeback half is already on the board as each op code's rework row and
 * counting it twice is the opposite bug.
 */
export function leakBoard(
  rows: OpCodePerformance[],
  unpaidLines: UnpaidLine[],
): LeakBoard {
  const leaks: Leak[] = [];

  for (const row of rows) {
    // The two buckets are tested INDEPENDENTLY, not as a switch on opCodeState.
    // A code can both run long and come back, and opCodeState reports only the
    // first ("measured" wins as soon as a ratio exists) — gating on it dropped
    // the rework hours of every code that also had paid, timed lines, which
    // under-reported the loss on exactly the codes in the worst shape.
    //
    // A row can therefore contribute two entries. That is the honest shape:
    // "ran 6h long" and "came back for 3h free" are different findings about
    // the same code and a tech fixes them differently.

    // Overrun needs book time to overrun. Under it is a win, not a leak — that
    // belongs to gainBoard.
    if (row.flagTotal > 0) {
      const overrun = row.actualTotal - row.flagTotal;
      if (overrun >= MIN_MEASURED_HOURS) {
        leaks.push({
          key: `${row.key}:overrun`,
          code: row.code,
          description: row.description,
          kind: "overrun",
          source: "opcode",
          hours: overrun,
          uses: row.timedUses,
          ratio: row.ratio,
        });
      }
    }

    // Rework is hours against zero flag, so it never overlaps the overrun above
    // — a comeback cannot clear the flagHours > 0 test in opCodePerformance.
    // A code that has never been timed and never come back contributes nothing:
    // silence is not evidence of zero loss, and inventing a number here would
    // put hours on the page that no clock ever produced.
    if (row.unpaidHours >= MIN_MEASURED_HOURS) {
      leaks.push({
        key: `${row.key}:rework`,
        code: row.code,
        description: row.description,
        kind: "rework",
        source: "opcode",
        hours: row.unpaidHours,
        uses: row.unpaidUses,
        ratio: null,
      });
    }
  }

  // ── the ledger half ───────────────────────────────────────────────────────
  // Grouped BY KIND, not per row: "Waiting on parts · 3.5h" is the finding, and
  // three separate 1.2h rows for the same cause would push the real leaders off
  // the board. The kind is also the only label a ledger row has — there is no
  // op code to name it by — so UNPAID_TIME_KIND_LABELS is what the tech reads.
  const ledger = new Map<
    UnpaidTimeKind,
    { hours: number; uses: number; notes: Set<string> }
  >();
  for (const line of unpaidLines) {
    if (line.source !== "ledger") continue;
    let group = ledger.get(line.kind);
    if (!group) {
      group = { hours: 0, uses: 0, notes: new Set<string>() };
      ledger.set(line.kind, group);
    }
    group.hours += line.hours;
    group.uses += 1;
    // buildUnpaidSummary already applied the `row.note ?? ""` fallback.
    if (line.description) group.notes.add(line.description);
  }

  for (const [kind, group] of ledger) {
    // MIN_MEASURED_HOURS is deliberately NOT applied here. It is a floor on
    // TIMER readings against book time — six minutes is how the app tells a
    // real measurement from a tapped-and-saved one. A ledger row was typed (or
    // banked from a hold) by the tech on purpose, so a short one is data, not a
    // mis-tap; dropping it would put this board back out of step with the
    // period's unpaid total, which is the entire bug being fixed. Only an
    // all-zero group is skipped, and it contributes nothing either way.
    if (group.hours <= 0) continue;
    leaks.push({
      key: `ledger:${kind}`,
      code: UNPAID_TIME_KIND_LABELS[kind],
      // A single shared note is the row's detail; several different notes have
      // no one answer, so the row says nothing rather than picking one.
      description: group.notes.size === 1 ? [...group.notes][0] : "",
      // A ledger comeback IS rework — it just has no ticket. Bucketed exactly
      // the way buildUnpaidSummary buckets it into comebackHours, so the two
      // surfaces cannot disagree about what counts as rework.
      kind: isComebackKind(kind) ? "rework" : "unpaid_clock",
      source: "ledger",
      hours: group.hours,
      uses: group.uses,
      ratio: null,
    });
  }

  leaks.sort(
    (a, b) =>
      b.hours - a.hours ||
      b.uses - a.uses ||
      LEAK_KIND_RANK[a.kind] - LEAK_KIND_RANK[b.kind],
  );
  return {
    leaks,
    totalHours: leaks.reduce((sum, leak) => sum + leak.hours, 0),
  };
}

export type Gain = {
  key: string;
  code: string;
  description: string;
  /** Hours the book paid that the job did not take. */
  hours: number;
  uses: number;
  ratio: number;
};

/**
 * The other half of the ledger: codes that beat book time, best first.
 *
 * A page that only ever reports losses gets read as broken or as nagging, and
 * a flat rate tech's whole trade is beating the book — the wins are the job
 * being done well, not a consolation prize. Same rows, same arithmetic,
 * opposite sign.
 */
export function gainBoard(rows: OpCodePerformance[]): Gain[] {
  const gains: Gain[] = [];
  for (const row of rows) {
    if (opCodeState(row) !== "measured") continue;
    const saved = row.flagTotal - row.actualTotal;
    if (saved < MIN_MEASURED_HOURS) continue;
    gains.push({
      key: row.key,
      code: row.code,
      description: row.description,
      hours: saved,
      uses: row.timedUses,
      ratio: row.ratio as number,
    });
  }
  return gains.sort((a, b) => b.hours - a.hours || b.uses - a.uses);
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
  // Flagged hours on days the app could not put a length to — no clock entry,
  // and no schedule that covers the day. They are NOT in flagHours (see the
  // pairing rule in periodTrend) and so are not in the percentage either.
  // Carried instead of dropped because they are real hours the tech turned:
  // a Saturday that pays but never gets clocked is the ordinary case, and a
  // page that silently subtracts it is a page that hides work.
  unpairedFlagHours: number;
  unpairedDays: number;
};

/**
 * Classify a trend point's percentage — through the ONE shared classifier.
 *
 * WHY THIS ADAPTER EXISTS. The two shapes that carry unpaired hours use
 * OPPOSITE conventions, with identical field names, so handing a trend point
 * straight to efficiencyDisplay is silently wrong rather than a type error:
 *
 *   ScheduleStats.flagHours     RAW period total. `unpairedFlagHours` is a
 *                               SUBSET of it (stats.ts builds it from the plain
 *                               aggregateStats base, which sums every entry).
 *   PeriodTrendPoint.flagHours  PAIRED total ONLY. The pairing loop below adds
 *                               an unpaired day's hours to `unpairedFlagHours`
 *                               and `continue`s, so they were never in
 *                               `flagHours` at all.
 *
 * efficiencyDisplay computes `counted = flagHours - unpairedFlagHours`. Pass a
 * trend point unchanged and that is 0 - 42 = -42 counted hours: a negative
 * numerator, no type error, no test failure, a wrong answer. The addition here
 * restores the raw total the classifier is written against.
 *
 * A shape adapter, NOT a second predicate — every decision is still made by
 * efficiencyDisplay (memory/feedback_duplicate_derivations_drift.md).
 */
export function trendEfficiencyDisplay(
  point: PeriodTrendPoint,
): EfficiencyDisplay {
  return efficiencyDisplay({
    flagHours: point.flagHours + point.unpairedFlagHours,
    efficiency: point.efficiency,
    unpairedFlagHours: point.unpairedFlagHours,
    unpairedDays: point.unpairedDays,
  });
}

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
        unpairedFlagHours: 0,
        unpairedDays: 0,
      };
      byKey.set(range.key, point);
    }
    return point;
  };

  // Both loops, not just entries: a period where the tech clocked in and flagged
  // nothing is the most important point on this chart, and it has no entries to
  // find it by.
  //
  // The numerator is PAIRED with the denominator, exactly as
  // aggregateStatsWithSchedule does it (stats.ts:224-243) and as
  // weekdayEfficiency above already did: a day's flag hours count only if that
  // day also contributed a length. Summing every entry over a paired
  // denominator is an unpaired top on a paired bottom, and it is why /pay-period
  // read 387% while this page read 627% for the same fortnight — four weekend
  // days with flagged work, no clock and no schedule sat in one number and not
  // the other. stats.ts:273-276 records the DENOMINATOR half of this same leak
  // being closed once already; this is the other half.
  //
  // touch() stays unconditional. A period is a period because work happened in
  // it, whether or not the app knows how long the days were — dropping the key
  // would erase the bar entirely instead of reporting an unknown.
  const unpairedDates = new Set<string>();
  for (const entry of entries) {
    const point = touch(entry.date);
    if (denomByDay[entry.date]) {
      point.flagHours += entry.flagHours;
      continue;
    }
    point.unpairedFlagHours += entry.flagHours;
    if (!unpairedDates.has(entry.date)) {
      unpairedDates.add(entry.date);
      point.unpairedDays += 1;
    }
  }
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

// ---------------------------------------------------------------------------
// Big jobs — the per-job scorecard, scoped to where measurement is real
// ---------------------------------------------------------------------------

/**
 * Timed uses before a code's ratio is presented as a finding rather than a
 * first look.
 *
 * THREE. Below it, one unusual job IS the average — a single bad water pump
 * (helper called away, bolt snapped) becomes "you run water pumps at 1.6x" and
 * the tech either disbelieves the page or, worse, believes it. The row is still
 * shown at n=1 and n=2, because hiding it would make a tech who just timed a job
 * think the timing did nothing; it is shown as provisional and says how many
 * more it needs.
 */
export const MIN_USES_TO_JUDGE = 3;

export type BigJobRow = OpCodePerformance & {
  /** Enough timed readings to state the ratio as a finding. */
  confident: boolean;
  /** Readings still needed to get there. 0 once confident. */
  needsMore: number;
  /** At least one reading behind the ratio is a tapped estimate, not a clock. */
  hasEstimate: boolean;
};

/**
 * Per-code performance over BIG JOBS ONLY.
 *
 * Scoped deliberately, and the scope is the point. Across production data 68% of
 * lines flag under an hour, essentially none of them are ever timed, and the
 * count of them in a day correlates with that day's flag hours at 0.067. A
 * per-job ratio table spanning everything is therefore mostly empty rows for
 * work whose speed does not move the paycheck — it buries the handful of
 * measurements that are worth something under the ones that are not.
 *
 * Lines are filtered BEFORE grouping, not after: a code used both ways (a 2.5h
 * job on one ticket, a 0.4h version on another) must contribute only its heavy
 * lines here, or the ratio silently mixes two different jobs.
 */
export function bigJobPerformance(
  entries: Entry[],
  library: OpCode[],
): BigJobRow[] {
  const heavyOnly = entries
    .map((entry) => ({
      ...entry,
      opCodes: entry.opCodes.filter((line) => line.flagHours >= HEAVY_FLAG_HOURS),
    }))
    .filter((entry) => entry.opCodes.length > 0);

  const estimatedKeys = new Set<string>();
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  for (const entry of heavyOnly) {
    for (const line of entry.opCodes) {
      if (line.actualSource !== "estimate") continue;
      if (!isMeasuredLine(line)) continue;
      const id = groupKey(line, libraryById);
      if (id) estimatedKeys.add(id.key);
    }
  }

  return opCodePerformance(heavyOnly, library).map((row) => ({
    ...row,
    confident: row.timedUses >= MIN_USES_TO_JUDGE,
    needsMore: Math.max(0, MIN_USES_TO_JUDGE - row.timedUses),
    hasEstimate: estimatedKeys.has(row.key),
  }));
}

/**
 * How much of the big-job work has any reading at all behind it.
 *
 * Put on the page next to the table, because a confident-looking scorecard built
 * on 4% coverage is the most dangerous thing this file could produce. A tech is
 * entitled to know whether they are looking at their record or at a sample of it.
 */
export type BigJobCoverage = {
  lines: number;
  measured: number;
  /** 0-100. */
  pct: number;
};

export function bigJobCoverage(entries: Entry[]): BigJobCoverage {
  let lines = 0;
  let measured = 0;
  for (const entry of entries) {
    for (const line of entry.opCodes) {
      if (line.flagHours < HEAVY_FLAG_HOURS) continue;
      lines += 1;
      if (isMeasuredLine(line)) measured += 1;
    }
  }
  return { lines, measured, pct: lines > 0 ? (measured / lines) * 100 : 0 };
}
