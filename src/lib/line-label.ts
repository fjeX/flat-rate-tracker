// How an RO line is labelled everywhere it's rendered outside the log form:
// custom code, library code, or library code plus its sub-op-code variant.
// Handles null joins for custom lines (no library op code).
//
// Extracted from dispute-pack.ts so the dispute pack and the unpaid-rework
// summary label a line identically — two reports of the same RO must never
// disagree about what the line is called.
import type { EntryOpCode, OpCode } from "./types";

export function lineCode(
  line: EntryOpCode,
  libraryById: Map<string, OpCode>,
): string {
  if (line.custom) return (line.customCode ?? "").trim() || "Custom";
  if (line.opCodeId) {
    const oc = libraryById.get(line.opCodeId);
    if (!oc) return "—";
    if (line.subOpCodeId) {
      const sub = oc.subOpCodes.find((s) => s.id === line.subOpCodeId);
      if (sub) return `${oc.code} · ${sub.code}`;
    }
    return oc.code;
  }
  return "—";
}

export function lineDescription(
  line: EntryOpCode,
  libraryById: Map<string, OpCode>,
): string {
  if (line.custom) return (line.customDescription ?? "").trim();
  if (line.opCodeId) {
    const oc = libraryById.get(line.opCodeId);
    if (oc) {
      if (line.subOpCodeId) {
        const sub = oc.subOpCodes.find((s) => s.id === line.subOpCodeId);
        if (sub && sub.description.trim()) return sub.description.trim();
      }
      return oc.description.trim();
    }
  }
  return "";
}
