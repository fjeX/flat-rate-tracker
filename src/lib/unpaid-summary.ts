// Phase 3 (Surfaces) of the Unpaid Time Engine — the one place that flattens a
// period's unpaid time into renderable rows.
//
// Phases 1 and 2 built the capture (timer slots, comeback marking, the ledger)
// and the totals (Stats.unpaidHours / comebackHours / waitingHours). Nothing
// showed them. This module is what the dashboard card, the pay-period card, the
// Pay Check-Up breakdown, and the dispute pack all read from, so those four
// surfaces cannot drift into reporting different numbers for the same period.
//
// Two sources, and they never overlap (the same rule aggregateStats relies on):
//   - RO-side: entry_op_codes marked isComeback. Their flag hours are ZERO by
//     construction (DB CHECK entry_op_codes_comeback_zero_flag), so the cost of
//     the work is its ACTUAL hours — summing flag would report nothing.
//   - Ledger: unpaid_time rows. Comebacks with no ticket at all, waiting on
//     parts/approval, and shop time. A comeback written as an RO is never also
//     a ledger row.
//
// Money: a line is priced by ITS OWN applicable rate via resolveLineRate, the
// same path the dispute pack prices a shorted line with. Ledger rows carry no
// labor type — there is no line to resolve a rate from — so they stay
// hours-only forever rather than being valued at an assumed rate. `unpricedHours`
// reports exactly how much of the total that is, so a report can say so out loud
// instead of quietly under-totalling.
import type { Entry, OpCode, UnpaidTime, UnpaidTimeKind } from "./types";
import { hasAnyRate, resolveLineRate, type RateMap } from "./earnings";
import { lineCode, lineDescription } from "./line-label";

export type UnpaidLineSource = "ro" | "ledger";

/** One row of unpaid time, flattened with enough context to render directly. */
export type UnpaidLine = {
  source: UnpaidLineSource;
  date: string; // "YYYY-MM-DD"
  kind: UnpaidTimeKind;
  hours: number;
  roNumber: string | null; // RO-side lines, and ledger rows linked to an RO
  entryId: string | null;
  code: string | null; // RO-side only — ledger rows have no op code
  description: string; // op-code description, or the ledger row's note
  dollars: number | null; // null when unpriced — never an assumed rate
};

export type UnpaidSummary = {
  lines: UnpaidLine[];
  /** Rework performed free — RO-side comeback lines AND ledger comeback rows. */
  comebackHours: number;
  /** wait_parts + wait_approval. */
  waitingHours: number;
  /** Meetings, cleanup, dispatch limbo. */
  shopHours: number;
  totalHours: number;
  byKind: Record<UnpaidTimeKind, number>;
  /** Dollar value of the priced rows. null when no rate is priced at all. */
  totalDollars: number | null;
  /** Hours inside `totalHours` that carry no dollar figure. */
  unpricedHours: number;
  hasRates: boolean;
};

const ZERO_BY_KIND: () => Record<UnpaidTimeKind, number> = () => ({
  comeback_own: 0,
  comeback_other: 0,
  rework_same_visit: 0,
  wait_parts: 0,
  wait_approval: 0,
  shop_time: 0,
});

function inRange(date: string, range?: { start: string; end: string }): boolean {
  if (!range) return true;
  return date >= range.start && date <= range.end;
}

export type BuildUnpaidSummaryInput = {
  entries: Entry[];
  unpaid?: UnpaidTime[];
  library?: OpCode[];
  rates?: RateMap;
  // Optional; callers that already scoped their data can omit it. Filtering
  // again here is defensive, mirroring aggregateStats.
  range?: { start: string; end: string };
};

export function buildUnpaidSummary(
  input: BuildUnpaidSummaryInput,
): UnpaidSummary {
  const { entries, unpaid = [], library = [], rates = {}, range } = input;

  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const rated = hasAnyRate(rates);
  const lines: UnpaidLine[] = [];

  for (const entry of entries) {
    if (!inRange(entry.date, range)) continue;
    for (const line of entry.opCodes) {
      if (!line.isComeback) continue;
      // Flag is zero on a comeback line by construction, so the hours spent are
      // the actual hours. A line with no actual time recorded still belongs in
      // the list — the rework happened, its duration just wasn't captured.
      const hours = line.actualHours ?? 0;
      const rate = resolveLineRate(line, rates);
      lines.push({
        source: "ro",
        date: entry.date,
        // A comeback line on an RO whose kind was never set predates the kind
        // selector; treat it as the tech's own work, which is what the RO shape
        // implies (it's on a ticket in their own data).
        kind: entry.comebackKind ?? "comeback_own",
        hours,
        roNumber: entry.roNumber,
        entryId: entry.id,
        code: lineCode(line, libraryById),
        description: lineDescription(line, libraryById),
        dollars: rate === null ? null : rate * hours,
      });
    }
  }

  const entryById = new Map(entries.map((e) => [e.id, e]));
  for (const row of unpaid) {
    if (!inRange(row.date, range)) continue;
    lines.push({
      source: "ledger",
      date: row.date,
      kind: row.kind,
      hours: row.hours,
      roNumber: row.entryId ? (entryById.get(row.entryId)?.roNumber ?? null) : null,
      entryId: row.entryId,
      code: null,
      description: row.note ?? "",
      // No labor type exists on a ledger row, so there is no rate to resolve.
      // Valuing it at some default would be inventing a rate.
      dollars: null,
    });
  }

  // Newest first, matching every other list in the app.
  lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const byKind = ZERO_BY_KIND();
  let comebackHours = 0;
  let waitingHours = 0;
  let shopHours = 0;
  let unpricedHours = 0;
  let pricedDollars = 0;

  for (const l of lines) {
    byKind[l.kind] += l.hours;
    switch (l.kind) {
      case "comeback_own":
      case "comeback_other":
      case "rework_same_visit":
        comebackHours += l.hours;
        break;
      case "wait_parts":
      case "wait_approval":
        waitingHours += l.hours;
        break;
      case "shop_time":
        shopHours += l.hours;
        break;
    }
    if (l.dollars === null) unpricedHours += l.hours;
    else pricedDollars += l.dollars;
  }

  return {
    lines,
    comebackHours,
    waitingHours,
    shopHours,
    totalHours: comebackHours + waitingHours + shopHours,
    byKind,
    totalDollars: rated ? pricedDollars : null,
    unpricedHours,
    hasRates: rated,
  };
}
