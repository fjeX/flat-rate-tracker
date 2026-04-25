// Aggregation of entries + daily clocks over a date range.
import type { DailyClock, Entry } from "./types";

export type Stats = {
  flagHours: number;
  clockedHours: number;
  efficiency: number | null; // percentage; null if clockedHours === 0
  roCount: number;
  actualHours: number; // sum of entry_op_codes.actual_hours (where provided)
};

export function computeEfficiency(
  flagHours: number,
  clockedHours: number,
): number | null {
  if (clockedHours <= 0) return null;
  return (flagHours / clockedHours) * 100;
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function aggregateStats(
  entries: Entry[],
  clocks: DailyClock[],
  range: { start: string; end: string },
): Stats {
  const includedEntries = entries.filter((e) =>
    inRange(e.date, range.start, range.end),
  );
  const includedClocks = clocks.filter((c) =>
    inRange(c.date, range.start, range.end),
  );

  const flagHours = includedEntries.reduce((s, e) => s + e.flagHours, 0);
  const clockedHours = includedClocks.reduce((s, c) => s + c.hours, 0);
  const actualHours = includedEntries.reduce(
    (s, e) =>
      s + e.opCodes.reduce((ss, oc) => ss + (oc.actualHours ?? 0), 0),
    0,
  );

  return {
    flagHours,
    clockedHours,
    efficiency: computeEfficiency(flagHours, clockedHours),
    roCount: includedEntries.length,
    actualHours,
  };
}

// Round to 1 decimal for display. 10.05 → 10.1, 10.04 → 10.
export function fmtHours(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function fmtPct(n: number | null): string {
  if (n === null) return "—";
  return `${Math.round(n)}%`;
}
