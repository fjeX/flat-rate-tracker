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
   * deleted RO, or a claim whose per-line breakdown was never recorded. Stays
   * on the claim only. Reported so the two figures visibly reconcile instead of
   * the tech wondering where 2.6h went.
   */
  unmappedHours: number;
  /**
   * True when the claim recovered hours but nothing could be mapped because no
   * per-line recovery was recorded and the settlement wasn't full. The UI asks
   * for the breakdown rather than guessing at a split.
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
 * left alone: which lines the shop paid is a fact the app does not have.
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
  const fullSettlement =
    !usePerLine && claimed > 0 && dispute.recoveredHours + RECOVERY_EPS >= claimed;

  if (!usePerLine && !fullSettlement) {
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
    const hours = usePerLine ? dl.recoveredHours : dl.claimedHours;
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
    // dl.paidHours is frozen at claim time. If the live line has moved up since
    // then, this money is already on the books — by this tap, or by the tech
    // typing it into Reconciliation afterwards. Skipping a hand-entered
    // adjustment is the safe direction to be wrong in: the worst case is a
    // number the tech already recorded themselves.
    const paidAtClaim = dl.paidHours ?? 0;
    if (paidNow !== null && paidNow > paidAtClaim + RECOVERY_EPS) continue;

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
    unmappedHours: unmapped > RECOVERY_EPS ? unmapped : 0,
    needsLineBreakdown: false,
  };
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
