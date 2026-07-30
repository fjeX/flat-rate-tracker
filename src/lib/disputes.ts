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
  NewDispute,
  NewDisputeLine,
} from "./types";
import type { DisputePack } from "./dispute-pack";

// Tolerance for calling a claim fully recovered. Matches reconcile.ts PAY_EPS:
// shops round flag hours, so a 0.05h (3 min) gap isn't a real shortfall.
export const RECOVERY_EPS = 0.05;

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
 * What actually happened to one claim.
 *
 * Judged on HOURS, not dollars, because hours are always known and dollars
 * aren't (an unpriced period has null dollars but real hours). A zero-hour claim
 * that somehow got resolved counts as "full" — there was nothing to recover, so
 * it can't be a denial.
 */
export function disputeOutcome(dispute: Dispute): DisputeOutcome {
  if (!isClosed(dispute.status)) return "open";
  // Withdrawn with nothing recovered is a denial in substance: the tech asked
  // and walked away with nothing. Withdrawn AFTER a partial payment still counts
  // as partial — the money arrived.
  if (dispute.recoveredHours <= RECOVERY_EPS) {
    return dispute.claimedHours <= RECOVERY_EPS ? "full" : "denied";
  }
  const remaining = dispute.claimedHours - dispute.recoveredHours;
  return remaining <= RECOVERY_EPS ? "full" : "partial";
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
