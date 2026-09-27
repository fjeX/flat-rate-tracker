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
import { payStatus } from "./reconcile";

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
export const SAME_VALUE_EPS = 1e-9;

/**
 * Claims created at or after this instant are LINE-ID ERA: disputeFromPack
 * stored each claimed line's real id (bdef1ea). On such a claim a row whose
 * lineId reads null can only be a line deleted since (the FK is ON DELETE SET
 * NULL) — never a legacy row — so it is resolved to nothing and never handed
 * to the (entry, code, flag, paid) heuristic, WHATEVER the claim's other rows
 * hold. Before this, id-era was inferred per row-set ("does any row carry an
 * id?"), which a claim whose every claimed line was deleted fails: all rows
 * read null, the claim looked legacy, and the heuristic armed a never-claimed
 * same-code, same-flag twin (a pending one, whose null paid read as the
 * frozen 0) — the deleted line's recovery written onto a line nobody claimed.
 *
 * Deliberately set BEFORE the deploy that started storing ids. A claim created
 * in the gap, by the old code, stored all-null ids; read as id-era it resolves
 * every row to nothing — its recovery is reported unmapped and the tech types
 * it in. That is the safe direction: the other error (an id-era claim read as
 * legacy) is exactly the wrong-line write above. A cutoff set AFTER the deploy
 * would open that hole for every claim raised in between.
 *
 * Imports: an imported claim keeps its original created_at (import-remap
 * carries it), and its line ids are remapped onto the imported lines. An
 * id-era claim whose lines didn't come with it imports with null ids — read
 * as deleted, so unmapped. Safe, for the same reason.
 *
 * Compared against Dispute.createdAt, the disputes row's insert time. Today
 * generated_at and created_at are both column defaults set by the same insert
 * (createDispute passes neither), so they agree; created_at is the one that
 * MEANS "when this row, and the ids disputeFromPack put in it, were written".
 * generated_at is the claim's display/order date and could reasonably come to
 * carry a pack's generation time from elsewhere, which says nothing about which
 * code stored the lines.
 */
export const LINE_ID_ERA_START = "2026-09-27T20:00:00Z";

/**
 * Was this claim raised by code that stores line ids? See LINE_ID_ERA_START.
 * An unreadable timestamp answers yes — the no-heuristic, no-guess direction.
 */
export function isLineIdEraClaim(dispute: Pick<Dispute, "createdAt">): boolean {
  const at = Date.parse(dispute.createdAt);
  if (Number.isNaN(at)) return true;
  return at >= Date.parse(LINE_ID_ERA_START);
}

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

/** Sum of the per-line asks. The lines' side of the header cross-check. */
export function sumLineClaims(lines: DisputeLine[]): number {
  return lines.reduce((s, l) => s + l.claimedHours, 0);
}

/**
 * The claim total every outcome DECISION is judged against.
 *
 * An itemized claim stores its ask twice: the header (claimedHours) and the
 * per-line asks. App-made claims agree to float noise — the header is
 * pack.totalShortHours, the same reduce over the same deltas (dispute-pack.ts)
 * — but a hand-edited or corrupt backup can make them disagree, and then the
 * label (which read the header) and the Apply gate in
 * pendingRecoveryApplication (which re-sums the lines, because the lines' asks
 * are what it writes) answered "was this paid in full?" about two different
 * numbers. The lines win whenever there are lines, so both read the same one.
 *
 * The header is used when:
 *  - there are no lines: a PERIOD-TOTAL claim is lines: [] with a real,
 *    nonzero header, and the header is the only figure it has;
 *  - the lines sum to zero: no line recorded an ask (pendingRecoveryApplication
 *    treats claimedHours 0 as "no recorded ask" too), so the lines carry no
 *    claim total at all. Re-summing there would turn a 4h claim that got
 *    nothing back into a 0h claim — which disputeOutcome calls "full".
 *
 * Display figures (the Claimed tile, lifetime sums) still show the header;
 * this is only for decisions.
 */
export function claimTotal(dispute: Dispute): number {
  if (dispute.lines.length === 0) return dispute.claimedHours;
  const lines = sumLineClaims(dispute.lines);
  return lines > 0 ? lines : dispute.claimedHours;
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
  // claimTotal, not the header: see claimTotal. The label and the Apply gate
  // must judge the same total or "Paid in full" can sit above a card that
  // says the recovery couldn't be placed.
  if (coversClaim(claimTotal(dispute), dispute.recoveredHours)) {
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
    // The live row the pack line was built from. Line ids are stable across RO
    // edits (updateEntry diffs lines, it never re-inserts them), so this is the
    // one identity that survives a flag edit, a recode, or a same-code twin —
    // resolveLiveLines honours it before any heuristic. The FK is ON DELETE SET
    // NULL, so a deleted line reads back null; see resolveLiveLines for why a
    // null row on an id-carrying claim is not handed to the heuristic.
    lineId: l.lineId,
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
  /** The line's flag hours as this claim froze them (periodRecoveryPlan). */
  frozenFlag: number;
};

export type RecoveryApplication = {
  rows: RecoveryApplicationRow[];
  /** Hours across `rows` — what the one tap would write. */
  applyHours: number;
  /**
   * Recovered hours that land on no live line: goodwill above the claim, a
   * deleted or renamed RO line, a line found only by flag hours (edited since
   * the claim, on a claim with no stored line id — see PASS 2 in
   * resolveLiveLines), a claim whose per-line breakdown was never
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
  /**
   * Claim lines that found their live line but were NOT offered, because the
   * live line no longer reads what this claim froze (see the ALREADY APPLIED
   * guard). These hours are neither in `rows` nor in `unmappedHours`.
   *
   * On its own that is the normal "already applied" state and says nothing to
   * the tech. It matters across ROUNDS: two closed claims on one period can
   * name the same live line with the same frozen paid hours, and once either
   * one's recovery lands, the other is disarmed for good. A per-round hours
   * total cannot tell that apart from the round's own apply (with equal
   * amounts the numbers are identical), so this carries the live line id —
   * periodRecoveryPlan joins rounds on it. `looksApplied` is true when the live
   * value is exactly frozen + this row's hours, i.e. consistent with THIS
   * claim's own apply having landed.
   */
  moved: MovedRecoveryLine[];
};

export type MovedRecoveryLine = {
  lineId: string;
  roNumber: string;
  code: string;
  /** This claim's recovery for the line. */
  hours: number;
  /** What this claim froze as the line's paid hours (null read as 0). */
  frozenPaid: number;
  /** The live line's flag and paid hours now (paid null read as 0). */
  flagNow: number;
  paidNow: number;
  /** The live paid hours as stored: null = pending. */
  livePaid: number | null;
  /** The line's flag hours as this claim froze them. */
  frozenFlag: number;
  looksApplied: boolean;
};

const EMPTY_APPLICATION: RecoveryApplication = {
  rows: [],
  applyHours: 0,
  unmappedHours: 0,
  needsLineBreakdown: false,
  moved: [],
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
  // The raw line re-sum, deliberately NOT claimTotal(): for a period-total
  // claim (no lines) this must stay 0 so fullSettlement cannot fire on a claim
  // with nothing to write. Where lines exist and sum above zero it is the same
  // number the label uses (claimTotal), so the two cannot disagree.
  const claimed = sumLineClaims(dispute.lines);
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
  const moved: MovedRecoveryLine[] = [];
  const hoursFor = (dl: DisputeLine) =>
    usePerLine
      ? dl.recoveredHours
      : singleLineRecovery
        ? dl.claimedHours > 0
          ? Math.min(dispute.recoveredHours, dl.claimedHours)
          : dispute.recoveredHours
        : dl.claimedHours;
  // Every claim row's live line, resolved together. One live line is claimable
  // once — two dispute rows for the same RO and code (the shop's own duplicate,
  // or a re-claim) can never both land on it — and a row can't take another
  // row's exact line. See resolveLiveLines.
  const resolved = resolveLiveLines(
    dispute.lines,
    hoursFor,
    entries,
    libraryById,
    isLineIdEraClaim(dispute),
  );

  for (const [k, dl] of dispute.lines.entries()) {
    const hours = hoursFor(dl);
    if (hours <= 0) continue;

    const live = resolved[k];
    if (!live) continue;

    // Already applied, but another row of this claim reads the same way off
    // the same line — see SETTLED in resolveLiveLines. Its hours found their
    // line (they are not goodwill), and it must never write again.
    if (live === SETTLED) {
      matchedRecovery += hours;
      continue;
    }
    // A report-only pass-2 pick that still reads the frozen figure: the app
    // does not know this is the claimed line, so the hours stay unmapped and
    // the card says so. (One whose paid hours moved is reported below.)
    if (live.reportOnly && sameAsClaimTime(live.line.paidHours ?? null, dl.paidHours)) {
      continue;
    }

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
    //
    // An UNTRUSTED pairing (resolveLiveLines' twin-cluster rule) is treated as
    // moved even when the numbers line up: the line it found may be a twin
    // that another round's write happened to land on this claim's frozen
    // figure. Skipping is the safe direction, as above.
    if (!live.trusted || !sameAsClaimTime(paidNow, dl.paidHours)) {
      moved.push({
        lineId: live.line.id,
        roNumber: live.entry.roNumber,
        code: lineCode(live.line, libraryById),
        hours,
        frozenPaid: dl.paidHours ?? 0,
        flagNow: live.line.flagHours,
        paidNow: paidNow ?? 0,
        livePaid: paidNow,
        frozenFlag: dl.flaggedHours,
        looksApplied: sameAsClaimTime(paidNow, (dl.paidHours ?? 0) + hours),
      });
      continue;
    }

    rows.push({
      lineId: live.line.id,
      entryId: live.entry.id,
      roNumber: live.entry.roNumber,
      code: lineCode(live.line, libraryById),
      flaggedHours: live.line.flagHours,
      paidNow,
      recoveredHours: hours,
      paidAfter,
      frozenFlag: dl.flaggedHours,
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
    moved,
  };
}

export type RoundRecovery = {
  dispute: Dispute;
  plan: RecoveryApplication;
};

/** One live line where another round's write may have stranded recovery. */
export type DisarmedLine = {
  lineId: string;
  roNumber: string;
  code: string;
  /** Hours that may still be missing from this line — see disarmedHours. */
  hours: number;
};

export type PeriodRecovery = {
  /** Every closed round on the period, in the order given (newest first). */
  rounds: RoundRecovery[];
  /**
   * The ONE round whose Apply is offered: the newest with anything to apply.
   * Never more than one. setLinePaidHours is an absolute SET, so two applies
   * for rounds that share a line, in flight together, could both read the line
   * before either write lands, both pass the frozen-vs-live guard, and both
   * write — the second SET silently replacing the first. One button at a time
   * means the next round is only evaluated against the line AFTER the previous
   * write, where the guard disarms it.
   */
  applyRound: RoundRecovery | null;
  /**
   * Recovered hours that FRT can no longer apply because ANOTHER round moved
   * the line, AND that the line is still short enough to be missing. Sum of
   * `disarmedLines`. This is a "go and check" figure, never an "add this" one
   * — see below.
   *
   * Only lines claimed by two or more closed rounds count. A line claimed by
   * ONE round that has moved is that round's own apply, or the tech typing
   * the paid hours in by hand; either way they did it and nothing is stranded.
   *
   * On a shared line, a moved round's hours are NOT counted when:
   *  - they look like the write that moved it: the newest moved round whose
   *    frozen value + hours equals the live value;
   *  - they had already landed before a newer round was raised: a newer round
   *    froze the line at or above this round's frozen value + hours, so this
   *    round's money was on the line when that claim was made.
   * What is left is capped, per line, at what the line is actually still
   * short — flag − paid now, less the largest recovery another round still has
   * ARMED on the line (that one is on screen as an Apply and will close the
   * gap itself). A line paid to flag strands nothing, whatever the rounds say.
   *
   * "Flag" there is the LOWEST of the live flag and every round's FROZEN flag
   * on the line: the claims were about the flag they froze, so raising the
   * flag afterwards (3 -> 4 on a line both rounds froze at 3 and the newer
   * paid up to 3) must not conjure an hour of "possibly missing" recovery that
   * no claim ever asked for. And a line counts only while it reads SHORT by the
   * app's own rule (payStatus: more than 3 minutes under flag, not pending),
   * and only for a figure above that same 3-minute boundary — paid 4.99 or
   * 4.96 on a 5.0 flag reads PAID on the card, so the note may not call it
   * "up to <0.1h" missing.
   *
   * A line the offered Apply (applyRound) is about to write is left out: the
   * figure would describe the line before that write, beside a button that
   * changes it. It is recomputed on the next render, after the write.
   *
   * WHY "CHECK", NOT "ADD". Two rounds that froze a line at the same value
   * asked for the SAME shortage: the second pack re-claimed what the first
   * already asked for. Whether the shop's two answers are separate payments or
   * the second restates the first is a fact on the tech's pay stub, not in the
   * data. The cap removes every reading that would push the line past flag;
   * within it the figure is "possibly missing", and the card words it that way.
   */
  disarmedHours: number;
  disarmedLines: DisarmedLine[];
};

/**
 * Recovery across every closed claim round on one period.
 *
 * pendingRecoveryApplication answers for ONE claim. The card used to ask it
 * about the newest closed round only, so closing a second round hid the first
 * round's still-unapplied Apply forever. This walks every round, offers the
 * newest round that has something to apply, and reports what one round's
 * write may have stranded in another.
 *
 * `closedRounds` must be the period's closed disputes, newest first — the
 * order listDisputes returns (generated_at DESC).
 */
export function periodRecoveryPlan(
  closedRounds: Dispute[],
  entries: Entry[],
  library: OpCode[],
): PeriodRecovery {
  const rounds = closedRounds.map((dispute) => ({
    dispute,
    plan: pendingRecoveryApplication(dispute, entries, library),
  }));
  const applyRound = rounds.find((r) => r.plan.rows.length > 0) ?? null;

  type Claim = {
    /** Index into `rounds`: lower is newer. */
    round: number;
    hours: number;
    frozen: number;
    frozenFlag: number;
    moved: boolean;
    looksApplied: boolean;
  };
  type LineFacts = {
    roNumber: string;
    code: string;
    flagNow: number;
    paidNow: number;
    livePaid: number | null;
    claims: Claim[];
  };
  const byLine = new Map<string, LineFacts>();
  const note = (
    lineId: string,
    facts: Omit<LineFacts, "claims">,
    claim: Claim,
  ) => {
    const f = byLine.get(lineId) ?? { ...facts, claims: [] };
    f.claims.push(claim);
    byLine.set(lineId, f);
  };
  rounds.forEach((r, round) => {
    for (const row of r.plan.rows) {
      // An armed row reads exactly what its claim froze, so paidNow IS the
      // frozen value.
      const paidNow = row.paidNow ?? 0;
      note(
        row.lineId,
        { roNumber: row.roNumber, code: row.code, flagNow: row.flaggedHours, paidNow, livePaid: row.paidNow },
        { round, hours: row.recoveredHours, frozen: paidNow, frozenFlag: row.frozenFlag, moved: false, looksApplied: false },
      );
    }
    for (const m of r.plan.moved) {
      note(
        m.lineId,
        { roNumber: m.roNumber, code: m.code, flagNow: m.flagNow, paidNow: m.paidNow, livePaid: m.livePaid },
        { round, hours: m.hours, frozen: m.frozenPaid, frozenFlag: m.frozenFlag, moved: true, looksApplied: m.looksApplied },
      );
    }
  });

  // Lines the one offered Apply is about to write — see disarmedHours.
  const offered = new Set(applyRound?.plan.rows.map((r) => r.lineId) ?? []);

  const disarmedLines: DisarmedLine[] = [];
  for (const [lineId, f] of byLine) {
    const movedClaims = f.claims.filter((c) => c.moved);
    if (movedClaims.length === 0) continue;
    if (new Set(f.claims.map((c) => c.round)).size < 2) continue;
    if (offered.has(lineId)) continue;
    // The flag the claims were about — never a later, higher edit of it.
    const flag = Math.min(f.flagNow, ...f.claims.map((c) => c.frozenFlag));
    // Short by the card's own rule, or nothing is possibly missing from it.
    if (payStatus(flag, f.livePaid) !== "short") continue;

    // The newest moved round consistent with its own write having landed.
    const landed = movedClaims
      .filter((c) => c.looksApplied)
      .sort((a, b) => a.round - b.round)[0];
    // Already on the line before a newer round froze it.
    const landedBefore = (c: Claim) =>
      f.claims.some(
        (s) => s.round < c.round && s.frozen >= c.frozen + c.hours - SAME_VALUE_EPS,
      );
    const raw = movedClaims
      .filter((c) => c !== landed && !landedBefore(c))
      .reduce((s, c) => s + c.hours, 0);
    if (raw <= SAME_VALUE_EPS) continue;

    const armedMax = f.claims
      .filter((c) => !c.moved)
      .reduce((m, c) => Math.max(m, c.hours), 0);
    const stillShort = Math.max(0, flag - f.paidNow - armedMax);
    const hours = Math.min(raw, stillShort);
    // 3 minutes or less is rounding everywhere else on the card.
    if (!exceedsRounding(hours)) continue;
    disarmedLines.push({ lineId, roNumber: f.roNumber, code: f.code, hours });
  }

  return {
    rounds,
    applyRound,
    disarmedHours: disarmedLines.reduce((s, l) => s + l.hours, 0),
    disarmedLines,
  };
}

/**
 * Does the live line still read exactly what the claim froze?
 *
 * null degrades to 0 FOR THIS COMPARISON ONLY. Everywhere else in the app
 * "pending, never reconciled" and "reconciled at zero" are deliberately
 * different facts, but the only question here is "has this money landed on the
 * line yet?", and both answer no. That is why this APPLY GUARD treats a line
 * pending at claim time and since reconciled at zero as unmoved. Note it does
 * not decide which line a row RESOLVES to: on a claim without stored line ids,
 * matchRows' `samePaidEvidence` keeps null and 0 distinct (2026-09-27), so such
 * a row resolves to nothing and its hours show as unmapped instead of offered.
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
 * resolveLiveLines' answer for a row that is ALREADY APPLIED but shares that
 * evidence with another row: its hours are accounted for (not unmapped), it is
 * never offered, and it names no line of its own (it would only duplicate the
 * line the other row holds). See SETTLED in resolveLiveLines.
 */
const SETTLED = "settled" as const;

type LiveMatch = {
  entry: Entry;
  line: EntryOpCode;
  /**
   * False when the pairing is too ambiguous to WRITE through, even though the
   * line's paid hours happen to equal what the claim froze. See the twin rule
   * in resolveLiveLines. An untrusted pairing still reserves its line (so no
   * other claim row can take it) and is reported like a moved line — never
   * offered.
   */
  trusted: boolean;
  /**
   * A pass-2 pick: found by flag hours alone, never written. Reported in
   * `moved` when its paid hours have moved; left unmapped when they have not
   * (see PASS 2 in resolveLiveLines).
   */
  reportOnly?: boolean;
};

/** Is this literally the same hours figure? Float noise only, never rounding. */
function sameHours(a: number, b: number): boolean {
  return Math.abs(a - b) <= SAME_VALUE_EPS;
}

/**
 * The live line each frozen claim row points at — resolved for the WHOLE claim
 * at once, aligned by index with `lines`.
 *
 * Claims raised since 2026-09-27 store the live line id (disputeFromPack), and
 * that id is the answer — PASS 0. Everything after pass 0 is the heuristic for
 * rows that have none: claims raised before then (stored `lineId: null`, joined
 * by (entryId, code) against the live entry), and imported rows whose line
 * wasn't in the backup.
 *
 * WHY ALL ROWS TOGETHER. This used to be a per-row lookup (first match, later
 * closest match, by flag hours within rounding), and a line was reserved only
 * once it was OFFERED. So one claim row could pick another row's exact line:
 * row 1 frozen 1.00 (its line since bumped to 1.04), row 2 frozen 1.02 on a
 * line still at 1.02 — row 1 took row 2's line as "closer", failed the paid
 * guard there without reserving it, and row 2 then took the same line. One row
 * applied, the other silently lost. Every pick now reserves its line.
 *
 * THE PROPERTY THAT SHAPES EVERYTHING BELOW: the pairing must be the same
 * before and after this claim's own write. The write changes paid hours, so any
 * rule that reads paid hours can re-pair a row after it has been paid — onto a
 * line that now happens to read the frozen figure — and offer the same money
 * again. (A grid over two rows and two lines found exactly that in the first
 * draft of this function.)
 *
 * PASS 0 — stored lineId: authoritative, resolved first so no heuristic row can
 * take it. A duplicate stored id resolves once (as before). It wins whatever the
 * line reads now — a recoded or flag-edited line IS still that line — and a
 * stored id that is not among the live lines (its RO moved out of the period)
 * resolves to nothing rather than to a guess.
 *
 * A DELETED line reads back as a null lineId (the FK is ON DELETE SET NULL), so
 * a null row on a claim whose OTHER rows carry ids is a deleted line, not a
 * legacy row: it resolves to nothing and is never handed to the heuristic,
 * which would go looking for a stand-in (typically the next same-code line on
 * the RO) and write the deleted line's money onto it. A claim whose every
 * claimed line was deleted is all-null, so "do other rows carry ids?" cannot
 * tell it from a legacy claim — that is decided by the claim's creation time
 * instead (LINE_ID_ERA_START): an id-era claim never reaches the heuristic,
 * however many of its rows read null.
 *
 * PASS 1 — identity, per (entry, code) group, as a small maximum matching over
 * two kinds of evidence:
 *  - ARMED: flag hours EXACTLY the frozen flag hours, paid hours exactly what
 *    the claim froze — the row's line, unapplied;
 *  - APPLIED: flag hours within rounding of the frozen flag hours, paid hours
 *    exactly frozen + this row's recovery — the row's line after this claim's
 *    own apply. Within rounding, not exact: a line may have been written by
 *    the old pass 2 (see below) onto a flag since edited, or had its flag
 *    nudged after the apply, and the write must still be recognised as its
 *    own — reading it as unapplied is how money gets written twice.
 * Scored: most rows matched, then FEWEST armed pairings (the no-write reading
 * wins every tie), then the first assignment in row order. So whenever every
 * row has its own exact line, every row gets it, whatever order the lines come
 * back in; and a written line, now reading frozen + recovery, stays with the
 * row that wrote it rather than arming another row.
 *
 * TWIN RULE: when two or more lines share a flag figure, paid hours are the only
 * thing telling them apart, and paid hours are exactly what other claim rounds'
 * applies and hand edits move. If a row frozen at that figure finds no pass-1
 * match WHILE a twin at that figure is left unclaimed, the twins have moved in
 * a way this claim does not explain, and every armed pairing on those twins is
 * marked untrusted — reserved, reported as moved, never written. (Otherwise: round 2's apply lands twin B on exactly what
 * round 1 froze for twin A, and round 1 re-arms onto B.)
 *
 * SETTLED — a row left unmatched by pass 1 that has APPLIED evidence on a line
 * another row took. In a full settlement every row's frozen paid + recovery is
 * its flag, so after one tap two same-flag rows read identically off the same
 * line: when one of their lines is later deleted or recoded, both rows' only
 * evidence is the survivor, one row wins it, and the loser used to fall to
 * the old pass 2 and wrote its money a SECOND time onto whatever same-code
 * line was left (a 0.3h pending line written to 1.0: 2.5h out of 1.5h
 * recovered). A row whose recovery visibly reads as landed is done: it
 * resolves as settled — counted as matched (not unmapped: the money found its
 * line), never offered, and never reported as moved (it would only duplicate
 * the line the other row holds).
 *
 * PASS 2 — REPORT-ONLY. Rows pass 1 leaves unmatched (and not settled) take
 * the CLOSEST remaining same-code line by flag hours within the 3-minute
 * boundary (exceedsRounding), ties in row order, and NOTHING outside it (the
 * old "else the first remaining same-code line" fallback is gone). A pass-2
 * pick is never written. It exists so a line whose paid hours have moved is
 * still reported in `moved` (periodRecoveryPlan joins rounds on it); a pick
 * that still reads the frozen paid figure is left unmapped instead, so the
 * card says the hours were not placed rather than going silent.
 *
 * Why it no longer writes: without a stored line id, "this line's flag was
 * nudged after the claim" and "that line is gone and this is its same-code
 * neighbour" look identical, and pass 2 wrote the recovery onto the neighbour
 * either way — a 1.0h recovery onto a 0.3h pending line (the first-remaining
 * fallback) and, within rounding, a second write of a recovery that had
 * already landed on a line deleted since. An apply-until-quiet simulator (40k
 * claims: flag nudges, typed paid hours, lines added/deleted/recoded, 1-3
 * same-code lines, three recovery modes, two rounds) measured pass-2 writes as
 * about half of all wrong-line writes and over-recovered rounds on id-less
 * claims, and EVERY wrong-line write on id-carrying ones (pass 2 only runs
 * there once every claimed line is deleted, so it can only pick a line the
 * claim did not name). Skipping is the safe direction: a lost apply is a
 * visible unmapped figure the tech types in; a wrong one is hours nobody
 * earned, in the ledger that is supposed to prove pay. New claims carry line
 * ids (pass 0), so the cost falls only on pre-id claims whose line's flag was
 * edited after the claim.
 *
 * Flag-only, deliberately NOT paid-first, for the reason it always was: flag
 * hours are the one thing an apply never changes, so the pick is the same line
 * before and after any write. Rows with nothing to write (hours <= 0) take part
 * in pass 1 — they reserve their exact line — but not in pass 2.
 */
function resolveLiveLines(
  lines: DisputeLine[],
  hoursFor: (dl: DisputeLine) => number,
  entries: Entry[],
  libraryById: Map<string, OpCode>,
  idEra: boolean,
): (LiveMatch | typeof SETTLED | null)[] {
  const out: (LiveMatch | typeof SETTLED | null)[] = lines.map(() => null);
  const taken = new Set<string>();
  // A claim raised with ids (by its creation time — LINE_ID_ERA_START — or, as
  // a belt for anything older that somehow carries one, by any stored id): a
  // null row on it is a line deleted since (FK SET NULL), never a legacy row.
  // The creation time is what covers the all-deleted claim, whose rows are
  // all null and so carry no id to infer from — see PASS 0.
  const claimHasIds = idEra || lines.some((dl) => dl.lineId);

  // PASS 0 — stored line ids.
  lines.forEach((dl, i) => {
    if (!dl.lineId) return;
    for (const entry of entries) {
      const line = entry.opCodes.find((l) => l.id === dl.lineId);
      if (line && !taken.has(line.id)) {
        taken.add(line.id);
        out[i] = { entry, line, trusted: true };
        return;
      }
    }
  });

  // The rest, grouped by the live entry they point at and their code.
  type Row = { i: number; dl: DisputeLine; hours: number };
  const groups = new Map<string, { entry: Entry; rows: Row[] }>();
  lines.forEach((dl, i) => {
    if (dl.lineId || claimHasIds) return;
    const entry =
      entries.find((e) => e.id === dl.entryId) ??
      entries.find((e) => e.roNumber === dl.roNumber) ??
      null;
    if (!entry) return;
    const key = JSON.stringify([entry.id, dl.code]);
    const g = groups.get(key) ?? { entry, rows: [] };
    g.rows.push({ i, dl, hours: hoursFor(dl) });
    groups.set(key, g);
  });

  for (const { entry, rows } of groups.values()) {
    const code = rows[0].dl.code;
    const candidates = entry.opCodes.filter(
      (l) => !taken.has(l.id) && lineCode(l, libraryById) === code,
    );
    if (candidates.length === 0) continue;
    const used = new Set<string>();

    // PASS 1 — identity.
    const pairs = matchRows(rows, candidates);
    pairs.forEach((p, k) => {
      if (!p) return;
      used.add(p.line.id);
      out[rows[k].i] = { entry, line: p.line, trusted: true };
    });
    // TWIN RULE — only armed pairings can lead to a write, so only they are
    // ever demoted. "Unexplained" needs both halves: a row frozen at the twin
    // figure that found no line, AND a twin that no row claimed. A row left
    // over beside fully-claimed twins is just a row whose own line was edited
    // or removed; the twins are all accounted for.
    pairs.forEach((p, k) => {
      if (!p || !p.armed) return;
      const flag = p.line.flagHours;
      const twins = candidates.filter((l) => sameHours(l.flagHours, flag));
      if (twins.length < 2) return;
      const rowLeft = rows.some(
        (r, m) => !pairs[m] && sameHours(r.dl.flaggedHours, flag),
      );
      const twinLeft = twins.some((l) => !used.has(l.id));
      if (rowLeft && twinLeft) (out[rows[k].i] as LiveMatch).trusted = false;
    });

    // SETTLED — unmatched rows whose recovery already reads as applied on a
    // line another row took. Never written.
    rows.forEach((r, k) => {
      if (pairs[k] || r.hours <= 0) return;
      if (candidates.some((l) => appliedEvidence(r, l))) out[r.i] = SETTLED;
    });

    // PASS 2 — report-only; closest flag within rounding. Never written.
    for (const r of rows) {
      if (out[r.i] || r.hours <= 0) continue;
      let pick: EntryOpCode | null = null;
      let bestGap = Infinity;
      for (const l of candidates) {
        if (used.has(l.id)) continue;
        const gap = Math.abs(l.flagHours - r.dl.flaggedHours);
        if (exceedsRounding(gap)) continue;
        if (gap < bestGap) {
          pick = l;
          bestGap = gap;
        }
      }
      if (!pick) continue;
      used.add(pick.id);
      out[r.i] = { entry, line: pick, trusted: false, reportOnly: true };
    }

    for (const id of used) taken.add(id);
  }

  return out;
}

type RowEdge = { j: number; armed: boolean };
type RowPair = { line: EntryOpCode; armed: boolean } | null;

/**
 * Pass 1 of resolveLiveLines for one (entry, code) group: pair rows with lines
 * on ARMED evidence (exact flag, paid = frozen) or APPLIED evidence (flag within
 * rounding, paid = frozen + recovery). See resolveLiveLines for why the two
 * differ in their flag test.
 *
 * Exhaustive — a group is one op code on ONE RO, so it is tiny — scored: most
 * rows matched, then fewest armed pairings, then the first assignment in row
 * order (rows in order, lines in order). Above a search budget (a pathological
 * group) it falls back to a greedy pass in row order that prefers applied
 * evidence.
 */
/**
 * APPLIED evidence: the line reads as this row's own write having landed —
 * flag within rounding of the frozen flag, paid exactly frozen + recovery.
 */
function appliedEvidence(
  r: { dl: DisputeLine; hours: number },
  line: EntryOpCode,
): boolean {
  return (
    r.hours > 0 &&
    !exceedsRounding(Math.abs(line.flagHours - r.dl.flaggedHours)) &&
    sameHours(line.paidHours ?? 0, (r.dl.paidHours ?? 0) + r.hours)
  );
}

/**
 * ARMED evidence's paid test: the live paid figure IS the frozen one, with
 * pending (null) and reconciled-at-zero (0) kept apart. Deliberately stricter
 * than sameAsClaimTime, which folds null into 0 for the different question
 * "has this money landed on a line we already know is the claimed one?".
 * Here the line is not known yet — this test is part of FINDING it — and
 * folding made a pending same-code, same-flag twin read as a claimed line
 * frozen at paid 0: once the claimed line was deleted, the twin was armed and
 * the recovery written onto a line nobody claimed. Pending-at-claim rows
 * freeze paid null (dispute-pack), so a still-pending claimed line matches
 * itself (null = null). The cost — a pending-at-claim line since reconciled
 * at exactly 0, on a claim with no stored id — is a report-only pass-2 pick,
 * so its hours read unmapped instead of offered: the safe direction.
 */
function samePaidEvidence(
  livePaid: number | null,
  frozenPaid: number | null,
): boolean {
  if ((livePaid === null) !== (frozenPaid === null)) return false;
  return sameHours(livePaid ?? 0, frozenPaid ?? 0);
}

function matchRows(
  rows: { dl: DisputeLine; hours: number }[],
  pool: EntryOpCode[],
): RowPair[] {
  const edges: RowEdge[][] = rows.map((r) =>
    pool.flatMap((line, j): RowEdge[] => {
      if (appliedEvidence(r, line)) return [{ j, armed: false }];
      if (
        sameHours(line.flagHours, r.dl.flaggedHours) &&
        samePaidEvidence(line.paidHours ?? null, r.dl.paidHours)
      ) {
        return [{ j, armed: true }];
      }
      return [];
    }),
  );
  // SHARED APPLIED EVIDENCE. A line that reads as the landed write of two or
  // more rows (in a full settlement, every same-flag row's frozen + recovery
  // IS the flag) says those rows are applied — it cannot say which one it
  // belongs to. None of them may then be ARMED anywhere else: the most-rows
  // score would otherwise pair one row with the shared line and arm the other
  // on any spare line that reads its frozen figure (a pending same-flag line
  // reads every pending row's), writing the same money a second time. Such a
  // row keeps only its applied edges; if it loses the line, resolveLiveLines
  // settles it.
  const appliedRows = pool.map((_, j) =>
    edges.reduce((n, es) => n + (es.some((e) => e.j === j && !e.armed) ? 1 : 0), 0),
  );
  edges.forEach((es, k) => {
    if (es.some((e) => !e.armed && appliedRows[e.j] >= 2)) {
      edges[k] = es.filter((e) => !e.armed);
    }
  });
  const toPair = (e: RowEdge | null): RowPair =>
    e ? { line: pool[e.j], armed: e.armed } : null;

  const budget = edges.reduce((n, e) => n * (e.length + 1), 1);
  if (budget > 20000) {
    const usedJ = new Set<number>();
    return edges.map((es) => {
      const e =
        es.find((x) => !x.armed && !usedJ.has(x.j)) ??
        es.find((x) => !usedJ.has(x.j)) ??
        null;
      if (e) usedJ.add(e.j);
      return toPair(e);
    });
  }

  let best: (RowEdge | null)[] = rows.map(() => null);
  let bestMatched = 0;
  let bestArmed = 0;
  const cur: (RowEdge | null)[] = [];
  const usedJ = new Set<number>();
  const walk = (k: number, matched: number, armed: number): void => {
    if (k === rows.length) {
      // Strict improvements only, so the first assignment found in row order
      // wins every tie.
      if (
        matched > bestMatched ||
        (matched === bestMatched && armed < bestArmed)
      ) {
        best = cur.slice();
        bestMatched = matched;
        bestArmed = armed;
      }
      return;
    }
    for (const e of edges[k]) {
      if (usedJ.has(e.j)) continue;
      usedJ.add(e.j);
      cur.push(e);
      walk(k + 1, matched + 1, armed + (e.armed ? 1 : 0));
      cur.pop();
      usedJ.delete(e.j);
    }
    cur.push(null);
    walk(k + 1, matched, armed);
    cur.pop();
  };
  walk(0, 0, 0);
  return best.map(toPair);
}
