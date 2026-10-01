"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wrench } from "lucide-react";
import type { Entry, NewEntry, OpCode, RoTemplate } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import {
  attachRoToExistingTimerAction,
  attachRoToTimerAction,
  releaseTimerAction,
  resetTimerAction,
  setTimerLineAction,
  setTimerStatusAction,
  startTimerWithoutRoAction,
} from "@/app/actions/timer";
import { saveEntry } from "@/app/actions/entries";
import { isAccruing, MAX_TIMER_SLOTS, type TimerSlot } from "@/lib/timer";
import {
  TimerSaveModal,
  TimerSaveReceipt,
  type TimerSaveReceiptData,
} from "./TimerSaveModal";
import { FreeSlot, TimerSlotCard, TimerSteps, lineLabelFor, vehicleLabel } from "./TimerSlotCard";
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusField } from "@/components/ui/StatusField";
import { Zone } from "@/components/ui/Zone";
import { LogRoForm } from "@/components/forms/LogRoForm";
import { tap } from "@/lib/haptics";
import { useTickingNow } from "@/lib/use-ticking-now";
import { actionErrorMessage } from "@/lib/action-error";

// The signed-in timer page. Up to MAX_TIMER_SLOTS jobs run at once, because a
// bay does: one car on the lift, one waiting on parts, one waiting on an
// approval. Card markup is shared with the guest mirror via TimerSlotCard.

// Slot numbers 1..MAX, so free bays can be drawn where a timer would be.
const FREE_SLOTS = Array.from({ length: MAX_TIMER_SLOTS }, (_, i) => i + 1);

export function TimerSlots({
  slots,
  attachedEntries,
  caps,
  recentEntries,
  library,
  roTemplates,
}: {
  slots: TimerSlot[];
  /** Entries for the ROs currently on timers — may include ROs outside the
   * recent window, so they're fetched separately by the page. */
  attachedEntries: Entry[];
  /** Slot id → auto-stop deadline (epoch ms), or null when uncapped. */
  caps: Record<string, number | null>;
  recentEntries: Entry[];
  library: OpCode[];
  roTemplates: RoTemplate[];
}) {
  const router = useRouter();
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [logRoOpen, setLogRoOpen] = useState(false);
  const [pickRoOpen, setPickRoOpen] = useState(false);
  const [detailEntry, setDetailEntry] = useState<Entry | null>(null);
  const [saveSlotId, setSaveSlotId] = useState<string | null>(null);
  // The post-save receipt lives HERE, not in TimerSaveModal, because saving
  // deletes the slot: the revalidated server props drop it, `saveSlot` goes
  // null, and the modal unmounts with whatever it was trying to tell the tech.
  // This component is what the revalidate re-renders rather than replaces, so
  // state parked here outlives the save that produced it and the receipt is
  // dismissed by hand.
  const [receipt, setReceipt] = useState<TimerSaveReceiptData | null>(null);
  const [linePickSlotId, setLinePickSlotId] = useState<string | null>(null);
  // Set when attaching a SECOND timer to an RO that already has one running:
  // that case has to choose its line before the timer starts.
  const [attachLineEntry, setAttachLineEntry] = useState<Entry | null>(null);
  // Set when the picker was opened from a no-RO slot's "Attach RO": the chosen
  // RO then binds to THAT slot (keeping its time) instead of claiming a new one.
  const [attachTargetId, setAttachTargetId] = useState<string | null>(null);

  // Only tick when something is actually banking time — a page full of paused
  // timers has no reason to re-render every second.
  const now = useTickingNow(slots.some(isAccruing));

  const libraryById = useMemo(
    () => new Map(library.map((oc) => [oc.id, oc])),
    [library],
  );
  const entryById = useMemo(
    () => new Map(attachedEntries.map((e) => [e.id, e])),
    [attachedEntries],
  );
  // What each RO already has running, line by line. The picker used to reduce
  // this to a flat set of entry ids and drop those ROs from the list entirely,
  // which refused a legal second timer (a different line of the same RO) and
  // refused it silently — the job simply wasn't there to find.
  const slotsByEntry = useMemo(() => {
    const m = new Map<string, { lineIds: Set<string>; hasUnassigned: boolean }>();
    for (const s of slots) {
      if (!s.entryId) continue;
      const cur = m.get(s.entryId) ?? { lineIds: new Set<string>(), hasUnassigned: false };
      if (s.lineId) cur.lineIds.add(s.lineId);
      else cur.hasUnassigned = true;
      m.set(s.entryId, cur);
    }
    return m;
  }, [slots]);

  /**
   * Why this RO can't take another timer right now, or null if it can.
   * Whatever this returns gets shown to the tech — a refusal the picker won't
   * explain is the bug being fixed here.
   */
  function attachBlockReason(entry: Entry): string | null {
    const taken = slotsByEntry.get(entry.id);
    if (!taken) return null;
    // An open, lineless ticket (Open Tickets Phase 2) has no line dimension to
    // split across — it can only ever occupy one slot, full stop. The
    // "hasn't been assigned a line yet" wording below doesn't apply to it: a
    // lineless ticket's slot is never going to get a line.
    if (entry.opCodes.length === 0) return "Already on a timer.";
    if (taken.hasUnassigned) {
      return "On a timer that has no line set yet — set that one's line first.";
    }
    const free = entry.opCodes.filter((l) => !taken.lineIds.has(l.id));
    if (free.length === 0) {
      return entry.opCodes.length === 1
        ? "Its only line is already on a timer."
        : "Every line is already on a timer.";
    }
    return null;
  }

  function freeLinesFor(entry: Entry) {
    const taken = slotsByEntry.get(entry.id);
    return entry.opCodes.filter((l) => !taken?.lineIds.has(l.id));
  }

  const slotsUsed = slots.length;

  function run(action: () => Promise<unknown>) {
    setError(null);
    startPending(async () => {
      try {
        const res = await action();
        // The no-RO actions return their refusal instead of throwing (a thrown
        // message is masked in production). Show it; nothing changed.
        if (res && typeof res === "object" && "error" in res && res.error) {
          setError(String(res.error));
          return;
        }
        router.refresh();
      } catch (err) {
        setError(actionErrorMessage(err, "Failed."));
      }
    });
  }

  /** Put an RO on a timer: a new slot, or — from a no-RO slot's "Attach RO" —
   * that slot, with its banked time and status kept. */
  function attachTo(entryId: string, lineId: string | null): Promise<unknown> {
    const target = attachTargetId;
    setAttachTargetId(null);
    return target
      ? attachRoToExistingTimerAction(target, entryId, lineId)
      : attachRoToTimerAction(entryId, lineId);
  }

  function closePicker() {
    setPickRoOpen(false);
    setAttachTargetId(null);
  }

  function handleAttach(entry: Entry) {
    const free = freeLinesFor(entry);
    const alreadyRunning = slotsByEntry.has(entry.id);

    // A second timer on the same RO must name its line before it starts: left
    // unset it could later be pointed at the line already in flight, and hours
    // bank additively. The server refuses it too — this just asks first.
    if (alreadyRunning && free.length > 1) {
      setAttachLineEntry(entry);
      return;
    }

    // One line to choose from? Bind it now so the tech never has to pick.
    // Several, on an RO with nothing running? Leave it unset and let the card
    // prompt — guessing would silently log a brake job's hours against an oil
    // change.
    const lineId =
      free.length === 1 ? free[0].id
      : entry.opCodes.length === 1 ? entry.opCodes[0].id
      : null;
    setPickRoOpen(false);
    run(() => attachTo(entry.id, lineId));
  }

  async function handleLogRoSave(input: NewEntry) {
    const saved = await saveEntry(input);
    if ("error" in saved) throw new Error(saved.error);
    const res = await attachTo(
      saved.id,
      saved.opCodes.length === 1 ? saved.opCodes[0].id : null,
    );
    if (res && typeof res === "object" && "error" in res && res.error) {
      throw new Error(String(res.error));
    }
    setLogRoOpen(false);
  }

  const saveSlot = slots.find((s) => s.id === saveSlotId) ?? null;
  const saveEntryFor = saveSlot?.entryId ? entryById.get(saveSlot.entryId) : null;
  const linePickSlot = slots.find((s) => s.id === linePickSlotId) ?? null;
  const linePickEntry = linePickSlot?.entryId
    ? entryById.get(linePickSlot.entryId)
    : null;

  // Every recent RO stays in the list. One that can't take a timer is shown
  // disabled with the reason underneath, rather than being removed — a tech
  // looking for a job they know they logged must never find a blank space
  // where it should be.
  const pickerEntries = recentEntries.map((e) => ({
    entry: e,
    blocked: attachBlockReason(e),
  }));
  const anyAttachable = pickerEntries.some((p) => p.blocked === null);

  return (
    <main className="tmr-page">
      <div className="pagehead">
        <div className="grow">
          <h1>Timers</h1>
          <p>
            <span className="num">{slotsUsed}</span> of <span className="num">{MAX_TIMER_SLOTS}</span>{" "}
            slots in use
          </p>
        </div>
      </div>

      {error && (
        <StatusField tag="Fix" role="alert">
          {error}
        </StatusField>
      )}

      {slots.length === 0 ? (
        <Zone name="Timers" className="tmr-empty">
          <EmptyState
            icon={<Wrench size={22} />}
            title="No timers running"
            description={`Put a car on a timer and its time lands on the RO. You can run up to ${MAX_TIMER_SLOTS} at once — one on the lift, one waiting on parts.`}
            action={
              <Button
                variant="go"
                onClick={() => {
                  setAttachTargetId(null);
                  setPickRoOpen(true);
                }}
                disabled={pending}
              >
                <Plus size={16} aria-hidden="true" />
                Start a timer
              </Button>
            }
          />
          <TimerSteps />
        </Zone>
      ) : (
        <>
          <p className="scale-note tmr-scale">
            <i aria-hidden="true" />
            Bar is worked time. This length is 1.0 hour.
          </p>
          <div className="tmr-slots">
            {slots.map((slot) => (
              <TimerSlotCard
                key={slot.id}
                slot={slot}
                entry={slot.entryId ? (entryById.get(slot.entryId) ?? null) : null}
                capAt={caps[slot.id] ?? null}
                now={now}
                libraryById={libraryById}
                pending={pending}
                onStatus={(status) => {
                  tap();
                  run(() => setTimerStatusAction(slot.id, status));
                }}
                onReset={() => run(() => resetTimerAction(slot.id))}
                onRelease={() => run(() => releaseTimerAction(slot.id))}
                onSave={() => setSaveSlotId(slot.id)}
                onPickLine={() => setLinePickSlotId(slot.id)}
                onAttachRo={() => {
                  setAttachTargetId(slot.id);
                  setPickRoOpen(true);
                }}
                onOpenDetail={setDetailEntry}
              />
            ))}
            {FREE_SLOTS.filter((n) => !slots.some((s) => s.slot === n)).map((n) => (
              <FreeSlot
                key={`free-${n}`}
                slot={n}
                onStart={() => {
                  setAttachTargetId(null);
                  setPickRoOpen(true);
                }}
                disabled={pending}
              />
            ))}
          </div>
        </>
      )}

      {/* Attach-an-RO picker */}
      {pickRoOpen && (
        <Modal
          open
          onClose={closePicker}
          title="Put an RO on a timer"
          footer={
            <>
              <Button
                block
                variant={recentEntries.length > 0 && anyAttachable ? "line" : "go"}
                onClick={() => {
                  setPickRoOpen(false);
                  setLogRoOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Log a new RO
              </Button>
              {/* The RO can come later; saving the time still needs one. Not
                  offered from a slot that is already running. */}
              {!attachTargetId && (
                <Button
                  block
                  variant="quiet"
                  disabled={pending}
                  onClick={() => {
                    setPickRoOpen(false);
                    run(() => startTimerWithoutRoAction());
                  }}
                >
                  Start without an RO
                </Button>
              )}
            </>
          }
        >
          <div className="tmd-body">
            {recentEntries.length === 0 ? (
              <StatusField tag="Note" inset>
                The timer clocks against an RO — log one first.
              </StatusField>
            ) : (
              <>
                {!anyAttachable && (
                  <StatusField tag="Note" inset>
                    Every line of every recent RO is already on a timer.
                  </StatusField>
                )}
                <div className="log-picks">
                  {pickerEntries.map(({ entry: e, blocked }) => {
                    const vehicle = vehicleLabel(e);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => handleAttach(e)}
                        disabled={pending || blocked !== null}
                        className="log-pick tmd-pick"
                      >
                        <span className="log-pick-txt">
                          <span className="tmd-pick-head">
                            <span className="tmd-ro">#{e.roNumber}</span>
                            <span className="tmd-date">{formatDateShort(e.date)}</span>
                          </span>
                          {vehicle && <span className="log-pick-desc">{vehicle}</span>}
                          {blocked && <span className="log-pick-desc tmd-block">{blocked}</span>}
                        </span>
                        <span className="log-pick-act">{fmtHours(e.flagHours)}h</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Save */}
      {saveSlot && saveEntryFor && (
        <TimerSaveModal
          slot={saveSlot}
          entry={saveEntryFor}
          library={library}
          capAt={caps[saveSlot.id] ?? null}
          onClose={() => setSaveSlotId(null)}
          onSaved={(r) => {
            setSaveSlotId(null);
            setReceipt(r);
            // Owned here so the refresh that unmounts the modal can't race a
            // state update inside it.
            router.refresh();
          }}
        />
      )}

      {/* What the server actually wrote. Not nested in the block above: that
          one is gone by the time this matters. */}
      {receipt && (
        <TimerSaveReceipt receipt={receipt} onClose={() => setReceipt(null)} />
      )}

      {/* RO detail */}
      {detailEntry && (
        <RoDetailModal
          entry={detailEntry}
          library={library}
          onClose={() => setDetailEntry(null)}
        />
      )}

      {/* Line picker */}
      {/* Second timer on an RO that already has one running: choose the line
          up front. Only the free lines are offered, so this can't collide with
          the timer already in flight. */}
      {attachLineEntry && (
        <Modal
          open
          onClose={() => setAttachLineEntry(null)}
          title={`RO #${attachLineEntry.roNumber} — Which line?`}
        >
          <div className="tmd-body">
            <p className="tmd-fine">
              This RO already has a timer running. Pick the line this second
              timer is for — its hours land on that line only.
            </p>
            <div className="log-picks">
              {freeLinesFor(attachLineEntry).map((line) => {
                const { code, description } = lineLabelFor(line, libraryById);
                return (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => {
                      const entryId = attachLineEntry.id;
                      setAttachLineEntry(null);
                      setPickRoOpen(false);
                      run(() => attachTo(entryId, line.id));
                    }}
                    disabled={pending}
                    className="log-pick tmd-pick"
                  >
                    <span className="log-pick-txt">
                      <span className="tmd-pick-head">
                        <Badge chip mono>{code}</Badge>
                        {line.custom && <Badge>Other</Badge>}
                      </span>
                      {description && <span className="log-pick-desc">{description}</span>}
                    </span>
                    <span className="log-pick-act">{fmtHours(line.flagHours)}h</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {linePickSlot && linePickEntry && (
        <Modal
          open
          onClose={() => setLinePickSlotId(null)}
          title={`RO #${linePickEntry.roNumber} — Pick a line`}
        >
          <div className="tmd-body">
            <p className="tmd-fine">
              Which line should this timer&apos;s worked hours land on?
            </p>
            <div className="log-picks">
              {linePickEntry.opCodes.map((line) => {
                const { code, description } = lineLabelFor(line, libraryById);
                // Taken by a DIFFERENT slot on this same RO. Now that one RO
                // can hold several timers, this is reachable — and it is the
                // one combination that would double-count.
                const takenElsewhere = slots.some(
                  (s) =>
                    s.id !== linePickSlot.id &&
                    s.entryId === linePickEntry.id &&
                    s.lineId === line.id,
                );
                return (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => {
                      setLinePickSlotId(null);
                      run(() => setTimerLineAction(linePickSlot.id, line.id));
                    }}
                    disabled={takenElsewhere}
                    className="log-pick tmd-pick"
                  >
                    <span className="log-pick-txt">
                      <span className="tmd-pick-head">
                        <Badge chip mono>{code}</Badge>
                        {line.custom && <Badge>Other</Badge>}
                      </span>
                      {description && <span className="log-pick-desc">{description}</span>}
                      {takenElsewhere && (
                        <span className="log-pick-desc tmd-block">Already on another timer.</span>
                      )}
                    </span>
                    <span className="log-pick-act">{fmtHours(line.flagHours)}h</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {/* Log RO: the full form in a wide panel. LogRoForm has its own sticky
          save bar, so the Modal gets no footer. */}
      {logRoOpen && (
        <Modal
          open
          onClose={() => {
            setLogRoOpen(false);
            setAttachTargetId(null);
          }}
          title="Log New RO"
          size="xl"
        >
          <div className="tmd-logro">
            <LogRoForm
              initialOpCodes={library}
              roTemplates={roTemplates}
              onSave={handleLogRoSave}
              redirectTo="/timer"
              checkDuplicates
            />
          </div>
        </Modal>
      )}
    </main>
  );
}
