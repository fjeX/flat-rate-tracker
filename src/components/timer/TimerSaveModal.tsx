"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { saveTimerAction } from "@/app/actions/timer";
import {
  elapsedFor,
  formatDuration,
  formatElapsed,
  msToHours,
  type TimerSlot,
} from "@/lib/timer";
import { tap } from "@/lib/haptics";

// Closing out a timer. Two things happen and the modal has to be honest about
// both: worked time is ADDED to an op-code line (jobs span sessions, so
// replacing silently discarded the earlier half), and any waiting time is
// banked to the unpaid-time ledger under the reason it was waited for.

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
  slot,
  entry,
  library,
  capAt,
  onClose,
}: {
  slot: TimerSlot;
  entry: Entry;
  library: OpCode[];
  capAt: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const libraryById = useMemo(
    () => new Map(library.map((oc) => [oc.id, oc])),
    [library],
  );

  // Frozen at open rather than ticking: a total that moves while you're reading
  // it is unreviewable. The server recomputes from persisted state on save, so
  // the few seconds spent in this modal aren't lost — they just aren't shown.
  const [elapsed] = useState(() => elapsedFor(slot, Date.now(), capAt));

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const valid = slot.lineId && entry.opCodes.some((l) => l.id === slot.lineId);
    return valid ? slot.lineId : (entry.opCodes[0]?.id ?? null);
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  const workHours = msToHours(elapsed.work);
  const selected = entry.opCodes.find((l) => l.id === selectedId) ?? null;
  const existing = selected?.actualHours ?? null;
  const newTotal = Math.round(((existing ?? 0) + workHours) * 100) / 100;

  function handleSave() {
    if (!selected) {
      setError("Pick an op code first.");
      return;
    }
    setError(null);
    startPending(async () => {
      try {
        const res = await saveTimerAction(slot.id, selected.id);
        tap();
        if (!res.ledgerWritten) {
          // The worked hours landed; only the unpaid ledger didn't. Say so
          // rather than reporting a clean save.
          setNotice(
            "Saved the worked hours, but the waiting time couldn't be recorded — the unpaid-time table isn't set up yet.",
          );
          router.refresh();
          return;
        }
        onClose();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  if (notice) {
    return (
      <Modal open onClose={onClose} title="Saved with a warning">
        <div className="space-y-4">
          <p className="rounded-[var(--radius-sm)] bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn)]">
            {notice}
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Close out RO #${entry.roNumber}`}>
      <div className="space-y-4">
        {/* What's being banked, before anything is chosen. */}
        <div className="card-inset" style={{ padding: 12 }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-[var(--fg-2)]">Worked</span>
            <span className="font-mono text-sm text-[var(--fg-0)]">
              {formatElapsed(elapsed.work)} · {fmtHours(workHours)}h
            </span>
          </div>
          {elapsed.holdParts > 0 && (
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm text-[var(--warn)]">Waiting on parts</span>
              <span className="font-mono text-sm text-[var(--warn)]">
                {formatDuration(elapsed.holdParts)}
              </span>
            </div>
          )}
          {elapsed.holdApproval > 0 && (
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm text-[var(--info)]">Waiting on approval</span>
              <span className="font-mono text-sm text-[var(--info)]">
                {formatDuration(elapsed.holdApproval)}
              </span>
            </div>
          )}
          {elapsed.hold > 0 && (
            <p className="mt-2 text-xs text-[var(--fg-3)]">
              Waiting time is logged as unpaid time against this RO. It never
              touches your flag hours.
            </p>
          )}
        </div>

        {entry.opCodes.length === 0 ? (
          <p className="rounded-[var(--radius-sm)] bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn)]">
            This RO has no op codes. Edit it first to add one.
          </p>
        ) : (
          <>
            <p className="text-xs text-[var(--fg-3)]">
              Which line did the worked time go to? It&apos;s{" "}
              <strong className="text-[var(--fg-1)]">added</strong> to whatever
              that line already has, so a job you picked back up tomorrow still
              totals correctly.
            </p>
            <fieldset className="card-inset overflow-hidden">
              <legend className="sr-only">Op code to save time to</legend>
              <ul className="divide-y divide-[var(--line-soft)]">
                {entry.opCodes.map((line) => {
                  const { code, description } = lineLabel(line, libraryById);
                  const active = line.id === selectedId;
                  return (
                    <li key={line.id}>
                      <label
                        className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm ${
                          active
                            ? "bg-[var(--brand-bg)]"
                            : "hover:bg-[var(--bg-3)]/40"
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
                            {line.custom && <Badge>Other</Badge>}
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
                            Actual:{" "}
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

            {/* The running total — the whole reason additive saves are safe. */}
            {selected && workHours > 0 && (
              <p className="text-sm text-[var(--fg-2)]">
                {existing === null ? (
                  <>
                    This line has no actual hours yet — it becomes{" "}
                    <strong className="text-[var(--fg-0)]">
                      {fmtHours(workHours)}h
                    </strong>
                    .
                  </>
                ) : (
                  <>
                    <span className="font-mono">{fmtHours(existing)}h</span> +{" "}
                    <span className="font-mono">{fmtHours(workHours)}h</span> ={" "}
                    <strong className="font-mono text-[var(--fg-0)]">
                      {fmtHours(newTotal)}h
                    </strong>{" "}
                    on this line.
                  </>
                )}
              </p>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-[var(--bad)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={pending || !selected}
          >
            {pending ? "Saving…" : "Save & close timer"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
