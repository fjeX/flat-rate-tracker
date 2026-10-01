import type { Entry, OpCode } from "@/lib/types";

/** Resolve a line's display code from its custom fields or the library. */
export function lineCode(
  line: Entry["opCodes"][number],
  libraryById: Map<string, OpCode>,
): string {
  if (line.custom) return (line.customCode ?? "").trim() || "—";
  if (line.opCodeId) return libraryById.get(line.opCodeId)?.code ?? "—";
  return "—";
}
