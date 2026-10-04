/**
 * History → CSV.
 *
 * A pure function: the filtered list History is showing goes in, the text of a
 * file comes out. No DOM, no clock, no fetch. The component owns the download.
 *
 * ONE ROW PER OP-CODE LINE. An RO with three lines is three rows; an RO with no
 * lines (an open ticket) is one row with the line columns empty, so it still
 * shows up in the export instead of silently vanishing. RO-level facts (vehicle,
 * RO notes) repeat on every one of an RO's rows. That is deliberate: a flat file
 * a spreadsheet can pivot or filter without a join.
 *
 * PROVENANCE. The file opens with `# `-prefixed lines saying what it is, which
 * schema it follows, when it was cut and under which filters. A CSV forwarded
 * from a phone three weeks later has to explain itself; the tech who sent it
 * will not remember whether it was the month or the pay period.
 *
 * WHAT IS NOT HERE, ON PURPOSE. No dollars (they depend on rates, which change)
 * and no efficiency column (efficiency has one formula, in stats.ts, and
 * re-deriving it per row is how two screens come to disagree). This file is the
 * facts stored on the RO and nothing computed from them.
 */
import { COMEBACK_KIND_LABELS, type Entry, type OpCode } from "@/lib/types";
import { LABOR_TYPE_LABELS } from "@/lib/earnings";
import { fmtHours2 } from "@/lib/format";
import { lineCode } from "@/lib/line-code";
import { buildHistoryQuery, type HistoryUrlState } from "@/lib/history-url";

/**
 * The file's schema version, written into the provenance header as
 * `# schema: frt-csv/N`.
 *
 * BUMP RULE: any column added, removed, renamed or re-meaning'd bumps N — and a
 * new or renamed VALUE in an enum column (status, labor_type, actual_source,
 * comeback_kind) counts as re-meaning'd. A
 * script that reads these files keys off this line; a column that quietly moved
 * or changed meaning under the same version is worse than a loud new number.
 * Provenance lines and row ordering are NOT part of the schema.
 */
export const CSV_SCHEMA_VERSION = "frt-csv/1";

/** Excel reads a BOM-less UTF-8 file as Windows-1252 and mangles every non-ASCII character. */
const BOM = "﻿";
const EOL = "\r\n";

export const CSV_COLUMNS = [
  "date",
  "logged_time",
  "ro_number",
  "status",
  "vehicle",
  "vin",
  "mileage",
  "line",
  "op_code",
  "op_description",
  "op_variant",
  "labor_type",
  "flag_hours",
  "actual_hours",
  "actual_source",
  "paid_hours",
  "comeback",
  "comeback_kind",
  "upsell",
  "line_notes",
  "ro_notes",
] as const;

/**
 * `frt-history-YYYY-MM-DD.csv`. Takes the tech's own "today" (already
 * timezone-resolved by the page) rather than a Date: a UTC date would name an
 * evening export in LA after tomorrow.
 */
export function csvFilename(today: string): string {
  return `frt-history-${today}.csv`;
}

/**
 * A text cell, made safe for a spreadsheet.
 *
 * Formula injection: Excel and Sheets run a cell that starts with = + - @ (or a
 * tab / CR, which some versions skip past) as a formula, and notes and custom op
 * descriptions are free text the tech typed or pasted. A leading apostrophe makes
 * the app's own export inert. Then RFC 4180: a field with a comma, quote or line
 * break is wrapped in quotes and its quotes doubled.
 */
function textCell(s: string): string {
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * A number cell: printed as-is, never guarded. `fmtHours2` output is the only
 * thing that arrives here, and a "-" prefix on a real number must not be turned
 * into text. (Negative hours are not a thing in this data; this is the rule,
 * not a case that occurs.)
 */
function numCell(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : fmtHours2(n);
}

function yesNo(b: boolean | undefined): string {
  return b ? "yes" : "no";
}

/** One header-comment value must stay on one line, whatever the tech typed in search. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The filters as one human-readable line.
 *
 * Built from `buildHistoryQuery`, the same serializer that writes the URL, so the
 * names and the canonical order (range, from, to, q, sort, dir, bar) cannot
 * drift from what the address bar says. Two deliberate differences from the URL:
 *  - `range` is always spelled out. The URL omits the default ("period"), but in
 *    a file "no filters" would read as "everything", which is the opposite.
 *  - `dates=` states the concrete span the range meant on the day of export
 *    ("month" alone is meaningless next week). It is absent for "all".
 */
export function describeFilters(
  state: HistoryUrlState,
  span: { start: string; end: string } | null,
): string {
  const params = new URLSearchParams(buildHistoryQuery(state));
  const parts = [`range=${params.get("range") ?? "period"}`];
  if (span) parts.push(`dates=${span.start}..${span.end}`);
  params.forEach((value, key) => {
    if (key !== "range") parts.push(`${key}=${oneLine(value)}`);
  });
  return parts.join("; ");
}

function vehicleText(e: Entry): string {
  return [e.vehicle.year, e.vehicle.make, e.vehicle.model].filter(Boolean).join(" ").trim();
}

/**
 * The labor type as the app words it. Matches the line editor (OpCodeLines):
 * `null` (a line that predates the feature) reads as Customer Pay, because
 * that is the rate it earns; only an explicit "untyped" reads Untyped.
 */
function laborLabel(line: Entry["opCodes"][number]): string {
  if (line.laborType === "untyped") return "Untyped";
  return LABOR_TYPE_LABELS[line.laborType ?? "customer_pay"];
}

/** The sub op code the tech picked ("LOF-SYN"), or "" — the parent code alone
 * would silently drop which variant was done. */
function lineVariant(line: Entry["opCodes"][number], libraryById: Map<string, OpCode>): string {
  if (line.custom || !line.subOpCodeId || !line.opCodeId) return "";
  const sub = libraryById.get(line.opCodeId)?.subOpCodes.find((v) => v.id === line.subOpCodeId);
  return sub?.code ?? "";
}

function lineDescription(line: Entry["opCodes"][number], libraryById: Map<string, OpCode>): string {
  if (line.custom) return line.customDescription ?? "";
  return (line.opCodeId && libraryById.get(line.opCodeId)?.description) || "";
}

export type CsvExportInput = {
  /** The list History is rendering, already filtered and sorted. Order is kept. */
  entries: Entry[];
  library: OpCode[];
  filters: HistoryUrlState;
  /** The concrete dates the active range covers; null for "all" (and a broken custom range). */
  span: { start: string; end: string } | null;
  exportedAt: Date;
};

/** The whole file as text: BOM, provenance, header, rows, CRLF throughout. */
export function buildHistoryCsv({ entries, library, filters, span, exportedAt }: CsvExportInput): string {
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const rows: string[] = [];

  for (const e of entries) {
    const ro = [
      textCell(e.date),
      textCell(e.loggedTime ?? ""),
      textCell(e.roNumber),
      textCell(e.status ?? "closed"),
      textCell(vehicleText(e)),
      textCell(e.vehicle.vin ?? ""),
      textCell(e.vehicle.mileage ?? ""),
    ];
    const roNotes = textCell(e.notes ?? "");
    const lines = [...e.opCodes].sort((a, b) => a.position - b.position);

    if (lines.length === 0) {
      // The line columns (line .. line_notes) stay empty; RO notes is still last.
      rows.push([...ro, ...Array<string>(CSV_COLUMNS.indexOf("ro_notes") - CSV_COLUMNS.indexOf("line")).fill(""), roNotes].join(","));
      continue;
    }
    lines.forEach((line, i) => {
      rows.push(
        [
          ...ro,
          String(i + 1),
          textCell(lineCode(line, libraryById)),
          textCell(lineDescription(line, libraryById)),
          textCell(lineVariant(line, libraryById)),
          textCell(laborLabel(line)),
          numCell(line.flagHours),
          numCell(line.actualHours),
          textCell(line.actualSource ?? ""),
          numCell(line.paidHours),
          yesNo(line.isComeback),
          // Whose comeback, from the RO — on the comeback lines only, so a
          // non-comeback line on the same ticket doesn't read as one.
          textCell(line.isComeback && e.comebackKind ? COMEBACK_KIND_LABELS[e.comebackKind] : ""),
          yesNo(line.isUpsell),
          textCell(line.notes ?? ""),
          roNotes,
        ].join(","),
      );
    });
  }

  const provenance = [
    "# Flat Rate Tracker — History export",
    `# schema: ${CSV_SCHEMA_VERSION}`,
    `# exported_at: ${exportedAt.toISOString()}`,
    `# filters: ${describeFilters(filters, span)}`,
    `# rows: ${rows.length} data rows from ${entries.length} ROs`,
    "# hours are flat-rate tenths (0.1 = 6 min)",
    "# date: the day the RO flags on; for status=open, the day it was opened (on close it becomes the day the flag pays)",
    "# actual_source: timer = a clock ran; estimate = a tapped estimate; blank with actual_hours = recorded before sources were tracked",
  ];

  return BOM + [...provenance, CSV_COLUMNS.join(","), ...rows].join(EOL) + EOL;
}
