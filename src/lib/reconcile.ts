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
  shortLineCount: number; // lines paid less than flagged
  overCount: number; // lines paid MORE than flagged (still reconciled)
};

export function reconcileEntries(entries: Entry[]): ReconcileSummary {
  const summary: ReconcileSummary = {
    totalFlagged: 0,
    totalPaid: 0,
    shortedHours: 0,
    pendingCount: 0,
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
