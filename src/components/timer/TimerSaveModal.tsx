"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { fmtHours2 } from "@/lib/format";
import { saveTimerAction, type TimerSaveResult } from "@/app/actions/timer";
import { getTicketTimelineAction } from "@/app/actions/open-tickets";
import { ticketOpenWorkHours } from "@/lib/open-tickets";
import {
  elapsedFor,
  formatDuration,
  formatElapsed,
  isAccruing,
  isHold,
  isLedgerableHold,
  msToHours,
  type TimerSlot,
} from "@/lib/timer";
import { useTickingNow } from "@/lib/use-ticking-now";
import { tap } from "@/lib/haptics";
import { actionErrorMessage } from "@/lib/action-error";

// Closing out a timer. Two things happen and the modal has to be honest about
// both: worked time is ADDED to an op-code line (jobs span sessions, so
// replacing silently discarded the earlier half), and any waiting time is
// banked to the unpaid-time ledger under the reason it was waited for.

export type ShownFigures = {
  /** Worked hours the modal froze and the tech approved. */
  workHours: number;
  /** The line total the modal projected from its (possibly stale) copy. */
  newTotal: number;
  /** Whether the modal promised a ledger row for that hold before saving. */
  partsPromised: boolean;
  approvalPromised: boolean;
};

export type SaveDivergence = {
  /** The server banked different WORKED hours than the frozen projection —
   * the clock genuinely kept running while the modal was open. */
  addedHours: boolean;
  /** Worked hours agree, but the line's running total doesn't: the client's
   * copy of `actualHours` was stale. Kept separate from `addedHours` because
   * the CAUSE is different, and the old lumped flag printed "the clock kept
   * running" over a divergence that happened in the baseline — a false reason
   * on a money document, next to two identical numbers. */
  baselineTotal: boolean;
  /** A ledger row exists for that hold and the modal never promised one. */
  undisclosedParts: boolean;
  undisclosedApproval: boolean;
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
 * which one landed on the RO. This is what decides whether the post-save
 * receipt has anything new to say, and WHICH true sentence it says.
 *
 * The wait disclosures read the server's `...Ledgered` booleans rather than
 * comparing rounded hours to a threshold: 0.01h spans 18s–54s and the 30s gate
 * sits inside it, so hours alone can neither prove nor disprove a row. The
 * server applies the gate and now reports its own verdict.
 *
 * Exported so the divergence rule is testable without driving the whole modal.
 */
export function saveDivergence(
  res: Pick<
    TimerSaveResult,
    | "workHours"
    | "totalHours"
    | "waitPartsLedgered"
    | "waitApprovalLedgered"
  >,
  shown: ShownFigures,
): SaveDivergence {
  const addedHours = res.workHours !== shown.workHours;
  const baselineTotal = !addedHours && res.totalHours !== shown.newTotal;
  const undisclosedParts = !shown.partsPromised && res.waitPartsLedgered;
  const undisclosedApproval =
    !shown.approvalPromised && res.waitApprovalLedgered;
  const undisclosedWait = undisclosedParts || undisclosedApproval;
  return {
    addedHours,
    baselineTotal,
    undisclosedParts,
    undisclosedApproval,
    undisclosedWait,
    any: addedHours || baselineTotal || undisclosedWait,
  };
}

/**
 * Everything the post-save receipt needs, captured at save time.
 *
 * It travels to a component OUTSIDE the timer list because the save that
 * produces it deletes the slot: see TimerSaveReceipt.
 */
export type TimerSaveReceiptData = {
  roNumber: string;
  result: TimerSaveResult;
  shown: ShownFigures;
};

/**
 * The post-save receipt — what the server actually wrote.
 *
 * Deliberately NOT rendered by TimerSaveModal, even though that is where its
 * data is produced. saveTimerAction deletes the timer slot and revalidates
 * /timer, and TimerSlots mounts the modal only while the slot is still in its
 * server props (`slots.find(...)`). So the modal — and any state it held —
 * unmounts the instant the receipt becomes relevant: the confirmation was torn
 * down by the very save it was confirming, and the tech never learned that the
 * row said 0.32h. Owned by the parent, whose lifetime the revalidate does not
 * touch, this survives until it is dismissed by hand.
 */
export function TimerSaveReceipt({
  receipt,
  onClose,
}: {
  receipt: TimerSaveReceiptData;
  onClose: () => void;
}) {
  const { result: saved, shown, roNumber } = receipt;
  const divergence = saveDivergence(saved, shown);
  // Name a hold only when the server says a row was written for it.
  const undisclosed = [
    divergence.undisclosedParts
      ? `${fmtHours2(saved.waitPartsHours)}h waiting on parts`
      : null,
    divergence.undisclosedApproval
      ? `${fmtHours2(saved.waitApprovalHours)}h waiting on approval`
      : null,
  ]
    .filter(Boolean)
    .join(" and ");

  // The title is the part a tech actually reads before tapping Done. A bare
  // "Saved" over a body paragraph announcing unpaid time nobody was warned
  // about is technically true and hides the only new fact on the screen. Say it
  // in the title instead. Not "warning" — the ledger write SUCCEEDED here, and
  // banking real waiting time is the feature working; this is the "here's what
  // actually got recorded" state, and only the failed-write case is a warning.
  const title = !saved.ledgerWritten
    ? "Saved with a warning"
    : divergence.undisclosedWait
      ? "Saved — unpaid time also logged"
      : "Saved";

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-4">
        {!saved.ledgerWritten && (
          <p className="rounded-[var(--radius-sm)] bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn)]">
            Saved the worked hours, but the waiting time couldn&apos;t be
            recorded — the unpaid-time table isn&apos;t set up yet.
          </p>
        )}
        {/* What the SERVER wrote — not the frozen projection the modal showed.
         * These are the values saveTimerAction returned, recomputed from
         * persisted accumulators at submit time. Wording forks on `target`
         * (Open Tickets Phase 2): a lineless ticket has no "line" to name, and
         * saying so would be a lie on a money document. */}
        <div className="card-inset" style={{ padding: 12 }}>
          <p className="text-sm text-[var(--fg-1)]">
            {saved.target === "ticket" ? (
              <>
                Saved{" "}
                <strong className="font-mono text-[var(--fg-0)]">
                  {fmtHours2(saved.workHours)}h
                </strong>{" "}
                to open ticket RO #{roNumber} — the ticket now totals{" "}
                <strong className="font-mono text-[var(--fg-0)]">
                  {fmtHours2(saved.totalHours)}h
                </strong>
                .
              </>
            ) : (
              <>
                Saved{" "}
                <strong className="font-mono text-[var(--fg-0)]">
                  {fmtHours2(saved.workHours)}h
                </strong>{" "}
                to RO #{roNumber} — that line now totals{" "}
                <strong className="font-mono text-[var(--fg-0)]">
                  {fmtHours2(saved.totalHours)}h
                </strong>
                .
              </>
            )}
          </p>
          {/* Two different causes, two different sentences. Printing the
           * clock-kept-running line over a stale-baseline divergence restated
           * the frozen figure — which equals the headline — and blamed
           * something that didn't happen. */}
          {divergence.addedHours && (
            <p className="mt-2 text-xs text-[var(--fg-3)]">
              That isn&apos;t the {fmtHours2(shown.workHours)}h this window
              showed — the clock kept running while it was open, and the timer
              banks what actually elapsed. The figure above is what&apos;s on
              the RO.
            </p>
          )}
          {divergence.baselineTotal && (
            <p className="mt-2 text-xs text-[var(--fg-3)]">
              The {fmtHours2(saved.workHours)}h added is exactly what this
              window showed, but {saved.target === "ticket" ? "that ticket" : "the line"}{" "}
              already had time on it that this window didn&apos;t know about.
              The total above is what&apos;s on the RO.
            </p>
          )}
          {undisclosed && (
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
  onSaved,
}: {
  slot: TimerSlot;
  entry: Entry;
  library: OpCode[];
  capAt: number | null;
  onClose: () => void;
  /**
   * The save landed. `receipt` is non-null only when the server wrote
   * something this screen didn't already say — the parent renders it, because
   * this component is about to be unmounted by the revalidate (see
   * TimerSaveReceipt). The parent also owns the refresh, so no state update
   * outlives this modal.
   */
  onSaved: (receipt: TimerSaveReceiptData | null) => void;
}) {
  const libraryById = useMemo(
    () => new Map(library.map((oc) => [oc.id, oc])),
    [library],
  );

  // The WORKED total is frozen at open rather than ticking: the headline figure
  // being reviewed can't move while you're reading it. The server recomputes
  // from persisted state on save, so the few seconds spent in this modal aren't
  // lost — they just aren't shown HERE. They are shown afterwards: when the
  // saved figure differs from this frozen projection, TimerSaveReceipt restates
  // what actually landed on the RO (see saveDivergence). The freeze stays; the
  // silence about it doesn't. See lib/timer.ts MIN_LEDGERED_HOLD_MS.
  const [openedAt] = useState(() => Date.now());
  const [frozen] = useState(() => elapsedFor(slot, openedAt, capAt));

  // The HOLD figures do NOT get that freeze, because they carry a promise the
  // worked total doesn't. "Waiting time is logged as unpaid time against this
  // RO" is printed only once a hold clears MIN_LEDGERED_HOLD_MS — and the
  // server re-applies that same gate to LIVE accumulators at commit
  // (saveTimerAction → isLedgerableHold(w.rawMs)). Leave this modal open across
  // the 30s boundary of a RUNNING hold and the frozen copy still read "0m" and
  // promised nothing while the row got written anyway: honest hours, disclosed
  // only afterwards by the receipt, and a confusing two-step for the tech.
  // Re-deriving on a tick makes what's on screen agree with what will commit.
  //
  // Direction matters, and it is the whole safety argument: elapsedFor only
  // ever ADDS the in-flight segment, so a live re-derive can turn a promise ON
  // and can never withdraw one. Nothing here gates anything either — the modal
  // takes no timing data to the server, which re-derives everything itself, so
  // this is display-only by construction. Suppressing a row because a render
  // said "0m" would drop real waiting time off a money document; that decision
  // lives in actions/timer.ts and stays there.
  //
  // Only ticks while a hold is actually accruing: a paused slot, or one banking
  // WORK time, has no hold figure that can move, and re-rendering this list
  // every second for nothing is churn on a page that can have three timers up.
  const holdRunning = isAccruing(slot) && isHold(slot.status);
  const tickedNow = useTickingNow(holdRunning);
  // useTickingNow returns null until it has mounted (SSR/hydration honesty —
  // see the hook). Falling back to `openedAt` means the first render is exactly
  // the frozen snapshot rather than a smaller number that drops the in-flight
  // segment and then jumps. The hook owns its interval's teardown: unmounting
  // this modal terminates the worker and drops the visibility listeners.
  const live = elapsedFor(slot, tickedNow ?? openedAt, capAt);
  // Read `frozen` for worked time and `live` for holds, deliberately and
  // explicitly, so neither can be swapped for the other by accident.
  const holdParts = live.holdParts;
  const holdApproval = live.holdApproval;

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const valid = slot.lineId && entry.opCodes.some((l) => l.id === slot.lineId);
    return valid ? slot.lineId : (entry.opCodes[0]?.id ?? null);
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  // Open Tickets Phase 2 (plan "Timer (Phase 2)", decision 4/10): an open
  // ticket has no lines, so there is no line to pick — its hours go on the
  // ticket itself. `entry` here is the same server-fetched copy the rest of
  // the modal already uses, so this reads the ticket's true opCodes.length,
  // not a client guess.
  const isOpenTicket = entry.status === "open" && entry.opCodes.length === 0;

  // The ticket's running open_work total, fetched once on mount so the modal
  // can show "2.5h + 1.2h = 3.7h" the same way the line path shows a line
  // total. null while loading; treated as 0 if the fetch fails outright —
  // the server recomputes the real figure at save regardless, so a stale or
  // missing preview here can under-promise but never mis-save.
  const [ticketTotal, setTicketTotal] = useState<number | null>(null);
  useEffect(() => {
    if (!isOpenTicket) return;
    let cancelled = false;
    getTicketTimelineAction(entry.id)
      .then((timeline) => {
        if (!cancelled) setTicketTotal(ticketOpenWorkHours(timeline.ledger, entry.id));
      })
      .catch(() => {
        if (!cancelled) setTicketTotal(0);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpenTicket, entry.id]);

  const workHours = msToHours(frozen.work);
  const selected = entry.opCodes.find((l) => l.id === selectedId) ?? null;
  const existing = selected?.actualHours ?? null;
  const newTotal = isOpenTicket
    ? Math.round(((ticketTotal ?? 0) + workHours) * 100) / 100
    : Math.round(((existing ?? 0) + workHours) * 100) / 100;
  // Per hold reason, not lumped: promising a row for the parts hold must not
  // silence a disclosure about an approval hold that only crossed the 30s gate
  // later. Derived from the LIVE hold ms so this is the promise the screen is
  // making right now — which is what saveDivergence must compare the server's
  // verdict against. A promise read off a stale snapshot made the receipt
  // announce a row the tech had just been told wasn't coming.
  const shown: ShownFigures = {
    workHours,
    // The projected TICKET total when there's no line — saveDivergence
    // compares this against res.totalHours regardless of which target
    // produced it, so this has to already be the right kind of number.
    newTotal,
    partsPromised: isLedgerableHold(holdParts),
    approvalPromised: isLedgerableHold(holdApproval),
  };
  const ledgerPromised = shown.partsPromised || shown.approvalPromised;

  function handleSave() {
    // A lineless open ticket has nothing to pick — the save button is enabled
    // with no selection and saves straight to the ticket (decision 4/10).
    if (!isOpenTicket && !selected) {
      setError("Pick an op code first.");
      return;
    }
    setError(null);
    startPending(async () => {
      try {
        const res = await saveTimerAction(slot.id, isOpenTicket ? null : (selected?.id ?? null));
        tap();
        // Three reasons the tech still needs a receipt:
        //   - the unpaid ledger didn't write (the worked hours still did),
        //   - the server banked a different figure than the frozen projection,
        //   - waiting time earned a ledger row this modal never promised.
        // Otherwise the screen already said the truth, and an extra tap on
        // every close-out is friction for nothing.
        const divergence = saveDivergence(res, shown);
        const needsReceipt = !res.ledgerWritten || divergence.any;
        onSaved(
          needsReceipt
            ? { roNumber: entry.roNumber, result: res, shown }
            : null,
        );
      } catch (err) {
        setError(actionErrorMessage(err, "Failed to save."));
      }
    });
  }

  return (
    <Modal open onClose={onClose} title={`Close out RO #${entry.roNumber}`}>
      <div className="space-y-4">
        {/* What's being banked, before anything is chosen. */}
        <div className="card-inset" style={{ padding: 12 }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-[var(--fg-2)]">Worked</span>
            <span className="font-mono text-sm text-[var(--fg-0)]">
              {formatElapsed(frozen.work)} · {fmtHours(workHours)}h
            </span>
          </div>
          {holdParts > 0 && (
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm text-[var(--warn)]">Waiting on parts</span>
              <span className="font-mono text-sm text-[var(--warn)]">
                {formatDuration(holdParts)}
              </span>
            </div>
          )}
          {holdApproval > 0 && (
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm text-[var(--info)]">Waiting on approval</span>
              <span className="font-mono text-sm text-[var(--info)]">
                {formatDuration(holdApproval)}
              </span>
            </div>
          )}
          {/* Only promise a ledger row when one will actually be written.
           * The save action drops holds under MIN_LEDGERED_HOLD_MS, so a
           * 20-second hold shows its time above but earns no row — saying it
           * was logged would be a lie on the way to a money document. Live, not
           * frozen: a hold still running crosses that gate while this modal is
           * open, and the promise has to appear when it does. */}
          {ledgerPromised && (
            <p className="mt-2 text-xs text-[var(--fg-3)]">
              Waiting time is logged as unpaid time against this RO. It never
              touches your flag hours.
            </p>
          )}
        </div>

        {isOpenTicket ? (
          <>
            {/* An open ticket has no lines BY DESIGN (decision 4/10) — its
                worked hours land on the ticket's own open_work ledger instead
                of a line, additive across every session the same way a
                line's actual hours are. */}
            <p className="text-xs text-[var(--fg-3)]">
              Hours go on the ticket&apos;s timeline as a day of work —
              they&apos;re added to what the ticket already has.
            </p>
            {workHours > 0 && (
              <p className="text-sm text-[var(--fg-2)]">
                {ticketTotal === null ? (
                  "Checking this ticket's hours so far…"
                ) : ticketTotal === 0 ? (
                  <>
                    This ticket has no hours yet — it becomes{" "}
                    <strong className="text-[var(--fg-0)]">
                      {fmtHours2(workHours)}h
                    </strong>
                    .
                  </>
                ) : (
                  <>
                    <span className="font-mono">{fmtHours2(ticketTotal)}h</span>{" "}
                    + <span className="font-mono">{fmtHours2(workHours)}h</span>{" "}
                    ={" "}
                    <strong className="font-mono text-[var(--fg-0)]">
                      {fmtHours2(newTotal)}h
                    </strong>{" "}
                    on this ticket.
                  </>
                )}
              </p>
            )}
          </>
        ) : entry.opCodes.length === 0 ? (
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
            disabled={pending || (!isOpenTicket && !selected)}
          >
            {pending ? "Saving…" : "Save & close timer"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
