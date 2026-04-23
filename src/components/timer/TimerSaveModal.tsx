"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { saveTimerToLineAction } from "@/app/actions/timer";

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
  onClose,
}: {
  entry: Entry;
  library: OpCode[];
  elapsedMs: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const [selectedId, setSelectedId] = useState<string | null>(
    entry.opCodes[0]?.id ?? null,
  );
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
        <p className="text-xs text-zinc-500">
          Pick which op code this time should be attached to. The elapsed time
          will be saved as that line&apos;s actual hours
          ({fmtHours(hours)}h), replacing any existing value.
        </p>

        {entry.opCodes.length === 0 ? (
          <p className="rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            This RO has no op codes. Edit it first to add one.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
            {entry.opCodes.map((line) => {
              const { code, description } = lineLabel(line, libraryById);
              const active = line.id === selectedId;
              return (
                <li key={line.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm ${
                      active ? "bg-orange-950/30" : "hover:bg-zinc-800/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="timer-save-line"
                      checked={active}
                      onChange={() => setSelectedId(line.id)}
                      className="mt-1 h-4 w-4 accent-orange-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-sm text-orange-400">
                          {code}
                        </span>
                        {line.custom && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                            Other
                          </span>
                        )}
                        <span className="ml-auto text-xs text-zinc-500">
                          Flag {fmtHours(line.flagHours)}h
                        </span>
                      </div>
                      {description && (
                        <div className="truncate text-xs text-zinc-500">
                          {description}
                        </div>
                      )}
                      <div className="mt-0.5 text-xs text-zinc-400">
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
        )}

        {error && <p className="text-sm text-red-300">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || !selected}
            className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
