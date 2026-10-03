import type { Entry, OpCode } from "@/lib/types";
import { lineCode } from "@/lib/line-code";

/**
 * Does this RO match the History search box?
 *
 * Matches the RO number, the vehicle, the RO notes, and every op code line —
 * by its code (library or custom) and its description, so "BRK" and "brake
 * pads" both find a brake job. Case-insensitive substring; an empty query
 * matches everything.
 */
export function entryMatchesSearch(
  entry: Entry,
  query: string,
  libraryById: Map<string, OpCode>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const vehicle = [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model].join(" ");
  const ops = entry.opCodes.map((line) => {
    const description = line.custom
      ? line.customDescription ?? ""
      : (line.opCodeId && libraryById.get(line.opCodeId)?.description) || "";
    return `${lineCode(line, libraryById)} ${description}`;
  });
  const haystack = [entry.roNumber, vehicle, entry.notes, ...ops].join(" ").toLowerCase();
  return haystack.includes(q);
}
