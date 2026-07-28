// Pure dispute-pack generator. No I/O, no React — everything is a plain
// function of (entries/lines) × (rate map) × options, so it's trivially
// unit-testable and safe to call from Server Components, client components,
// and tests alike.
//
// Pay reconciliation (lib/reconcile) DETECTS shorted lines. The dispute pack
// COLLECTS them into a clean, external-facing summary a tech can hand to a
// service manager or payroll. Tone is deliberately neutral — "Flagged vs. paid
// variance", never accusatory. See references/frt-improvement-plans/01.
//
// Dollars are layered on via the per-labor-type rates in lib/earnings: a
// disputed line is priced by ITS OWN applicable rate, and the whole feature
// degrades to hours-only when no rates are set.
import type { Entry, OpCode, UnpaidTime } from "./types";
import {
  hasAnyRate,
  resolveLineRate,
  type RateMap,
} from "./earnings";
import { lineCode, lineDescription } from "./line-label";
import { payStatus } from "./reconcile";
import { buildUnpaidSummary, type UnpaidSummary } from "./unpaid-summary";

// One disputed line, flattened with enough context to render a report row
// without re-deriving anything.
export type DisputePackLine = {
  entryId: string;
  roNumber: string;
  date: string; // "YYYY-MM-DD"
  code: string; // library op code, sub-op variant, or custom code
  description: string;
  status: "short" | "pending";
  flagged: number;
  paid: number | null; // null for pending lines (not yet reconciled)
  deltaHours: number; // outstanding hours (flagged − paid; flagged when pending)
  deltaDollars: number | null; // null when the line's rate is unpriced
};

export type DisputePack = {
  periodLabel: string;
  techName: string | null;
  generatedDate: string; // human-readable, caller-formatted
  lines: DisputePackLine[];
  totalShortHours: number; // sum of deltaHours across all included lines
  totalShortDollars: number | null; // null when no rates priced at all
  hasRates: boolean;
  disputedRoCount: number; // distinct ROs represented in the pack
  photosAvailable: number; // of those ROs, how many have a photo record
  // Unpaid rework and non-productive time for the same period, reported as its
  // OWN section with its own totals — it is a different claim from a flagged-vs-
  // paid variance and must never be added into the variance total. null when the
  // period has none (or the caller passed no ledger), so the section disappears
  // instead of printing a row of zeros.
  unpaidRework: UnpaidSummary | null;
};

export type BuildDisputePackInput = {
  entries: Entry[];
  periodLabel: string;
  library?: OpCode[];
  rates?: RateMap;
  // Include pending (not-yet-reconciled) lines. Only meaningful once the period
  // has ended — a pending line mid-period isn't a dispute yet. When periodEnd
  // and today are both provided, pending lines are only included if today has
  // passed periodEnd.
  includePending?: boolean;
  periodEnd?: string; // "YYYY-MM-DD" — the period's last day
  today?: string; // "YYYY-MM-DD" — used to gate pending inclusion
  techName?: string | null;
  generatedDate?: string;
  // Entry ids that have at least one photo on file — powers the evidence
  // footer ("Photo record available for N of M disputed ROs").
  entryIdsWithPhotos?: Set<string>;
  // Unpaid-time ledger rows for the period. Optional: callers that predate the
  // Phase 2 migration (or the in-app clipboard export) simply get no section.
  unpaid?: UnpaidTime[];
};

// Line labelling lives in lib/line-label so this report and the unpaid-rework
// summary name the same line identically.

// Build the structured dispute pack. Pure — no I/O.
export function buildDisputePack(input: BuildDisputePackInput): DisputePack {
  const {
    entries,
    periodLabel,
    library = [],
    rates = {},
    includePending = false,
    periodEnd,
    today,
    techName = null,
    generatedDate = "",
    entryIdsWithPhotos,
    unpaid = [],
  } = input;

  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const rated = hasAnyRate(rates);

  // Pending lines only become disputes once the period is over. If we can't
  // tell (no dates), fall back to honoring the toggle as-is.
  const periodEnded =
    periodEnd === undefined || today === undefined ? true : today > periodEnd;
  const wantPending = includePending && periodEnded;

  const lines: DisputePackLine[] = [];
  for (const entry of entries) {
    for (const line of entry.opCodes) {
      const paid = line.paidHours ?? null;
      const status = payStatus(line.flagHours, paid);
      const include =
        status === "short" || (status === "pending" && wantPending);
      if (!include) continue;

      // Outstanding hours: short → flag − paid; pending → the whole flag is
      // still unpaid, so the outstanding amount is the full flag.
      const deltaHours = line.flagHours - (paid ?? 0);
      const rate = resolveLineRate(line, rates);
      const deltaDollars = rate === null ? null : deltaHours * rate;

      lines.push({
        entryId: entry.id,
        roNumber: entry.roNumber,
        date: entry.date,
        code: lineCode(line, libraryById),
        description: lineDescription(line, libraryById),
        status: status === "short" ? "short" : "pending",
        flagged: line.flagHours,
        paid,
        deltaHours,
        deltaDollars,
      });
    }
  }

  const totalShortHours = lines.reduce((s, l) => s + l.deltaHours, 0);
  const totalShortDollars = rated
    ? lines.reduce((s, l) => s + (l.deltaDollars ?? 0), 0)
    : null;

  // Distinct disputed ROs, and how many have a photo record on file.
  const disputedEntryIds = new Set(lines.map((l) => l.entryId));
  const photosAvailable = entryIdsWithPhotos
    ? [...disputedEntryIds].filter((id) => entryIdsWithPhotos.has(id)).length
    : 0;

  // Unpaid rework is built from the SAME entries this pack already has plus the
  // ledger, so a comeback line can appear here without ever touching the
  // variance table above (it flags zero — it has no paid-vs-flagged variance to
  // dispute in the first place).
  const unpaidRework = buildUnpaidSummary({ entries, unpaid, library, rates });

  return {
    periodLabel,
    techName,
    generatedDate,
    lines,
    totalShortHours,
    totalShortDollars,
    hasRates: rated,
    disputedRoCount: disputedEntryIds.size,
    photosAvailable,
    unpaidRework: unpaidRework.lines.length > 0 ? unpaidRework : null,
  };
}

// ---------------------------------------------------------------------------
// Text render target — email/clipboard. External-facing: formal, factual, no
// emoji, no accusatory language. This is the block a tech pastes into an email
// to their service manager or payroll.
// ---------------------------------------------------------------------------

function fmtH(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function fmtD(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatDisputePackText(pack: DisputePack): string {
  const lines: string[] = [];
  lines.push("Flagged vs. Paid Variance Report");
  if (pack.techName) lines.push(`Technician: ${pack.techName}`);
  lines.push(`Pay period: ${pack.periodLabel}`);
  if (pack.generatedDate) lines.push(`Generated: ${pack.generatedDate}`);
  lines.push("");

  if (pack.lines.length === 0) {
    lines.push("No flagged-vs-paid variances in this period.");
    appendUnpaidSection(lines, pack);
    return lines.join("\n");
  }

  lines.push(
    "The following repair-order lines show a variance between the hours " +
      "flagged and the hours paid:",
  );
  lines.push("");

  for (const l of pack.lines) {
    const parts: string[] = [];
    parts.push(`RO #${l.roNumber} (${l.date})`);
    parts.push(l.description ? `${l.code} — ${l.description}` : l.code);
    lines.push(parts.join("  |  "));
    const paidStr = l.paid === null ? "not yet paid" : `${fmtH(l.paid)}h paid`;
    let detail = `  Flagged ${fmtH(l.flagged)}h, ${paidStr}  —  variance ${fmtH(
      l.deltaHours,
    )}h`;
    if (l.deltaDollars !== null) detail += ` (${fmtD(l.deltaDollars)})`;
    lines.push(detail);
    lines.push("");
  }

  lines.push("─".repeat(40));
  let total = `Total variance: ${fmtH(pack.totalShortHours)}h`;
  if (pack.totalShortDollars !== null) {
    total += ` (${fmtD(pack.totalShortDollars)})`;
  }
  lines.push(total);
  lines.push(
    `Across ${pack.disputedRoCount} repair order${
      pack.disputedRoCount === 1 ? "" : "s"
    }.`,
  );
  lines.push("");
  lines.push(
    "All hours above were logged contemporaneously as the work was performed.",
  );
  if (pack.disputedRoCount > 0) {
    lines.push(
      `Photo record available for ${pack.photosAvailable} of ${pack.disputedRoCount} listed repair orders.`,
    );
  }

  appendUnpaidSection(lines, pack);

  return lines.join("\n");
}

// The unpaid-rework section of the text export. Kept separate from the variance
// report above — deliberately never folded into the variance total, because
// unpaid rework is not a paid-vs-flagged discrepancy; it is work that flagged
// nothing at all.
function appendUnpaidSection(out: string[], pack: DisputePack): void {
  const u = pack.unpaidRework;
  if (!u) return;

  const rework = u.lines.filter(
    (l) =>
      l.kind === "comeback_own" ||
      l.kind === "comeback_other" ||
      l.kind === "rework_same_visit",
  );

  out.push("");
  out.push("─".repeat(40));
  out.push("Unpaid rework performed");
  out.push("");

  if (rework.length > 0) {
    out.push(
      "The following work was performed without flagged hours. It is listed " +
        "separately and is not included in the variance total above:",
    );
    out.push("");
    for (const l of rework) {
      const head = l.roNumber ? `RO #${l.roNumber} (${l.date})` : l.date;
      const what = [l.code, l.description].filter(Boolean).join(" — ");
      out.push(what ? `${head}  |  ${what}` : head);
      let detail = `  ${fmtH(l.hours)}h performed, 0.0h flagged`;
      if (l.dollars !== null) detail += ` (${fmtD(l.dollars)} at the applicable rate)`;
      out.push(detail);
      out.push("");
    }
  }

  out.push(`Unpaid rework: ${fmtH(u.comebackHours)}h`);
  if (u.waitingHours > 0) {
    out.push(`Waiting on parts or approval: ${fmtH(u.waitingHours)}h`);
  }
  if (u.shopHours > 0) {
    out.push(`Other non-productive shop time: ${fmtH(u.shopHours)}h`);
  }
  let total = `Total unpaid time: ${fmtH(u.totalHours)}h`;
  if (u.totalDollars !== null) total += ` (${fmtD(u.totalDollars)})`;
  out.push(total);
  if (u.totalDollars !== null && u.unpricedHours > 0) {
    // Say it out loud rather than letting the dollar figure read as if it
    // covered every hour listed.
    out.push(
      `${fmtH(u.unpricedHours)}h of the above carries no rate on file and is reported as hours only.`,
    );
  }
}
