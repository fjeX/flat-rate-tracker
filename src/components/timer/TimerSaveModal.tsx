"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { saveTimerToLineAction } from "@/app/actions/timer";
import { tap } from "@/lib/haptics";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function msToHours(ms: number): number {
  // Round to hundredths — the DB column is numeric(5,2).
  return Math.round((ms / 3_600_000) * 100) / 100;
}

function lineLabel(
  line: EntryOpCode,
  libraryById: Map<string, OpCode>,
): { code: string; description: string } {
  if (line.custom) {
    return {
      code: (line.customCode ?? "").trim() || "—",
      description: (line.customDescription ?? "").trim(),
    };
  }
  const ref = line.opCodeId ? libraryById.get(line.opCodeId) : undefined;
  return { code: ref?.code ?? "—", description: ref?.description ?? "" };
}

export function TimerSaveModal({
  entry,
  library,
  elapsedMs,
  initialLineId,
  onClose,
}: {
  entry: Entry;
  library: OpCode[];
  elapsedMs: number;
  initialLineId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const libraryById = useMemo(() => new Map(library.map((oc) => [oc.id, oc])), [library]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const valid =
      initialLineId && entry.opCodes.some((l) => l.id === initialLineId);
    return valid ? initialLineId : (entry.opCodes[0]?.id ?? null);
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  const hours = msToHours(elapsedMs);
  const selected = entry.opCodes.find((l) => l.id === selectedId) ?? null;

  function handleSave() {
    if (!selected) {
      setError("Pick an op code first.");
      return;
    }
    if (
      selected.actualHours !== null &&
      !window.confirm(
        `This op code already has ${fmtHours(selected.actualHours)}h logged. Replace it with ${fmtHours(hours)}h?`,
      )
    ) {
      return;
    }
    setError(null);
    startPending(async () => {
      try {
        await saveTimerToLineAction(selected.id, hours);
        tap();
        onClose();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title={`Save ${formatElapsed(elapsedMs)} to RO #${entry.roNumber}`}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--fg-3)]">
          Pick which op code this time should be attached to. The elapsed time
          will be saved as that line&apos;s actual hours
          ({fmtHours(hours)}h), replacing any existing value.
        </p>

        {entry.opCodes.length === 0 ? (
          <p className="rounded-md border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn)]">
            This RO has no op codes. Edit it first to add one.
          </p>
        ) : (
          <fieldset className="rounded-md border border-[var(--line)]">
          <legend className="sr-only">Op code to save time to</legend>
          <ul className="divide-y divide-[var(--line-soft)]">
            {entry.opCodes.map((line) => {
              const { code, description } = lineLabel(line, libraryById);
              const active = line.id === selectedId;
              return (
                <li key={line.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm ${
                      active ? "bg-[var(--brand-bg)]" : "hover:bg-[var(--bg-3)]/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="timer-save-line"
                      checked={active}
                      onChange={() => setSelectedId(line.id)}
                      className="mt-1 h-4 w-4 accent-[var(--brand)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-sm text-[var(--brand)]">
                          {code}
                        </span>
                        {line.custom && (
                          <span className="rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--fg-2)]">
                            Other
                          </span>
                        )}
                        <span className="ml-auto text-xs text-[var(--fg-3)]">
                          Flag {fmtHours(line.flagHours)}h
                        </span>
                      </div>
                      {description && (
                        <div className="truncate text-xs text-[var(--fg-3)]">
                          {description}
                        </div>
                      )}
                      <div className="mt-0.5 text-xs text-[var(--fg-2)]">
                        Current actual:{" "}
                        {line.actualHours === null
                          ? "—"
                          : `${fmtHours(line.actualHours)}h`}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
          </fieldset>
        )}

        {error && <p role="alert" className="text-sm text-[var(--bad)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="btn"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || !selected}
            className="btn btn-primary"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
