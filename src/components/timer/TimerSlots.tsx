"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wrench, X } from "lucide-react";
import type { Entry, NewEntry, OpCode, RoTemplate } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import {
  attachRoToTimerAction,
  releaseTimerAction,
  resetTimerAction,
  setTimerLineAction,
  setTimerStatusAction,
} from "@/app/actions/timer";
import { saveEntry } from "@/app/actions/entries";
import { isAccruing, MAX_TIMER_SLOTS, type TimerSlot } from "@/lib/timer";
import { TimerSaveModal } from "./TimerSaveModal";
import { TimerSlotCard, lineLabelFor, vehicleLabel } from "./TimerSlotCard";
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { LogRoForm } from "@/components/forms/LogRoForm";
import { tap } from "@/lib/haptics";
import { useTickingNow } from "@/lib/use-ticking-now";

// The signed-in timer page. Up to MAX_TIMER_SLOTS jobs run at once, because a
// bay does: one car on the lift, one waiting on parts, one waiting on an
// approval. Card markup is shared with the guest mirror via TimerSlotCard.

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
  const [linePickSlotId, setLinePickSlotId] = useState<string | null>(null);
  // Set when attaching a SECOND timer to an RO that already has one running:
  // that case has to choose its line before the timer starts.
  const [attachLineEntry, setAttachLineEntry] = useState<Entry | null>(null);

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
  const canAddTimer = slotsUsed < MAX_TIMER_SLOTS;

  function run(action: () => Promise<unknown>) {
    setError(null);
    startPending(async () => {
      try {
        await action();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed.");
      }
    });
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
    run(() => attachRoToTimerAction(entry.id, lineId));
  }

  async function handleLogRoSave(input: NewEntry) {
    const saved = await saveEntry(input);
    await attachRoToTimerAction(
      saved.id,
      saved.opCodes.length === 1 ? saved.opCodes[0].id : null,
    );
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
    <main className="app-main" style={{ paddingBottom: 64 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="section-title">
          Timers
          <span style={{ color: "var(--fg-3)", fontWeight: 400 }}>
            {slotsUsed} of {MAX_TIMER_SLOTS}
          </span>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--bad)]">
            {error}
          </p>
        )}

        {slots.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Wrench size={22} />}
              title="No timers running"
              description={`Put a car on a timer and its time lands on the RO. You can run up to ${MAX_TIMER_SLOTS} at once — one on the lift, one waiting on parts.`}
              action={
                <Button
                  variant="primary"
                  onClick={() => setPickRoOpen(true)}
                  disabled={pending}
                >
                  <Plus className="h-4 w-4" />
                  Start a timer
                </Button>
              }
            />
          </div>
        ) : (
          <div className="timer-slots">
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
                onOpenDetail={setDetailEntry}
              />
            ))}
          </div>
        )}

        {slots.length > 0 && (
          <div>
            <button
              type="button"
              className="timer-add"
              onClick={() => setPickRoOpen(true)}
              disabled={!canAddTimer || pending}
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
            {recentEntries.length === 0 ? (
              <p className="text-sm text-[var(--fg-2)]">
                The timer clocks against an RO — log one first.
              </p>
            ) : (
              <>
              {!anyAttachable && (
                <p className="text-sm text-[var(--fg-2)]">
                  Every line of every recent RO is already on a timer.
                </p>
              )}
              <ul className="card-inset divide-y divide-[var(--line-soft)] overflow-hidden">
                {pickerEntries.map(({ entry: e, blocked }) => {
                  const vehicle = vehicleLabel(e);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => handleAttach(e)}
                        disabled={pending || blocked !== null}
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
            <Button
              block
              onClick={() => {
                setPickRoOpen(false);
                setLogRoOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Log a new RO
            </Button>
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
        />
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
                        run(() => attachRoToTimerAction(entryId, line.id));
                      }}
                      disabled={pending}
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
                  <li key={line.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setLinePickSlotId(null);
                        run(() => setTimerLineAction(linePickSlot.id, line.id));
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
                        {takenElsewhere && (
                          <span className="block text-xs text-[var(--fg-3)]">
                            Already on another timer.
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

      {/* Log RO full-screen overlay */}
      {logRoOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg-0)]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg-0)]/90 px-4 py-3 backdrop-blur">
            <h2 className="text-base font-semibold">Log New RO</h2>
            <Button
              variant="ghost"
              onClick={() => setLogRoOpen(false)}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <LogRoForm
            initialOpCodes={library}
            roTemplates={roTemplates}
            onSave={handleLogRoSave}
            redirectTo="/timer"
            checkDuplicates
          />
        </div>
      )}
    </main>
  );
}
