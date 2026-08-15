// Client-side breadcrumb of which pay periods a tech has already exported a
// dispute pack for. Intentionally localStorage, not a DB column: it's a
// convenience hint ("you already raised this one"), not authoritative data, so
// it doesn't warrant a schema change. Guarded for SSR — every access no-ops on
// the server.
"use client";

import { useStored, writeStored } from "./client-storage";

const KEY = "frt.disputeExports";

type ExportMap = Record<string, string>; // periodKey → ISO timestamp

// Module-level so useStored's fallback keeps a stable identity across renders.
const EMPTY: ExportMap = {};

function parseAll(raw: string): ExportMap {
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? (parsed as ExportMap) : EMPTY;
}

function readAll(): ExportMap {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    return parseAll(raw);
  } catch {
    return EMPTY;
  }
}

/**
 * Hydration-safe read of the export timestamp for one period. Returns null on
 * the server and during hydration, then the stored value — and re-renders when
 * `recordExport` writes, so the card does not need to re-read by hand.
 */
export function useExportedAt(periodKey: string | undefined): string | null {
  const all = useStored<ExportMap>(KEY, parseAll, EMPTY, EMPTY);
  return periodKey ? all[periodKey] ?? null : null;
}

// ISO timestamp of the last export for this period, or null if never exported.
export function getExportedAt(periodKey: string): string | null {
  return readAll()[periodKey] ?? null;
}

// Record an export of this period as happening now.
export function recordExport(periodKey: string): void {
  if (typeof window === "undefined") return;
  // Spread rather than mutate: readAll can hand back the shared EMPTY constant,
  // and writing into that would poison every later read.
  const all = { ...readAll(), [periodKey]: new Date().toISOString() };
  // writeStored notifies useExportedAt readers; a bare setItem would persist
  // the breadcrumb but leave the card showing "never exported" until reload.
  writeStored(KEY, JSON.stringify(all));
}
