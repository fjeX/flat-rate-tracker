"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Download, Upload } from "lucide-react";
import { exportDataAction, importDataAction } from "@/app/actions/settings";
import { SUPPORTED_BACKUP_VERSIONS, type ImportBundle } from "@/lib/import-remap";
import {
  CORE_SECTION_KEYS,
  missingCoreSectionRefusal,
  summarizeBackup,
} from "@/lib/backup-summary";
import { actionErrorMessage } from "@/lib/action-error";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StatusField } from "@/components/ui/StatusField";
import { SettingRow } from "./SettingRow";

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
        setExportError(actionErrorMessage(err, "Couldn't export — check your connection and try again."));
      }
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    // A refusal belongs to the file it was about. Left set, it would sit next
    // to the NEXT file's confirm dialog as if that file had been refused.
    setImportError(null);
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
        // A missing core section is refused HERE, before the dialog: the RPC
        // wipes those tables whatever the file says, so there is no honest way
        // to describe the import. importDataAction refuses it too — this is so
        // the tech hears why before clicking Replace, not instead of that guard.
        const missing = missingCoreSectionRefusal(raw);
        if (missing) throw new Error(missing);
        // A core key the shared rule allowed to be absent (v1 bonuses) is
        // skipped here; present ones must be lists.
        if (CORE_SECTION_KEYS.some((k) => raw[k] != null && !Array.isArray(raw[k]))) {
          throw new Error("Invalid backup format.");
        }
        setPendingBundle(raw);
      } catch (err) {
        setParseError(actionErrorMessage(err, "Failed to read file."));
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
  const cleared = summary?.sections.filter((s) => s.state === "cleared") ?? [];

  function handleImportConfirm() {
    if (!pendingBundle) return;
    setImportError(null);
    startImport(async () => {
      try {
        // A refusal comes back as DATA (see importDataAction): a thrown message
        // is masked in a production build. Keep the dialog open with the real
        // sentence and never fall through to the success state.
        const res = await importDataAction(pendingBundle);
        if (res?.error) {
          setImportError(res.error);
          return;
        }
        setPendingBundle(null);
        setImportDone(true);
      } catch (err) {
        setImportError(actionErrorMessage(err, "Couldn't import — check your connection and try again."));
      }
    });
  }

  return (
    <>
      <SettingRow
        titleAs="h2"
        title="Backup"
        description="Export a full backup or restore from a previous one."
        fine="RO photo image files aren't included in the JSON backup — only their metadata. Photos stay in secure storage and can't be restored from this file."
      >
        <div className="stg-actions" style={{ marginTop: 0 }}>
          <Button variant="line" onClick={handleExport} disabled={exportPending}>
            <Download size={16} aria-hidden="true" />
            {exportPending ? "Preparing…" : "Download backup"}
          </Button>
          <Button variant="quiet" onClick={() => fileRef.current?.click()} disabled={importPending}>
            <Upload size={16} aria-hidden="true" />
            Import backup…
          </Button>
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
          <p role="alert" className="stg-note is-bad">{exportError}</p>
        )}
        {parseError && (
          <p id="backup-parse-error" role="alert" className="stg-note is-bad">{parseError}</p>
        )}
        <div role="status">
          {importDone && (
            <p className="stg-note is-good">Import complete — data replaced.</p>
          )}
        </div>
      </SettingRow>

      <Modal
        open={pendingBundle != null && summary != null}
        // Escape, backdrop and the X all land here, same as Cancel. Cancel is
        // disabled while an import runs, so closing is too: a dialog that
        // vanished mid-import would hide the refusal sentence when it came.
        onClose={() => {
          if (!importPending) setPendingBundle(null);
        }}
        title="Replace all data?"
        footer={
          <>
            <Button variant="quiet" onClick={() => setPendingBundle(null)} disabled={importPending}>
              Cancel
            </Button>
            <Button
              variant="go"
              className="imp-go"
              onClick={handleImportConfirm}
              disabled={importPending}
            >
              {importPending ? "Importing…" : "Replace data"}
            </Button>
          </>
        }
      >
        {summary && (
          <div className="imp-body">
            {importError && (
              <StatusField tag="Fix" inset role="none">
                <p role="alert">{importError}</p>
              </StatusField>
            )}

            <div className="rows">
              {summary.exportedAt && (
                <div>
                  <span className="k">Backup taken</span>
                  <span className="v num">
                    {new Date(summary.exportedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              )}
              <div>
                <span className="k">Version</span>
                <span className="v num">{summary.version}</span>
              </div>
            </div>

            <section>
              <p className="field-label">This will permanently replace:</p>
              <ul className="rows imp-list">
                {replacing.length === 0 && cleared.length === 0 && (
                  <li>
                    <span className="imp-dim">Nothing — this file describes no records.</span>
                  </li>
                )}
                {replacing.map((s) => (
                  <li key={s.key}>
                    <span className="k">{s.label}</span>
                    <span className={s.count === 0 ? "v num imp-cleared" : "v num"}>
                      {s.count === 0 ? "cleared" : s.count}
                    </span>
                  </li>
                ))}
                {/* An older backup that predates a core table: the import
                    empties it. That is a wipe, so it sits in THIS list, in the
                    same red as a "cleared" count — never under "kept". */}
                {cleared.map((s) => (
                  <li key={s.key} className="imp-cleared">
                    {s.state === "cleared" && `${s.label} — will be cleared (${s.detail})`}
                  </li>
                ))}
              </ul>
            </section>

            {/* An older backup has no key for these tables, and the import
                skips a table it can't see — so this data is KEPT, not wiped.
                Showing it as "0" alongside the list above is the one thing
                this screen must never do. */}
            {untouched.length > 0 && (
              <section>
                <p className="field-label">
                  Not described by this backup — your current data is kept:
                </p>
                <ul className="rows imp-list">
                  {untouched.map((s) => (
                    <li key={s.key}>
                      <span className="k imp-dim">{s.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <p className="field-label">Doesn&apos;t come across:</p>
              {summary.warnings.map((w) => (
                <StatusField key={w.label} tag="Note" inset>
                  <b>{w.label}</b> — {w.detail}
                </StatusField>
              ))}
            </section>
          </div>
        )}
      </Modal>
    </>
  );
}
