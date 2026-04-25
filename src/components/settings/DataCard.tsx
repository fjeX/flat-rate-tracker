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
  const [importDone, setImportDone] = useState(false);

  function handleExport() {
    startExport(async () => {
      const json = await exportDataAction();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flat-rate-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
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
    startImport(async () => {
      await importDataAction(pendingBundle);
      setPendingBundle(null);
      setImportDone(true);
    });
  }

  return (
    <>
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-1 text-base font-semibold text-zinc-100">Data</h2>
        <p className="mb-5 text-sm text-zinc-400">
          Export a full backup or restore from a previous one.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExport}
            disabled={exportPending}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {exportPending ? "Preparing…" : "Download backup"}
          </button>

          <button
            onClick={() => fileRef.current?.click()}
            disabled={importPending}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            Import backup…
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {parseError && <p className="mt-3 text-sm text-red-400">{parseError}</p>}
        {importDone && (
          <p className="mt-3 text-sm text-green-400">Import complete — data replaced.</p>
        )}
      </section>

      {pendingBundle && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 sm:items-center">
          <div className="w-full rounded-t-2xl border border-zinc-800 bg-zinc-900 p-6 sm:mx-auto sm:max-w-md sm:rounded-xl">
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-base font-semibold text-zinc-100">Replace all data?</h3>
              <button
                onClick={() => setPendingBundle(null)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mb-4 text-sm text-zinc-400">
              This will permanently replace your current data with:
            </p>

            <ul className="mb-5 space-y-1 text-sm text-zinc-300">
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
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleImportConfirm}
                disabled={importPending}
                className="flex-1 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
              >
                {importPending ? "Importing…" : "Replace data"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
