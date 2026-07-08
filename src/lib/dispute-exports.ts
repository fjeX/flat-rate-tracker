// Client-side breadcrumb of which pay periods a tech has already exported a
// dispute pack for. Intentionally localStorage, not a DB column: it's a
// convenience hint ("you already raised this one"), not authoritative data, so
// it doesn't warrant a schema change. Guarded for SSR — every access no-ops on
// the server.
const KEY = "frt.disputeExports";

type ExportMap = Record<string, string>; // periodKey → ISO timestamp

function readAll(): ExportMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ExportMap) : {};
  } catch {
    return {};
  }
}

// ISO timestamp of the last export for this period, or null if never exported.
export function getExportedAt(periodKey: string): string | null {
  return readAll()[periodKey] ?? null;
}

// Record an export of this period as happening now.
export function recordExport(periodKey: string): void {
  if (typeof window === "undefined") return;
  try {
    const all = readAll();
    all[periodKey] = new Date().toISOString();
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage full / disabled — the breadcrumb is best-effort, so swallow.
  }
}
