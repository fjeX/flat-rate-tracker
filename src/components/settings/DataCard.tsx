"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Download, Upload, X } from "lucide-react";
import { exportDataAction, importDataAction } from "@/app/actions/settings";
import { SUPPORTED_BACKUP_VERSIONS, type ImportBundle } from "@/lib/import-remap";
import { summarizeBackup } from "@/lib/backup-summary";

export function DataCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [exportPending, startExport] = useTransition();
  const [importPending, startImport] = useTransition();
  const [pendingBundle, setPendingBundle] = useState<ImportBundle | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importDone, setImportDone] = useState(false);

  function handleExport() {
    setExportError(null);
    startExport(async () => {
      try {
        const json = await exportDataAction();
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `flat-rate-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setExportError(err instanceof Error ? err.message : "Couldn't export — check your connection and try again.");
      }
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setImportDone(false);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string) as ImportBundle;
        // Read the supported list rather than hardcoding it. This check used to
        // be `!== 1` and was left behind when export moved to v2 (584e450), so
        // the picker rejected every backup the app itself had produced since.
        if (!SUPPORTED_BACKUP_VERSIONS.includes(raw.version)) {
          throw new Error(`Unsupported backup version ${raw.version}.`);
        }
        if (!Array.isArray(raw.entries) || !Array.isArray(raw.opCodes)) {
          throw new Error("Invalid backup format — missing entries or opCodes.");
        }
        setPendingBundle(raw);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Failed to read file.");
      }
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsText(file);
  }

  // Derived from the parsed file, so the dialog can never describe a different
  // bundle than the one the confirm button imports.
  const summary = useMemo(
    () => (pendingBundle ? summarizeBackup(pendingBundle) : null),
    [pendingBundle],
  );
  const replacing = summary?.sections.filter((s) => s.state === "replacing") ?? [];
  const untouched = summary?.sections.filter((s) => s.state === "untouched") ?? [];

  function handleImportConfirm() {
    if (!pendingBundle) return;
    setImportError(null);
    startImport(async () => {
      try {
        await importDataAction(pendingBundle);
        setPendingBundle(null);
        setImportDone(true);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Couldn't import — check your connection and try again.");
      }
    });
  }

  return (
    <>
      <section className="card padded-lg">
        <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--fg-0)" }}>Data</h2>
        <p className="mb-2 text-sm" style={{ color: "var(--fg-2)" }}>
          Export a full backup or restore from a previous one.
        </p>
        <p className="mb-5 text-xs" style={{ color: "var(--fg-3)" }}>
          Note: RO photo image files aren&apos;t included in the JSON backup — only
          their metadata. Photos stay in secure storage and can&apos;t be restored
          from this file.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExport}
            disabled={exportPending}
            className="btn"
          >
            <Download className="h-4 w-4" />
            {exportPending ? "Preparing…" : "Download backup"}
          </button>

          <button
            onClick={() => fileRef.current?.click()}
            disabled={importPending}
            className="btn"
          >
            <Upload className="h-4 w-4" />
            Import backup…
          </button>

          <label htmlFor="backup-file-input" className="sr-only">
            Import backup file
          </label>
          <input
            ref={fileRef}
            id="backup-file-input"
            type="file"
            accept=".json,application/json"
            aria-describedby={parseError ? "backup-parse-error" : undefined}
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {exportError && (
          <p role="alert" className="mt-3 text-sm" style={{ color: "var(--bad)" }}>{exportError}</p>
        )}
        {parseError && (
          <p id="backup-parse-error" role="alert" className="mt-3 text-sm" style={{ color: "var(--bad)" }}>{parseError}</p>
        )}
        {importDone && (
          <p className="mt-3 text-sm" style={{ color: "var(--good)" }}>Import complete — data replaced.</p>
        )}
      </section>

      {pendingBundle && summary && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 sm:items-center">
          <div className="card w-full p-6 sm:mx-auto sm:max-w-md" style={{ borderRadius: "var(--radius) var(--radius) 0 0" }}>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-base font-semibold" style={{ color: "var(--fg-0)" }}>Replace all data?</h3>
              <button
                onClick={() => setPendingBundle(null)}
                aria-label="Close"
                className="-m-3 flex items-center justify-center p-3"
                style={{ color: "var(--fg-3)" }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {summary.exportedAt && (
              <p className="mb-4 text-xs" style={{ color: "var(--fg-3)" }}>
                Backup taken {new Date(summary.exportedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {" · "}version {summary.version}
              </p>
            )}

            <div className="mb-5 max-h-[45vh] overflow-y-auto">
              <p className="mb-2 text-sm" style={{ color: "var(--fg-2)" }}>
                This will permanently replace:
              </p>
              <ul className="mb-4 space-y-1 text-sm" style={{ color: "var(--fg-1)" }}>
                {replacing.length === 0 && (
                  <li style={{ color: "var(--fg-3)" }}>Nothing — this file describes no records.</li>
                )}
                {replacing.map((s) => (
                  <li key={s.key} className="flex justify-between gap-4">
                    <span>{s.label}</span>
                    <span style={{ color: s.count === 0 ? "var(--bad)" : "var(--fg-2)" }}>
                      {s.count === 0 ? "cleared" : s.count}
                    </span>
                  </li>
                ))}
              </ul>

              {/* An older backup has no key for these tables, and the import
                  skips a table it can't see — so this data is KEPT, not wiped.
                  Showing it as "0" alongside the list above is the one thing
                  this screen must never do. */}
              {untouched.length > 0 && (
                <>
                  <p className="mb-2 text-sm" style={{ color: "var(--fg-2)" }}>
                    Not described by this backup — your current data is kept:
                  </p>
                  <ul className="mb-4 space-y-1 text-sm" style={{ color: "var(--fg-3)" }}>
                    {untouched.map((s) => (
                      <li key={s.key}>{s.label}</li>
                    ))}
                  </ul>
                </>
              )}

              <p className="mb-2 text-sm" style={{ color: "var(--fg-2)" }}>
                Doesn&apos;t come across:
              </p>
              <ul className="space-y-1 text-sm" style={{ color: "var(--fg-3)" }}>
                {summary.warnings.map((w) => (
                  <li key={w.label}>
                    <span style={{ color: "var(--fg-2)" }}>{w.label}</span> — {w.detail}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setPendingBundle(null)}
                disabled={importPending}
                className="btn flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleImportConfirm}
                disabled={importPending}
                className="btn btn-primary flex-1"
              >
                {importPending ? "Importing…" : "Replace data"}
              </button>
            </div>
            {importError && (
              <p role="alert" className="mt-3 text-sm" style={{ color: "var(--bad)" }}>{importError}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
