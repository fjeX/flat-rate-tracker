"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { fmtHours2 } from "@/lib/format";
import { saveTimerAction, type TimerSaveResult } from "@/app/actions/timer";
import {
  elapsedFor,
  formatDuration,
  formatElapsed,
  isLedgerableHold,
  msToHours,
  type TimerSlot,
} from "@/lib/timer";
import { tap } from "@/lib/haptics";

// Closing out a timer. Two things happen and the modal has to be honest about
// both: worked time is ADDED to an op-code line (jobs span sessions, so
// replacing silently discarded the earlier half), and any waiting time is
// banked to the unpaid-time ledger under the reason it was waited for.

/**
 * Wait hours below which a RETURNED figure cannot prove a ledger row exists.
 *
 * msToHours rounds to hundredths of an hour, so 0.01h covers everything from
 * 18s to 54s — and MIN_LEDGERED_HOLD_MS (30s, the gate saveTimerAction applies
 * to raw ms) sits inside that band. 0.02h is at least 54s, which is
 * unambiguously past the gate. Anything under it stays unclaimed: telling
 * someone their waiting time was "logged as unpaid time" when no row was
 * written is a lie on the way to a money document, and that is the exact
 * failure this modal already guards against on the pre-save side.
 */
const CERTAIN_LEDGERED_HOURS = 0.02;

export type SaveDivergence = {
  /** The server wrote a different worked/total figure than the modal showed. */
  hours: boolean;
  /** A ledger row certainly exists, but the modal never promised one. */
  undisclosedWait: boolean;
  any: boolean;
};

/**
 * Compare what the SERVER actually wrote against what this modal showed before
 * the save.
 *
 * The modal freezes `elapsed` at open on purpose — a total that ticks while
 * you're reading it is unreviewable — but saveTimerAction recomputes from
 * persisted accumulators at submit time and deliberately ignores the client's
 * numbers. So the reviewed figure and the written figure can legitimately
 * differ (observed: modal 0.31h, row 0.32h), and nothing used to tell the tech
 * which one landed on the RO. This is what decides whether the post-save step
 * has anything new to say.
 *
 * Exported so the divergence rule is testable without driving the whole modal.
 */
export function saveDivergence(
  res: Pick<
    TimerSaveResult,
    "workHours" | "totalHours" | "waitPartsHours" | "waitApprovalHours"
  >,
  shown: { workHours: number; newTotal: number; ledgerPromised: boolean },
): SaveDivergence {
  const hours =
    res.workHours !== shown.workHours || res.totalHours !== shown.newTotal;
  const undisclosedWait =
    !shown.ledgerPromised &&
    (res.waitPartsHours >= CERTAIN_LEDGERED_HOURS ||
      res.waitApprovalHours >= CERTAIN_LEDGERED_HOURS);
  return { hours, undisclosedWait, any: hours || undisclosedWait };
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
  // the few seconds spent in this modal aren't lost — they just aren't shown
  // HERE. They are shown afterwards: when the saved figure differs from this
  // frozen projection, the post-save step restates what actually landed on the
  // RO (see saveDivergence). The freeze stays; the silence about it doesn't.
  const [elapsed] = useState(() => elapsedFor(slot, Date.now(), capAt));

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const valid = slot.lineId && entry.opCodes.some((l) => l.id === slot.lineId);
    return valid ? slot.lineId : (entry.opCodes[0]?.id ?? null);
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<TimerSaveResult | null>(null);
  const [pending, startPending] = useTransition();

  const workHours = msToHours(elapsed.work);
  const selected = entry.opCodes.find((l) => l.id === selectedId) ?? null;
  const existing = selected?.actualHours ?? null;
  const newTotal = Math.round(((existing ?? 0) + workHours) * 100) / 100;
  const ledgerPromised =
    isLedgerableHold(elapsed.holdParts) || isLedgerableHold(elapsed.holdApproval);

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
        // Three reasons to stop instead of closing straight out:
        //   - the unpaid ledger didn't write (the worked hours still did),
        //   - the server banked a different figure than the frozen projection,
        //   - waiting time earned a ledger row this modal never promised.
        // Otherwise the screen already said the truth, and an extra tap on
        // every close-out is friction for nothing.
        const divergence = saveDivergence(res, {
          workHours,
          newTotal,
          ledgerPromised,
        });
        if (!res.ledgerWritten || divergence.any) {
          setSaved(res);
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

  if (saved) {
    const divergence = saveDivergence(saved, {
      workHours,
      newTotal,
      ledgerPromised,
    });
    // Only name a hold whose returned hours PROVE a row was written; see
    // CERTAIN_LEDGERED_HOURS.
    const undisclosed = [
      saved.waitPartsHours >= CERTAIN_LEDGERED_HOURS
        ? `${fmtHours2(saved.waitPartsHours)}h waiting on parts`
        : null,
      saved.waitApprovalHours >= CERTAIN_LEDGERED_HOURS
        ? `${fmtHours2(saved.waitApprovalHours)}h waiting on approval`
        : null,
    ]
      .filter(Boolean)
      .join(" and ");
    return (
      <Modal
        open
        onClose={onClose}
        title={saved.ledgerWritten ? "Saved" : "Saved with a warning"}
      >
        <div className="space-y-4">
          {!saved.ledgerWritten && (
            <p className="rounded-[var(--radius-sm)] bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn)]">
              Saved the worked hours, but the waiting time couldn&apos;t be
              recorded — the unpaid-time table isn&apos;t set up yet.
            </p>
          )}
          {/* What the SERVER wrote — not the frozen projection above. These are
           * the values saveTimerAction returned, recomputed from persisted
           * accumulators at submit time. */}
          <div className="card-inset" style={{ padding: 12 }}>
            <p className="text-sm text-[var(--fg-1)]">
              Saved{" "}
              <strong className="font-mono text-[var(--fg-0)]">
                {fmtHours2(saved.workHours)}h
              </strong>{" "}
              to this line — it now totals{" "}
              <strong className="font-mono text-[var(--fg-0)]">
                {fmtHours2(saved.totalHours)}h
              </strong>
              .
            </p>
            {divergence.hours && (
              <p className="mt-2 text-xs text-[var(--fg-3)]">
                That isn&apos;t the {fmtHours2(workHours)}h this window showed —
                the clock kept running while it was open, and the timer banks
                what actually elapsed. The figure above is what&apos;s on the
                RO.
              </p>
            )}
            {divergence.undisclosedWait && undisclosed && (
              <p className="mt-2 text-xs text-[var(--warn)]">
                {undisclosed} was also banked and logged as unpaid time against
                this RO. It never touches your flag hours.
              </p>
            )}
          </div>
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
          {/* Only promise a ledger row when one will actually be written.
           * The save action drops holds under MIN_LEDGERED_HOLD_MS, so a
           * 20-second hold shows its time above but earns no row — saying it
           * was logged would be a lie on the way to a money document. */}
          {ledgerPromised && (
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
                      {fmtHours2(workHours)}h
                    </strong>
                    .
                  </>
                ) : (
                  <>
                    <span className="font-mono">{fmtHours2(existing)}h</span> +{" "}
                    <span className="font-mono">{fmtHours2(workHours)}h</span> ={" "}
                    <strong className="font-mono text-[var(--fg-0)]">
                      {fmtHours2(newTotal)}h
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
