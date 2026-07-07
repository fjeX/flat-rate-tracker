"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload, X } from "lucide-react";
import { exportDataAction, importDataAction } from "@/app/actions/settings";
import type { ImportBundle } from "@/app/actions/settings";

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
        if (raw.version !== 1) throw new Error("Unsupported backup version.");
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
        <p className="mb-5 text-sm" style={{ color: "var(--fg-2)" }}>
          Export a full backup or restore from a previous one.
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

      {pendingBundle && (
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

            <p className="mb-4 text-sm" style={{ color: "var(--fg-2)" }}>
              This will permanently replace your current data with:
            </p>

            <ul className="mb-5 space-y-1 text-sm" style={{ color: "var(--fg-1)" }}>
              <li>
                {pendingBundle.entries.length} repair order
                {pendingBundle.entries.length !== 1 ? "s" : ""}
              </li>
              <li>
                {pendingBundle.opCodes.length} op code
                {pendingBundle.opCodes.length !== 1 ? "s" : ""}
              </li>
              <li>
                {pendingBundle.dailyClocks?.length ?? 0} daily clock record
                {(pendingBundle.dailyClocks?.length ?? 0) !== 1 ? "s" : ""}
              </li>
              <li>
                {pendingBundle.paidPeriods?.length ?? 0} paid period record
                {(pendingBundle.paidPeriods?.length ?? 0) !== 1 ? "s" : ""}
              </li>
            </ul>

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
