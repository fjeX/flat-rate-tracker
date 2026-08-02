// Pure pay-reconciliation math. No I/O, no React — everything is a plain
// function of (entries/lines) so it's trivially unit-testable and safe to call
// from Server Components, client components, and tests alike.
//
// The one job here: turn a line's (flag_hours, paid_hours) into a status and
// roll those statuses up across a period. Status is DERIVED, never stored, so it
// can never go stale when a rate changes or an RO is edited.
//
// Dollars are layered on top via the per-labor-type rates in lib/earnings — a
// shorted line's dollar value uses THAT line's applicable rate, not a single
// flat rate (the single-hourly-rate model in the original plan was superseded by
// per-type rates in plan 02).
import type { Entry, EntryOpCode } from "./types";
import { hasAnyRate, resolveLineRate, type RateMap } from "./earnings";

export type PayStatus = "pending" | "paid" | "short" | "over";

// Tolerance for calling a line "paid". Shops round flag hours; a 0.05h (3 min)
// gap isn't a real short. Deliberately DIFFERENT from DiscrepancyCard's 0.1
// period-level tolerance — this is a per-line judgment.
export const PAY_EPS = 0.05;

// Normalize the optional paid_hours field to a concrete value-or-null.
function paidOf(line: Pick<EntryOpCode, "paidHours">): number | null {
  return line.paidHours ?? null;
}

export function payStatus(flag: number, paid: number | null): PayStatus {
  if (paid === null) return "pending";
  const diff = paid - flag;
  // The 1e-9 fudge absorbs float error so an exact-boundary case like
  // flag 1.0 / paid 0.95 (whose raw diff is 0.05000000000000004) still counts
  // as "paid" rather than tipping into "short".
  if (Math.abs(diff) <= PAY_EPS + 1e-9) return "paid";
  return diff < 0 ? "short" : "over";
}

export type ReconcileSummary = {
  totalFlagged: number; // sum of flag hours across all lines
  totalPaid: number; // sum of paid hours (pending/null lines excluded)
  shortedHours: number; // sum of (flag − paid) over lines with status "short"
  pendingCount: number; // lines not yet reconciled
  // Flag hours sitting on those pending lines. NOT part of shortedHours and
  // never to be added to it: "not marked paid" is not the same claim as "paid
  // less than flagged". A tech who logs the period stub but never marks
  // individual lines has a pile of pending hours that were, in fact, paid.
  pendingHours: number;
  shortLineCount: number; // lines paid less than flagged
  overCount: number; // lines paid MORE than flagged (still reconciled)
};

export function reconcileEntries(entries: Entry[]): ReconcileSummary {
  const summary: ReconcileSummary = {
    totalFlagged: 0,
    totalPaid: 0,
    shortedHours: 0,
    pendingCount: 0,
    pendingHours: 0,
    shortLineCount: 0,
    overCount: 0,
  };
  for (const entry of entries) {
    for (const line of entry.opCodes) {
      const paid = paidOf(line);
      summary.totalFlagged += line.flagHours;
      const status = payStatus(line.flagHours, paid);
      if (status !== "pending" && paid !== null) summary.totalPaid += paid;
      switch (status) {
        case "pending":
          summary.pendingCount += 1;
          summary.pendingHours += line.flagHours;
          break;
        case "short":
          summary.shortLineCount += 1;
          summary.shortedHours += line.flagHours - (paid ?? 0);
          break;
        case "over":
          summary.overCount += 1;
          break;
      }
    }
  }
  return summary;
}

// One line that still needs attention (pending or short), with enough context
// for the reconciliation UI to render a row without re-deriving anything.
export type UnreconciledLine = {
  entry: Entry;
  line: EntryOpCode;
  status: Extract<PayStatus, "pending" | "short">;
};

// Every pending/short line across the given entries, in entry-then-position
// order. "over" and "paid" lines are done — they drop off the list (but still
// count in reconcileEntries, so the totals stay honest).
export function unreconciledLines(entries: Entry[]): UnreconciledLine[] {
  const out: UnreconciledLine[] = [];
  for (const entry of entries) {
    for (const line of entry.opCodes) {
      const status = payStatus(line.flagHours, paidOf(line));
      if (status === "pending" || status === "short") {
        out.push({ entry, line, status });
      }
    }
  }
  return out;
}

// How the reconciliation list is ordered while the tech works through it.
//
// "ro" is the default and the reason this exists: shops hand out a printed
// sheet of ROs and flagged lines in RO-number order. Reading down that sheet
// while the app lists rows newest-date-first means hunting for every line.
export type ReconcileSort = "ro" | "date" | "shortfall";

// Leading digits of an RO number, for numeric ordering. RO numbers are strings
// and can carry prefixes/suffixes; NaN sorts last so odd formats don't jump the
// queue. NOTE: RO numbers are NOT unique — this shop recycles 5-digit numbers —
// so ties always fall through to date and line position.
function roSortKey(roNumber: string): number {
  const digits = roNumber.match(/\d+/);
  return digits ? Number(digits[0]) : Number.NaN;
}

function compareNumbers(a: number, b: number): number {
  const aBad = !Number.isFinite(a);
  const bBad = !Number.isFinite(b);
  if (aBad && bBad) return 0;
  if (aBad) return 1; // unparseable RO numbers sort last
  if (bBad) return -1;
  return a - b;
}

/**
 * Order unreconciled rows for display. Pure and total — returns a new array and
 * never mutates the input.
 *
 * Every comparator ends on the same tiebreak chain (date, then RO number string,
 * then line position) so the order is stable and deterministic: re-sorting after
 * marking a line paid can't shuffle the rows around the tech's place on the page.
 */
export function sortUnreconciledLines(
  rows: UnreconciledLine[],
  sort: ReconcileSort = "ro",
): UnreconciledLine[] {
  const tiebreak = (a: UnreconciledLine, b: UnreconciledLine): number =>
    a.entry.date.localeCompare(b.entry.date) ||
    a.entry.roNumber.localeCompare(b.entry.roNumber) ||
    a.line.position - b.line.position;

  return [...rows].sort((a, b) => {
    if (sort === "ro") {
      return (
        compareNumbers(roSortKey(a.entry.roNumber), roSortKey(b.entry.roNumber)) ||
        tiebreak(a, b)
      );
    }
    if (sort === "date") {
      // Newest first — the app's usual convention everywhere else.
      return b.entry.date.localeCompare(a.entry.date) || tiebreak(a, b);
    }
    // Biggest gap first, so the money is at the top. A pending line has no
    // known shortfall yet, so it counts as 0 and sinks below real shorts.
    const gap = (r: UnreconciledLine) =>
      r.status === "short" ? r.line.flagHours - (r.line.paidHours ?? 0) : 0;
    return gap(b) - gap(a) || tiebreak(a, b);
  });
}

// Total dollars left on the table across every shorted line, pricing each line
// by its OWN labor-type rate. null when no rates are priced at all (so the UI
// hides dollars entirely and shows hours only). Shorted lines whose specific
// type is unpriced contribute 0 — the hours figure still tells the story.
export function shortfallDollars(
  entries: Entry[],
  rates: RateMap,
): number | null {
  if (!hasAnyRate(rates)) return null;
  let total = 0;
  for (const entry of entries) {
    for (const line of entry.opCodes) {
      if (payStatus(line.flagHours, paidOf(line)) !== "short") continue;
      const rate = resolveLineRate(line, rates);
      if (rate === null) continue;
      total += (line.flagHours - (line.paidHours ?? 0)) * rate;
    }
  }
  return total;
}
