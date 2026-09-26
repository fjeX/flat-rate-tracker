// Pure dispute-outcome math. No I/O, no React — plain functions of a dispute
// list, so it's trivially unit-testable and safe from Server Components, client
// components, and tests alike. Mirrors lib/reconcile.ts and lib/wage-check.ts.
//
// What this module exists to answer, which FRT previously could not: did the
// tech actually get paid? buildDisputePack() produces the claim; this produces
// the outcome, the lifetime-recovered figure, and the coaching that falls out of
// comparing claims that won against claims that didn't.
//
// TWO RULES CARRIED FROM THE SCHEMA:
//
//  - Recovered amounts are a SEPARATE ledger. Nothing here is ever added into
//    period earnings or the flagged-vs-paid variance. When a short gets paid it
//    shows up as the line's paidHours going up; adding it here too would
//    double-count the same money.
//  - Dollars degrade to null, never 0. A dispute raised before any labor rate
//    was priced has a genuinely unknown dollar value. Summing it as 0 would
//    understate the lifetime figure and make "we recovered $0" indistinguishable
//    from "we don't know what that was worth".
import type {
  Dispute,
  DisputeLine,
  DisputeStatus,
  Entry,
  EntryOpCode,
  NewDispute,
  NewDisputeLine,
  OpCode,
} from "./types";
import type { DisputePack } from "./dispute-pack";
import { lineCode } from "./line-label";

// Tolerance for calling a claim fully recovered. Matches reconcile.ts PAY_EPS:
// shops round flag hours, so a 0.05h (3 min) gap isn't a real shortfall.
export const RECOVERY_EPS = 0.05;

// Float-comparison epsilon for "is this literally the same number?". NOT a
// rounding tolerance and never interchangeable with RECOVERY_EPS: every hours
// column involved is numeric(5,2) (see the dispute_ledger migration), so two
// values that differ at all differ by at least 0.01. This exists only to absorb
// IEEE-754 representation noise, which is ~1e-16 at these magnitudes.
//
// Using RECOVERY_EPS for this job is what kept the accretion bug alive after the
// first fix: a per-line recovery smaller than 0.05h (a 2-minute correction is a
// real thing) did not move the live value far enough to trip a 0.05 mismatch, so
// the offer re-armed and the same hours were written up to
// floor(RECOVERY_EPS / hours) + 1 times.
const SAME_VALUE_EPS = 1e-9;

/** Terminal states — a dispute in one of these is closed and off the queue. */
export function isClosed(status: DisputeStatus): boolean {
  return status === "resolved" || status === "withdrawn";
}

/**
 * The next status in the happy path, or null at the end of it.
 *
 * 'withdrawn' is deliberately NOT reachable from here — dropping a claim is an
 * explicit choice the tech makes, never the default next tap.
 */
export function nextStatus(status: DisputeStatus): DisputeStatus | null {
  switch (status) {
    case "generated":
      return "submitted";
    case "submitted":
      return "answered";
    case "answered":
      return "resolved";
    default:
      return null;
  }
}

export type DisputeOutcome = "open" | "full" | "partial" | "denied";

/**
 * Is this gap bigger than rounding? THE one 3-minute boundary for disputes.
 *
 * The app-wide 3-minute (0.05h) rounding tolerance, same as reconcile.ts
 * PAY_EPS: shops round flag hours, so a gap of 0.05h or less either way is
 * rounding, not a shortfall worth a second round and not goodwill worth a note.
 *
 * The SAME_VALUE_EPS slack is not a second tolerance, it is float hygiene. Both
 * figures are numeric(5,2), but a difference of two of them in IEEE-754 lands a
 * hair ABOVE 0.05 for more than half of all exactly-3-minute gaps (0.14 - 0.09
 * is 0.05000000000000002), so a bare `> RECOVERY_EPS` decided the exact
 * boundary on a coin flip of the values involved. It also absorbs the ~1e-16
 * drift between a claim's stored header total and a float re-sum of its lines.
 *
 * Every 3-minute decision in this module goes through here — the outcome
 * label, the multi-line full-settlement gate, and the goodwill threshold — so
 * they cannot disagree at the boundary. They did once: the label had the float
 * allowance and the gate did not, and ~half of all exact-0.05h multi-line
 * claims read "Paid in full" above a card saying the recovery couldn't be
 * placed on individual lines.
 */
function exceedsRounding(gapHours: number): boolean {
  return gapHours > RECOVERY_EPS + SAME_VALUE_EPS;
}

/**
 * Does this recovery count as the whole ask? True when the shortfall is within
 * rounding (see exceedsRounding).
 *
 * Drives the outcome LABEL and the multi-line full-settlement GATE — whether
 * each line may be credited its ask. It never sizes a write on its own: a
 * one-line claim always writes what was actually recovered, whatever this
 * says. See the single-line branch of pendingRecoveryApplication.
 */
function coversClaim(claimedHours: number, recoveredHours: number): boolean {
  return !exceedsRounding(claimedHours - recoveredHours);
}

/**
 * What actually happened to one claim.
 *
 * Judged on HOURS, not dollars, because hours are always known and dollars
 * aren't (an unpriced period has null dollars but real hours). A zero-hour claim
 * that somehow got resolved counts as "full" — there was nothing to recover, so
 * it can't be a denial.
 *
 * ORDER MATTERS: "full" is checked FIRST, "denied" second. The old code asked
 * "was the recovery within RECOVERY_EPS of zero?" first, and an absolute 0.05h
 * tolerance measured from zero swallows a tiny claim whole: 0.05h recovered on
 * a 0.10h ask is a full win by the rounding rule, but it read "Denied" — and
 * 0.03h recovered on a 3.0h ask read "Denied" too, when money did arrive. The
 * zero test exists to mean "nothing came back", so it is now a true zero test
 * (SAME_VALUE_EPS, float noise only), not a rounding tolerance.
 */
export function disputeOutcome(dispute: Dispute): DisputeOutcome {
  if (!isClosed(dispute.status)) return "open";
  if (coversClaim(dispute.claimedHours, dispute.recoveredHours)) {
    return "full";
  }
  // Withdrawn with nothing recovered is a denial in substance: the tech asked
  // and walked away with nothing. Withdrawn AFTER a partial payment still counts
  // as partial — the money arrived, however little of it.
  if (dispute.recoveredHours <= SAME_VALUE_EPS) return "denied";
  return "partial";
}

export type LifetimeRecovery = {
  claimedHours: number;
  recoveredHours: number;
  // null when NO dispute in the set carried a dollar value at all. Otherwise the
  // sum over those that did — a mixed set reports the dollars it knows about.
  claimedDollars: number | null;
  recoveredDollars: number | null;
  disputeCount: number; // every dispute, open or closed
  closedCount: number;
  openCount: number;
  fullCount: number;
  partialCount: number;
  deniedCount: number;
  // Share of CLOSED claims that recovered something (0..1). null when nothing is
  // closed yet — a win rate over zero decided claims is not 0%, it's unknown.
  winRate: number | null;
  // Share of closed claimed hours actually recovered (0..1). null when closed
  // claims total zero hours.
  hourRecoveryRate: number | null;
};

/**
 * Roll a dispute list into the lifetime ledger. Feeds the dashboard headline
 * ("FRT has recovered $X for you") and the pay-period history.
 *
 * Open claims count toward claimed totals but never toward recovery rates —
 * mixing "not answered yet" into a win rate would make the number drift down
 * every time a new claim is raised.
 */
export function lifetimeRecovery(disputes: Dispute[]): LifetimeRecovery {
  let claimedHours = 0;
  let recoveredHours = 0;
  let claimedDollars = 0;
  let recoveredDollars = 0;
  let anyClaimedDollars = false;
  let anyRecoveredDollars = false;
  let closedCount = 0;
  let fullCount = 0;
  let partialCount = 0;
  let deniedCount = 0;
  let closedClaimedHours = 0;
  let closedRecoveredHours = 0;

  for (const d of disputes) {
    claimedHours += d.claimedHours;
    recoveredHours += d.recoveredHours;
    if (d.claimedDollars !== null) {
      claimedDollars += d.claimedDollars;
      anyClaimedDollars = true;
    }
    if (d.recoveredDollars !== null) {
      recoveredDollars += d.recoveredDollars;
      anyRecoveredDollars = true;
    }

    const outcome = disputeOutcome(d);
    if (outcome === "open") continue;
    closedCount += 1;
    closedClaimedHours += d.claimedHours;
    closedRecoveredHours += d.recoveredHours;
    if (outcome === "full") fullCount += 1;
    else if (outcome === "partial") partialCount += 1;
    else deniedCount += 1;
  }

  return {
    claimedHours,
    recoveredHours,
    claimedDollars: anyClaimedDollars ? claimedDollars : null,
    recoveredDollars: anyRecoveredDollars ? recoveredDollars : null,
    disputeCount: disputes.length,
    closedCount,
    openCount: disputes.length - closedCount,
    fullCount,
    partialCount,
    deniedCount,
    winRate:
      closedCount === 0 ? null : (fullCount + partialCount) / closedCount,
    hourRecoveryRate:
      closedClaimedHours <= 0 ? null : closedRecoveredHours / closedClaimedHours,
  };
}

// Minimum closed claims on BOTH sides of a comparison before it's reported.
// Below this, one lucky or unlucky claim swings the "win rate" to 0% or 100% and
// the app would be coaching from noise.
export const MIN_INSIGHT_SAMPLE = 3;

export type OutcomeInsight = {
  id: "scope" | "photo";
  // Pre-formatted comparison the UI renders as prose. Percentages are 0..1.
  betterLabel: string;
  betterRate: number;
  betterCount: number;
  worseLabel: string;
  worseRate: number;
  worseCount: number;
};

function winRateOf(disputes: Dispute[]): { rate: number; count: number } {
  const closed = disputes.filter((d) => isClosed(d.status));
  if (closed.length === 0) return { rate: 0, count: 0 };
  const won = closed.filter((d) => disputeOutcome(d) !== "denied").length;
  return { rate: won / closed.length, count: closed.length };
}

/**
 * Outcome coaching: which KINDS of claim actually get paid.
 *
 * Both comparisons are gated on MIN_INSIGHT_SAMPLE per side and on the two rates
 * actually differing, so the app stays silent until it has something real to
 * say. Returning [] is the normal state for a new user and must render as
 * nothing at all, not as an empty panel.
 */
export function outcomeInsights(disputes: Dispute[]): OutcomeInsight[] {
  const out: OutcomeInsight[] = [];

  // Itemized (per-RO) claims vs. period-total claims. This is the payoff for
  // techs who request the per-RO hours breakdown from payroll — if itemized
  // claims win more, the app can tell them it's worth asking for.
  const itemized = winRateOf(disputes.filter((d) => d.scope === "lines"));
  const periodTotal = winRateOf(disputes.filter((d) => d.scope === "period"));
  if (
    itemized.count >= MIN_INSIGHT_SAMPLE &&
    periodTotal.count >= MIN_INSIGHT_SAMPLE &&
    itemized.rate !== periodTotal.rate
  ) {
    const itemizedWins = itemized.rate > periodTotal.rate;
    out.push({
      id: "scope",
      betterLabel: itemizedWins ? "Itemized by RO" : "Period total",
      betterRate: itemizedWins ? itemized.rate : periodTotal.rate,
      betterCount: itemizedWins ? itemized.count : periodTotal.count,
      worseLabel: itemizedWins ? "Period total" : "Itemized by RO",
      worseRate: itemizedWins ? periodTotal.rate : itemized.rate,
      worseCount: itemizedWins ? periodTotal.count : itemized.count,
    });
  }

  // Claims backed by a photo vs. claims without. Only itemized claims carry
  // per-line photo evidence, so a period-total claim can't participate.
  const withPhoto = winRateOf(
    disputes.filter((d) => d.lines.some((l) => l.hadPhoto)),
  );
  const withoutPhoto = winRateOf(
    disputes.filter(
      (d) => d.scope === "lines" && !d.lines.some((l) => l.hadPhoto),
    ),
  );
  if (
    withPhoto.count >= MIN_INSIGHT_SAMPLE &&
    withoutPhoto.count >= MIN_INSIGHT_SAMPLE &&
    withPhoto.rate !== withoutPhoto.rate
  ) {
    const photoWins = withPhoto.rate > withoutPhoto.rate;
    out.push({
      id: "photo",
      betterLabel: photoWins ? "With a photo on file" : "No photo",
      betterRate: photoWins ? withPhoto.rate : withoutPhoto.rate,
      betterCount: photoWins ? withPhoto.count : withoutPhoto.count,
      worseLabel: photoWins ? "No photo" : "With a photo on file",
      worseRate: photoWins ? withoutPhoto.rate : withPhoto.rate,
      worseCount: photoWins ? withoutPhoto.count : withPhoto.count,
    });
  }

  return out;
}

/**
 * Whole days since the claim was handed over, or null if it hasn't been.
 * Feeds the "waiting on a response for 12 days" nudge.
 */
export function daysWaiting(
  dispute: Dispute,
  now: Date = new Date(),
): number | null {
  if (dispute.submittedAt === null) return null;
  if (dispute.answeredAt !== null || isClosed(dispute.status)) return null;
  const submitted = new Date(dispute.submittedAt).getTime();
  const ms = now.getTime() - submitted;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

/**
 * Freeze a built DisputePack into the NewDispute snapshot the ledger stores.
 *
 * This is the one place claim data crosses from "derived live from ROs" into
 * "frozen historical record", so it copies every displayed value rather than
 * keeping a reference. The pack's unpaidRework section is deliberately NOT
 * carried over: it is a different claim with its own totals (see the
 * dispute-pack docs) and folding it into claimedHours would inflate the ask.
 */
export function disputeFromPack(
  pack: DisputePack,
  periodKey: string,
): NewDispute {
  const lines: NewDisputeLine[] = pack.lines.map((l) => ({
    entryId: l.entryId,
    lineId: null, // pack lines identify the RO + code, not the line row id
    roNumber: l.roNumber,
    code: l.code,
    description: l.description,
    workDate: l.date,
    flaggedHours: l.flagged,
    paidHours: l.paid,
    claimedHours: l.deltaHours,
    claimedDollars: l.deltaDollars,
    hadPhoto: false, // set by the caller, which knows the photo index
  }));
  return {
    periodKey,
    periodLabel: pack.periodLabel,
    // A pack with itemized lines is an itemized claim. A pack with none is the
    // aggregate case — the tech only has the standard stub's period totals.
    scope: lines.length > 0 ? "lines" : "period",
    claimedHours: pack.totalShortHours,
    claimedDollars: pack.totalShortDollars,
    lines,
  };
}

/** Sum of per-line recoveries — the cross-check against the header figure. */
export function sumLineRecovery(lines: DisputeLine[]): number {
  return lines.reduce((s, l) => s + l.recoveredHours, 0);
}

// ---------------------------------------------------------------------------
// Applying a recovery back to the lines — closing the loop between the two
// ledgers
// ---------------------------------------------------------------------------
//
// Recovery and reconciliation are separate ledgers on purpose (see the header),
// and NOTHING joined them: recordDisputeOutcomeAction writes recoveredHours on
// the claim and never touches a line's paidHours. So a claim could close with
// 34.0h recovered against a 31.4h shortfall and the period still read "31.4h
// short" forever — and the offer gate, which keys on that shortfall, would keep
// offering a second-round claim for hours the shop had already paid, with no
// upper bound.
//
// The fix is a bridge, not a merge. This module works out WHICH live lines the
// recovery lands on and what their paid hours would become; a tech taps once to
// apply it. Deliberately not automatic: recovered hours can be goodwill that
// maps to no line at all, and an app that writes numbers into your pay ledger
// without showing you the rows first is an app you stop trusting the moment one
// of them is wrong.

export type RecoveryApplicationRow = {
  /** The live entry_op_codes row this recovery lands on. */
  lineId: string;
  entryId: string;
  roNumber: string;
  code: string;
  flaggedHours: number;
  /** What the line reads now. null = never reconciled. */
  paidNow: number | null;
  /** Hours coming back to this line. */
  recoveredHours: number;
  /** What paidHours becomes: (paidNow ?? 0) + recoveredHours. */
  paidAfter: number;
};

export type RecoveryApplication = {
  rows: RecoveryApplicationRow[];
  /** Hours across `rows` — what the one tap would write. */
  applyHours: number;
  /**
   * Recovered hours that land on no live line: goodwill above the claim, a
   * deleted or renamed RO line, a claim whose per-line breakdown was never
   * recorded, or a PERIOD-TOTAL claim, which has no lines for money to land on
   * at all. Stays on the claim only. Reported so the two figures visibly
   * reconcile instead of the tech wondering where 2.6h went.
   *
   * The UI owes the tech a different sentence for each of those, and > 0 alone
   * does not distinguish them — see the unmapped-note comment in
   * DisputeOutcomeCard, which splits on `needsLineBreakdown` and the claim's own
   * `lines.length`.
   */
  unmappedHours: number;
  /**
   * True when the claim recovered hours, HAS itemized lines, and nothing could
   * be mapped because no per-line recovery was recorded and the settlement
   * wasn't full. The UI asks for the breakdown rather than guessing at a split.
   *
   * False for a period-total claim (`lines.length === 0`) even though it is
   * equally unmappable: there is no breakdown to go missing, so "the breakdown
   * wasn't recorded" would be the wrong thing to tell the tech. That state is
   * unmappedHours > 0 with needsLineBreakdown false and no lines, and the card
   * gives it its own copy.
   */
  needsLineBreakdown: boolean;
};

const EMPTY_APPLICATION: RecoveryApplication = {
  rows: [],
  applyHours: 0,
  unmappedHours: 0,
  needsLineBreakdown: false,
};

/**
 * What a closed claim's recovery would do to the live lines, or nothing.
 *
 * Only closed claims: an open one hasn't been answered, and writing paid hours
 * from a claim still in flight would report money that hasn't arrived.
 *
 * Per-line hours come from the per-line recoveries when they were recorded. If
 * they weren't, the ONLY other honest reading is a settlement that covered the
 * whole ask — then every line got its claim, no split is being invented, and
 * anything above the ask is goodwill. A partial settlement with no breakdown is
 * left alone: which lines the shop paid is a fact the app does not have —
 * UNLESS the claim has exactly one line, where there is no "which" to know.
 *
 * THE INVARIANT: never write more than was actually recovered. The one-line
 * claim meets it exactly; the multi-line full settlement can exceed it by at
 * most RECOVERY_EPS, a known, bounded limit of having no per-line breakdown.
 */
export function pendingRecoveryApplication(
  dispute: Dispute | null,
  entries: Entry[],
  library: OpCode[],
): RecoveryApplication {
  if (!dispute || !isClosed(dispute.status)) return EMPTY_APPLICATION;
  if (dispute.recoveredHours <= 0) return EMPTY_APPLICATION;

  const perLine = sumLineRecovery(dispute.lines);
  const claimed = dispute.lines.reduce((s, l) => s + l.claimedHours, 0);
  const usePerLine = perLine > 0;
  const singleLineRecovery = !usePerLine && dispute.lines.length === 1;
  // Multi-line only. The one-line claim never takes this road — see below.
  //
  // This branch writes each line's ASK, so with the rounding tolerance it can
  // write up to RECOVERY_EPS more than came back, in aggregate. Accepted here
  // and only here: with several lines and no per-line breakdown there is no
  // honest way to say which line the missing 3 minutes belong to without a
  // schema change, and the overshoot is bounded at 0.05h per claim.
  //
  // Same predicate as the "full" label (coversClaim), so a claim the card calls
  // "Paid in full" is always one it can apply, and vice versa. `claimed` is the
  // re-summed lines rather than dispute.claimedHours because it is the lines'
  // asks that get written; the two agree to float noise, which coversClaim
  // absorbs.
  const fullSettlement =
    !usePerLine &&
    !singleLineRecovery &&
    claimed > 0 &&
    coversClaim(claimed, dispute.recoveredHours);

  // THE ONE-LINE CLAIM — not a guess, an identity.
  //
  // A partial settlement with no per-line breakdown is normally unsplittable:
  // the shop paid *some* of the ask and which rows it landed on is a fact the
  // app does not have. That is a genuine ambiguity only while there is more
  // than one row to choose between. With exactly ONE claimed line there is
  // nothing to apportion — every recovered hour on this claim was claimed on
  // that line, so the mapping is forced by construction and no split is being
  // invented. This matters because it is the NORMAL close: the close flow
  // writes recoveredHours on the claim and never writes
  // dispute_lines.recovered_hours, so `usePerLine` is false for almost every
  // real claim, and a single-line partial recovery was being handed back to
  // the tech to re-type by hand.
  //
  // The line gets dispute.recoveredHours, deliberately NOT dl.claimedHours:
  // claimedHours is what was ASKED for, and the fullSettlement branch may use
  // it only because that branch has already established the whole ask came
  // back. Here it did not, so applying the ask would write hours the shop
  // never paid — the exact failure this module exists to prevent.
  //
  // WHY THIS BRANCH NOW OWNS EVERY ONE-LINE CLAIM, full settlements included.
  // It used to fire only when `!fullSettlement`, so a one-line claim whose
  // recovery was within RECOVERY_EPS of the ask went down the fullSettlement
  // road and got its ASK written instead. An absolute 0.05h tolerance swallows
  // a tiny claim: 0.10h asked, 0.05h recovered, and 0.05 + 0.05 >= 0.10 called
  // it "full", so paid went 3.30 -> 3.40 when only 3.35 was ever paid. Half the
  // write was hours nobody recovered. The tolerance is fine for a LABEL (see
  // disputeOutcome); it is never a licence to write money. With one line there
  // is nothing to apportion, so the exact recovered figure is always available
  // and always what gets written: 2.96h back on a 3.0h ask writes 2.96.
  //
  // Capped at the line's ask, and ONLY at the ask. Recovery above what this
  // line claimed is goodwill, which every other road reports as unmapped
  // rather than writing onto a line (the fullSettlement branch always did this
  // for one-line claims, and the card's goodwill note depends on it). The cap
  // can only ever LOWER the write, so it cannot break the invariant. A line
  // with no recorded ask (claimedHours 0) has nothing to cap against, and the
  // whole recovery is written as before. Nothing is clamped against flag hours.
  // Whatever fails to map falls out in `unmapped` below.

  if (!usePerLine && !fullSettlement && !singleLineRecovery) {
    return {
      ...EMPTY_APPLICATION,
      unmappedHours: dispute.recoveredHours,
      needsLineBreakdown: dispute.lines.length > 0,
    };
  }

  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const rows: RecoveryApplicationRow[] = [];
  let applyHours = 0;
  let matchedRecovery = 0;
  // One live line is claimable once. Without this, two dispute rows for the
  // same RO and code (the shop's own duplicate, or a re-claim) would both land
  // on it and pay it twice.
  const taken = new Set<string>();

  for (const dl of dispute.lines) {
    const hours = usePerLine
      ? dl.recoveredHours
      : singleLineRecovery
        ? dl.claimedHours > 0
          ? Math.min(dispute.recoveredHours, dl.claimedHours)
          : dispute.recoveredHours
        : dl.claimedHours;
    if (hours <= 0) continue;

    const live = findLiveLine(dl, entries, libraryById, taken);
    if (!live) continue;

    matchedRecovery += hours;
    const paidNow = live.line.paidHours ?? null;
    const paidAfter = (paidNow ?? 0) + hours;

    // ALREADY APPLIED — the guard against paying a line twice, and it cannot be
    // "is the line still short": a partial recovery leaves the line short on
    // purpose (flagged 5, paid 2, shop returns 1), so a short line would be
    // offered again every render and the second tap would write 4.
    //
    // The offer is armed by ONE condition: the live line still reads exactly
    // what the claim froze. dl.paidHours is the claim-time snapshot; if the live
    // value has moved AT ALL — in either direction — this claim no longer
    // describes the line in front of us and the app has no honest basis for
    // adding hours to it.
    //
    //  - moved UP: the money is already on the books, by an earlier tap of this
    //    same button or by the tech typing it into Reconciliation afterwards.
    //  - moved DOWN, including cleared back to Pending (paid_hours -> null):
    //    the tech deliberately un-reconciled the line. The old guard only
    //    compared upward (`paidNow > paidAtClaim`), so a cleared line looked
    //    like "never applied" and the offer RE-ARMED. Each subsequent tap then
    //    wrote (whatever is there now) + recoveredHours, walking a line the tech
    //    cleared to 0 up through 4 -> 8 -> 12 -> 16 with hours nobody typed.
    //    The old ceiling that eventually stopped it was arithmetic coincidence,
    //    not a design: it halted at the first multiple of `hours` to clear
    //    paidAtClaim, which lands on the true entitlement only when paidAtClaim
    //    is an exact multiple of `hours`.
    //
    // Skipping is always the safe direction to be wrong in: the worst case is a
    // number the tech records themselves in Reconciliation. Writing is not —
    // the worst case there is hours the tech never earned, in the one ledger
    // that is supposed to prove what they were paid.
    //
    // KNOWN LIMIT: whenever the live line reads exactly the claim-time value,
    // "never applied" and "applied, then hand-edited back to that value" are the
    // same two numbers and the data cannot tell them apart — there is no
    // applied-at marker on dispute_lines and adding one is a schema change. The
    // common shape is zero/zero (claim froze null-or-0, line still null-or-0).
    // That state re-offers, which is correct for a genuinely-unapplied claim and
    // at worst ONE re-application for the other.
    //
    // It cannot accrete, and now that the guard is a true equality test the
    // bound holds for every recovery size: `hours` is numeric(5,2) and > 0 here,
    // so it is at least 0.01, and the write moves the live value by exactly that
    // much. 0.01 > SAME_VALUE_EPS, so the very next render sees a mismatch and
    // skips. Re-arming again takes a deliberate manual edit of the line back to
    // the frozen value, and each such edit buys exactly one more offer.
    if (!sameAsClaimTime(paidNow, dl.paidHours)) continue;

    taken.add(live.line.id);
    rows.push({
      lineId: live.line.id,
      entryId: live.entry.id,
      roNumber: live.entry.roNumber,
      code: lineCode(live.line, libraryById),
      flaggedHours: live.line.flagHours,
      paidNow,
      recoveredHours: hours,
      paidAfter,
    });
    applyHours += hours;
  }

  const unmapped = dispute.recoveredHours - matchedRecovery;
  return {
    rows,
    applyHours,
    // Goodwill of 3 minutes or less is rounding, the same boundary as the
    // label's shortfall — including at exactly 0.05h over, which a bare
    // `> RECOVERY_EPS` showed or hid on float noise.
    unmappedHours: exceedsRounding(unmapped) ? unmapped : 0,
    needsLineBreakdown: false,
  };
}

/**
 * Does the live line still read exactly what the claim froze?
 *
 * null degrades to 0 FOR THIS COMPARISON ONLY. Everywhere else in the app
 * "pending, never reconciled" and "reconciled at zero" are deliberately
 * different facts, but the only question here is "has this money landed on the
 * line yet?", and both answer no. A line that was pending at claim time and has
 * since been reconciled at zero has had nothing applied to it, so it must still
 * be offered.
 *
 * This is a genuine EQUALITY test, deliberately not a tolerance. Both sides are
 * numeric(5,2), so "unmoved" means unmoved to the cent-equivalent; anything the
 * shop's rounding does to an hours figure changes it by at least 0.01 and is a
 * move. Comparing with RECOVERY_EPS (0.05) instead made any recovery of 0.05h or
 * less invisible to its own guard — see SAME_VALUE_EPS.
 */
function sameAsClaimTime(
  paidNow: number | null,
  paidAtClaim: number | null,
): boolean {
  return Math.abs((paidNow ?? 0) - (paidAtClaim ?? 0)) <= SAME_VALUE_EPS;
}

/**
 * The live line a frozen claim row points at.
 *
 * disputeFromPack stores `lineId: null` — a pack row identifies the RO and the
 * code, not the row id — so the join is (entryId, code) against the live entry,
 * with the stored lineId honoured when a caller did record one. Flag hours
 * break a tie between two lines of the same code on one RO; without that, an RO
 * carrying the same code twice would always resolve to the first.
 */
function findLiveLine(
  dl: DisputeLine,
  entries: Entry[],
  libraryById: Map<string, OpCode>,
  taken: Set<string>,
): { entry: Entry; line: EntryOpCode } | null {
  if (dl.lineId) {
    for (const entry of entries) {
      const line = entry.opCodes.find((l) => l.id === dl.lineId);
      if (line && !taken.has(line.id)) return { entry, line };
    }
    return null;
  }

  const entry =
    entries.find((e) => e.id === dl.entryId) ??
    entries.find((e) => e.roNumber === dl.roNumber) ??
    null;
  if (!entry) return null;

  const candidates = entry.opCodes.filter(
    (l) => !taken.has(l.id) && lineCode(l, libraryById) === dl.code,
  );
  if (candidates.length === 0) return null;
  const exact = candidates.find(
    (l) => Math.abs(l.flagHours - dl.flaggedHours) <= RECOVERY_EPS,
  );
  return { entry, line: exact ?? candidates[0] };
}
