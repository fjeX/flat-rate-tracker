"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Wrench } from "lucide-react";
import { useGuestStore } from "@/lib/guest/context";
import { fmtHours } from "@/lib/stats";
import { fmtHours2 } from "@/lib/format";
import { formatDateShort } from "@/lib/periods";
import type { Entry, OpCode } from "@/lib/types";
import {
  elapsedFor,
  formatDuration,
  formatElapsed,
  isAccruing,
  MAX_TIMER_SLOTS,
  msToHours,
  type TimerSlot,
} from "@/lib/timer";
import {
  FreeSlot,
  TimerSlotCard,
  TimerSteps,
  lineLabelFor,
  vehicleLabel,
} from "@/components/timer/TimerSlotCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusField } from "@/components/ui/StatusField";
import { Zone } from "@/components/ui/Zone";
import { tap } from "@/lib/haptics";
import { useTickingNow } from "@/lib/use-ticking-now";

// Guest mirror of the timer page. Same 3 slots, same statuses, same card —
// it's the clearest demo of what the app actually does, and sharing
// TimerSlotCard means the two can't drift apart the way the old forked
// GuestTimerView did.
//
// What's deliberately absent: the unpaid-time ledger. Waiting time is shown
// while the tab is open and then goes with the session, matching every other
// pay feature being signed-in-only. The save modal says so plainly rather than
// quietly dropping it.

const FREE_SLOTS = Array.from({ length: MAX_TIMER_SLOTS }, (_, i) => i + 1);

export function GuestTimerSlots() {
  const {
    entries,
    opCodes,
    timers,
    attachGuestTimer,
    startGuestTimerWithoutRo,
    attachRoToGuestTimer,
    setGuestTimerStatus,
    setGuestTimerLine,
    resetGuestTimer,
    releaseGuestTimer,
    saveGuestTimer,
  } = useGuestStore();

  const [error, setError] = useState<string | null>(null);
  const [pickRoOpen, setPickRoOpen] = useState(false);
  const [saveSlotId, setSaveSlotId] = useState<string | null>(null);
  const [linePickSlotId, setLinePickSlotId] = useState<string | null>(null);
  const [attachLineEntry, setAttachLineEntry] = useState<Entry | null>(null);
  // Set when the picker was opened from a no-RO slot's "Attach RO".
  const [attachTargetId, setAttachTargetId] = useState<string | null>(null);

  const now = useTickingNow(timers.some(isAccruing));

  const libraryById = useMemo(
    () => new Map(opCodes.map((oc) => [oc.id, oc])),
    [opCodes],
  );
  const entryById = useMemo(
    () => new Map(entries.map((e) => [e.id, e])),
    [entries],
  );
  // Per-RO, per-line — mirrors TimerSlots. A blocked RO stays in the list with
  // its reason shown rather than silently vanishing from it.
  const slotsByEntry = useMemo(() => {
    const m = new Map<string, { lineIds: Set<string>; hasUnassigned: boolean }>();
    for (const t of timers) {
      if (!t.entryId) continue;
      const cur = m.get(t.entryId) ?? { lineIds: new Set<string>(), hasUnassigned: false };
      if (t.lineId) cur.lineIds.add(t.lineId);
      else cur.hasUnassigned = true;
      m.set(t.entryId, cur);
    }
    return m;
  }, [timers]);

  function attachBlockReason(entry: Entry): string | null {
    const taken = slotsByEntry.get(entry.id);
    if (!taken) return null;
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

  const attachable = entries.map((e) => ({ entry: e, blocked: attachBlockReason(e) }));
  const anyAttachable = attachable.some((a) => a.blocked === null);

  const saveSlot = timers.find((t) => t.id === saveSlotId) ?? null;
  const saveEntry = saveSlot?.entryId ? entryById.get(saveSlot.entryId) : null;
  const linePickSlot = timers.find((t) => t.id === linePickSlotId) ?? null;
  const linePickEntry = linePickSlot?.entryId
    ? entryById.get(linePickSlot.entryId)
    : null;

  function attachTo(entryId: string, lineId: string | null): string | null {
    const target = attachTargetId;
    setAttachTargetId(null);
    return target
      ? attachRoToGuestTimer(target, entryId, lineId)
      : attachGuestTimer(entryId, lineId);
  }

  function openPicker(targetId: string | null) {
    setAttachTargetId(targetId);
    setPickRoOpen(true);
  }

  function handleAttach(entry: Entry) {
    const free = freeLinesFor(entry);
    // A second timer on the same RO must name its line up front — an unset one
    // could later be pointed at the line already running, and hours are additive.
    if (slotsByEntry.has(entry.id) && free.length > 1) {
      setAttachLineEntry(entry);
      return;
    }
    const lineId =
      free.length === 1 ? free[0].id
      : entry.opCodes.length === 1 ? entry.opCodes[0].id
      : null;
    setPickRoOpen(false);
    setError(attachTo(entry.id, lineId));
  }

  return (
    <main className="tmr-page">
      <div className="pagehead">
        <div className="grow">
          <h1>Timers</h1>
          <p>
            <span className="num">{timers.length}</span> of <span className="num">{MAX_TIMER_SLOTS}</span>{" "}
            slots in use
          </p>
        </div>
      </div>

      {error && (
        <StatusField tag="Fix" role="alert">
          {error}
        </StatusField>
      )}

      {timers.length === 0 ? (
        <Zone name="Timers" className="tmr-empty">
          <EmptyState
            icon={<Wrench size={22} />}
            title="No timers running"
            description={`Put a car on a timer and its time lands on the RO. Run up to ${MAX_TIMER_SLOTS} at once — one on the lift, one waiting on parts.`}
            action={
              entries.length > 0 ? (
                <Button variant="go" onClick={() => openPicker(null)}>
                  <Plus size={16} aria-hidden="true" />
                  Start a timer
                </Button>
              ) : (
                <>
                  <Link href="/guest/log" className="btn btn-go btn-sm">
                    Log an RO first →
                  </Link>
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => setError(startGuestTimerWithoutRo())}
                  >
                    Start without an RO
                  </Button>
                </>
              )
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
            {timers.map((slot) => (
              <TimerSlotCard
                key={slot.id}
                slot={slot}
                entry={slot.entryId ? (entryById.get(slot.entryId) ?? null) : null}
                // No work schedule in guest mode, so no auto-stop deadline.
                capAt={null}
                now={now}
                libraryById={libraryById}
                pending={false}
                onStatus={(status) => {
                  tap();
                  setError(null);
                  setGuestTimerStatus(slot.id, status);
                }}
                onReset={() => resetGuestTimer(slot.id)}
                onRelease={() => releaseGuestTimer(slot.id)}
                onSave={() => setSaveSlotId(slot.id)}
                onPickLine={() => setLinePickSlotId(slot.id)}
                onAttachRo={() => openPicker(slot.id)}
              />
            ))}
            {FREE_SLOTS.filter((n) => !timers.some((s) => s.slot === n)).map((n) => (
              <FreeSlot key={`free-${n}`} slot={n} onStart={() => openPicker(null)} />
            ))}
          </div>
        </>
      )}

      {/* Attach-an-RO picker */}
      {pickRoOpen && (
        <Modal
          open
          onClose={() => {
            setPickRoOpen(false);
            setAttachTargetId(null);
          }}
          title="Put an RO on a timer"
          footer={
            <>
              <Link
                href="/guest/log"
                className={`btn btn-block ${entries.length > 0 && anyAttachable ? "btn-line" : "btn-go"}`}
              >
                <Plus className="h-4 w-4" />
                Log a new RO
              </Link>
              {!attachTargetId && (
                <Button
                  block
                  variant="quiet"
                  onClick={() => {
                    setPickRoOpen(false);
                    setError(startGuestTimerWithoutRo());
                  }}
                >
                  Start without an RO
                </Button>
              )}
            </>
          }
        >
          <div className="tmd-body">
            {entries.length === 0 ? (
              <StatusField tag="Note" inset>
                The timer clocks against an RO — log one first.
              </StatusField>
            ) : (
              <>
                {!anyAttachable && (
                  <StatusField tag="Note" inset>
                    Every line of every RO is already on a timer.
                  </StatusField>
                )}
                <div className="log-picks">
                  {attachable.map(({ entry: e, blocked }) => {
                    const vehicle = vehicleLabel(e);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => handleAttach(e)}
                        disabled={blocked !== null}
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

      {/* Line picker */}
      {/* Second timer on an RO that already has one: choose the line up front,
          from the free lines only. Mirrors TimerSlots. */}
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
                      setError(attachTo(entryId, line.id));
                    }}
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
                const takenElsewhere = timers.some(
                  (t) =>
                    t.id !== linePickSlot.id &&
                    t.entryId === linePickEntry.id &&
                    t.lineId === line.id,
                );
                return (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => {
                      setGuestTimerLine(linePickSlot.id, line.id);
                      setLinePickSlotId(null);
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

      {/* Save */}
      {saveSlot && saveEntry && (
        <GuestSaveModal
          slot={saveSlot}
          entry={saveEntry}
          libraryById={libraryById}
          onSave={(lineId) => {
            saveGuestTimer(saveSlot.id, lineId);
            setSaveSlotId(null);
          }}
          onClose={() => setSaveSlotId(null)}
        />
      )}
    </main>
  );
}

function GuestSaveModal({
  slot,
  entry,
  libraryById,
  onSave,
  onClose,
}: {
  slot: TimerSlot;
  entry: Entry;
  libraryById: Map<string, OpCode>;
  onSave: (lineId: string) => void;
  onClose: () => void;
}) {
  // Frozen at open — a total that moves while you're reading it is unreviewable.
  const [elapsed] = useState(() => elapsedFor(slot, Date.now()));
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const valid = slot.lineId && entry.opCodes.some((l) => l.id === slot.lineId);
    return valid ? slot.lineId : (entry.opCodes[0]?.id ?? null);
  });

  const workHours = msToHours(elapsed.work);
  const selected = entry.opCodes.find((l) => l.id === selectedId) ?? null;
  const existing = selected?.actualHours ?? null;
  const newTotal = Math.round(((existing ?? 0) + workHours) * 100) / 100;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Close out RO #${entry.roNumber}`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="go"
            className="tmd-primary"
            onClick={() => selected && onSave(selected.id)}
            disabled={!selected}
          >
            Save &amp; close timer
          </Button>
        </>
      }
    >
      <div className="tmd-body">
        <div className="card-inset tmd-well">
          <div className="rows">
            <div>
              <span className="k">Worked</span>
              <span className="v">
                {formatElapsed(elapsed.work)} · {fmtHours(workHours)}h
              </span>
            </div>
            {elapsed.holdParts > 0 && (
              <div>
                <span className="k">Waiting on parts</span>
                <span className="v">{formatDuration(elapsed.holdParts)}</span>
              </div>
            )}
            {elapsed.holdApproval > 0 && (
              <div>
                <span className="k">Waiting on approval</span>
                <span className="v">{formatDuration(elapsed.holdApproval)}</span>
              </div>
            )}
          </div>
          {elapsed.hold > 0 && (
            <p className="tmd-fine">
              Signed in, this waiting time gets recorded against the RO so you
              can show what the day actually cost you. In guest mode it goes
              with the session.
            </p>
          )}
        </div>

        {entry.opCodes.length === 0 ? (
          <StatusField tag="Fix" inset>
            This RO has no op codes.
          </StatusField>
        ) : (
          <>
            <p className="tmd-fine">
              Which line did the worked time go to? It&apos;s{" "}
              <strong>added</strong> to whatever that line already has.
            </p>
            <fieldset className="tmd-lines log-picks">
              <legend className="sr-only">Op code to save time to</legend>
              {entry.opCodes.map((line) => {
                const { code, description } = lineLabelFor(line, libraryById);
                const active = line.id === selectedId;
                return (
                  <label
                    key={line.id}
                    className={`log-pick tmd-opt${active ? " is-rec" : ""}`}
                  >
                    <input
                      type="radio"
                      name="guest-timer-save-line"
                      checked={active}
                      onChange={() => setSelectedId(line.id)}
                    />
                    <span className="log-pick-txt">
                      <span className="tmd-pick-head">
                        <Badge chip mono>{code}</Badge>
                        {line.custom && <Badge>Other</Badge>}
                      </span>
                      {description && <span className="log-pick-desc">{description}</span>}
                      <span className="log-pick-desc">
                        Actual:{" "}
                        {line.actualHours === null
                          ? "—"
                          : `${fmtHours(line.actualHours)}h`}
                      </span>
                    </span>
                    <span className="log-pick-act">Flag {fmtHours(line.flagHours)}h</span>
                  </label>
                );
              })}
            </fieldset>

            {selected && workHours > 0 && (
              <p className="tmd-total">
                {existing === null ? (
                  <>
                    This line has no actual hours yet — it becomes{" "}
                    <strong>{fmtHours2(workHours)}h</strong>.
                  </>
                ) : (
                  <>
                    <span className="num">{fmtHours2(existing)}h</span> +{" "}
                    <span className="num">{fmtHours2(workHours)}h</span> ={" "}
                    <strong>{fmtHours2(newTotal)}h</strong> on this line.
                  </>
                )}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
