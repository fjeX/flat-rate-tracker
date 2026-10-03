import type { Entry, OpCode } from "@/lib/types";
import { lineCode } from "@/lib/line-code";

export type SearchField = "ro" | "vehicle" | "op" | "note";

/** One field the query hit, and where in that field's text. */
export type SearchMatch = {
  field: SearchField;
  /** The field's text as searched (notes have their whitespace collapsed). */
  text: string;
  /** Matched range in `text`: start inclusive, end exclusive. */
  start: number;
  end: number;
};

/**
 * Which fields of this RO the History search hit, and where.
 *
 * Fields are RO number, vehicle ("2019 Toyota Camry"), op code lines (the code
 * and its description as one string, "BRK01 Front brake pads", library and
 * custom lines alike) and the RO notes. Each field reports its first hit; an
 * RO with three brake lines reports one op-code match, because the row only
 * needs to say why it is here. Order is RO, vehicle, op code, note. Case-
 * insensitive substring; a blank query reports nothing.
 */
export function findSearchMatches(
  entry: Entry,
  query: string,
  libraryById: Map<string, OpCode>,
): SearchMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const out: SearchMatch[] = [];
  const probe = (field: SearchField, text: string) => {
    const at = text.toLowerCase().indexOf(q);
    if (at >= 0) out.push({ field, text, start: at, end: at + q.length });
  };

  probe("ro", entry.roNumber);
  probe("vehicle", [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model].join(" ").trim());
  for (const line of entry.opCodes) {
    const description = line.custom
      ? line.customDescription ?? ""
      : (line.opCodeId && libraryById.get(line.opCodeId)?.description) || "";
    const before = out.length;
    probe("op", `${lineCode(line, libraryById)} ${description}`.trim());
    if (out.length > before) break;
  }
  probe("note", (entry.notes ?? "").replace(/\s+/g, " ").trim());
  return out;
}

/**
 * Does this RO match the History search box? An empty query matches everything.
 */
export function entryMatchesSearch(
  entry: Entry,
  query: string,
  libraryById: Map<string, OpCode>,
): boolean {
  if (!query.trim()) return true;
  return findSearchMatches(entry, query, libraryById).length > 0;
}

/**
 * A one-line window on a match: the hit plus some context either side, with an
 * ellipsis where the text was cut. The row clips the rest with CSS.
 */
export function matchSnippet(
  m: SearchMatch,
  context = 24,
): { before: string; hit: string; after: string } {
  const from = Math.max(0, m.start - context);
  const to = Math.min(m.text.length, m.end + context);
  return {
    before: (from > 0 ? "…" : "") + m.text.slice(from, m.start),
    hit: m.text.slice(m.start, m.end),
    after: m.text.slice(m.end, to) + (to < m.text.length ? "…" : ""),
  };
}
