"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Wrench } from "lucide-react";
import { useGuestStore } from "@/lib/guest/context";
import { fmtHours } from "@/lib/stats";
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
  TimerSlotCard,
  lineLabelFor,
  vehicleLabel,
} from "@/components/timer/TimerSlotCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
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

export function GuestTimerSlots() {
  const {
    entries,
    opCodes,
    timers,
    attachGuestTimer,
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

  const canAddTimer = timers.length < MAX_TIMER_SLOTS;
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
    setError(attachGuestTimer(entry.id, lineId));
  }

  return (
    <main className="app-main" style={{ paddingBottom: 64 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="section-title">
          Timers
          <span style={{ color: "var(--fg-3)", fontWeight: 400 }}>
            {timers.length} of {MAX_TIMER_SLOTS}
          </span>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--bad)]">
            {error}
          </p>
        )}

        {timers.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Wrench size={22} />}
              title="No timers running"
              description={`Put a car on a timer and its time lands on the RO. Run up to ${MAX_TIMER_SLOTS} at once — one on the lift, one waiting on parts.`}
              action={
                entries.length > 0 ? (
                  <Button variant="primary" onClick={() => setPickRoOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Start a timer
                  </Button>
                ) : (
                  <Link href="/guest/log" className="btn btn-primary btn-sm">
                    Log an RO first →
                  </Link>
                )
              }
            />
          </div>
        ) : (
          <div className="timer-slots">
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
              />
            ))}
          </div>
        )}

        {timers.length > 0 && (
          <div>
            <button
              type="button"
              className="timer-add"
              onClick={() => setPickRoOpen(true)}
              disabled={!canAddTimer}
            >
              <Plus className="h-4 w-4" />
              {canAddTimer ? "Add another timer" : "All timers in use"}
            </button>
            {!canAddTimer && (
              <p className="timer-add-hint">Save or clear one to free up a slot.</p>
            )}
          </div>
        )}
      </div>

      {/* Attach-an-RO picker */}
      {pickRoOpen && (
        <Modal open onClose={() => setPickRoOpen(false)} title="Put an RO on a timer">
          <div className="space-y-3">
            {entries.length === 0 ? (
              <p className="text-sm text-[var(--fg-2)]">
                The timer clocks against an RO — log one first.
              </p>
            ) : (
              <>
              {!anyAttachable && (
                <p className="text-sm text-[var(--fg-2)]">
                  Every line of every RO is already on a timer.
                </p>
              )}
              <ul className="card-inset divide-y divide-[var(--line-soft)] overflow-hidden">
                {attachable.map(({ entry: e, blocked }) => {
                  const vehicle = vehicleLabel(e);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => handleAttach(e)}
                        disabled={blocked !== null}
                        className="flex w-full min-h-[44px] items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-3)]/40 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-sm text-[var(--brand)]">
                              #{e.roNumber}
                            </span>
                            <span className="text-xs text-[var(--fg-3)]">
                              {formatDateShort(e.date)}
                            </span>
                          </span>
                          {vehicle && (
                            <span className="mt-0.5 block truncate text-xs text-[var(--fg-2)]">
                              {vehicle}
                            </span>
                          )}
                          {blocked && (
                            <span className="mt-0.5 block text-xs text-[var(--fg-3)]">
                              {blocked}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm text-[var(--fg-0)]">
                          {fmtHours(e.flagHours)}h
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              </>
            )}
            <Link href="/guest/log" className="btn btn-block">
              <Plus className="h-4 w-4" />
              Log a new RO
            </Link>
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
          <div className="space-y-3">
            <p className="text-sm text-[var(--fg-2)]">
              This RO already has a timer running. Pick the line this second
              timer is for — its hours land on that line only.
            </p>
            <ul className="card-inset divide-y divide-[var(--line-soft)] overflow-hidden">
              {freeLinesFor(attachLineEntry).map((line) => {
                const { code, description } = lineLabelFor(line, libraryById);
                return (
                  <li key={line.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const entryId = attachLineEntry.id;
                        setAttachLineEntry(null);
                        setPickRoOpen(false);
                        setError(attachGuestTimer(entryId, line.id));
                      }}
                      className="flex w-full min-h-[44px] items-start gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-3)]/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-sm text-[var(--brand)]">
                          {code}
                        </span>
                        {line.custom && <Badge className="ml-2">Other</Badge>}
                        {description && (
                          <span className="block truncate text-xs text-[var(--fg-3)]">
                            {description}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--fg-2)]">
                        {fmtHours(line.flagHours)}h
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Modal>
      )}

      {linePickSlot && linePickEntry && (
        <Modal
          open
          onClose={() => setLinePickSlotId(null)}
          title={`RO #${linePickEntry.roNumber} — Pick a line`}
        >
          <div className="space-y-3">
            <p className="text-sm text-[var(--fg-2)]">
              Which line should this timer&apos;s worked hours land on?
            </p>
            <ul className="card-inset divide-y divide-[var(--line-soft)] overflow-hidden">
              {linePickEntry.opCodes.map((line) => {
                const { code, description } = lineLabelFor(line, libraryById);
                const takenElsewhere = timers.some(
                  (t) =>
                    t.id !== linePickSlot.id &&
                    t.entryId === linePickEntry.id &&
                    t.lineId === line.id,
                );
                return (
                  <li key={line.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setGuestTimerLine(linePickSlot.id, line.id);
                        setLinePickSlotId(null);
                      }}
                      disabled={takenElsewhere}
                      className="flex w-full min-h-[44px] items-start gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-3)]/40 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-sm text-[var(--brand)]">
                          {code}
                        </span>
                        {line.custom && <Badge className="ml-2">Other</Badge>}
                        {description && (
                          <span className="block truncate text-xs text-[var(--fg-3)]">
                            {description}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--fg-2)]">
                        {fmtHours(line.flagHours)}h
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
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
    <Modal open onClose={onClose} title={`Close out RO #${entry.roNumber}`}>
      <div className="space-y-4">
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
              Signed in, this waiting time gets recorded against the RO so you
              can show what the day actually cost you. In guest mode it goes
              with the session.
            </p>
          )}
        </div>

        {entry.opCodes.length === 0 ? (
          <p className="rounded-[var(--radius-sm)] bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn)]">
            This RO has no op codes.
          </p>
        ) : (
          <>
            <p className="text-xs text-[var(--fg-3)]">
              Which line did the worked time go to? It&apos;s{" "}
              <strong className="text-[var(--fg-1)]">added</strong> to whatever
              that line already has.
            </p>
            <fieldset className="card-inset overflow-hidden">
              <legend className="sr-only">Op code to save time to</legend>
              <ul className="divide-y divide-[var(--line-soft)]">
                {entry.opCodes.map((line) => {
                  const { code, description } = lineLabelFor(line, libraryById);
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
                          name="guest-timer-save-line"
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

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => selected && onSave(selected.id)}
            disabled={!selected}
          >
            Save &amp; close timer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
