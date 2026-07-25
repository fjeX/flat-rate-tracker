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
  const onTimerIds = useMemo(
    () => new Set(slots.map((s) => s.entryId).filter(Boolean) as string[]),
    [slots],
  );

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
    // One line? Bind it now so the tech never has to pick. Several? Leave it
    // unset and let the card prompt — guessing would silently log a brake job's
    // hours against an oil change.
    const lineId = entry.opCodes.length === 1 ? entry.opCodes[0].id : null;
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

  const attachableEntries = recentEntries.filter((e) => !onTimerIds.has(e.id));

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
            {attachableEntries.length === 0 ? (
              <p className="text-sm text-[var(--fg-2)]">
                {recentEntries.length === 0
                  ? "The timer clocks against an RO — log one first."
                  : "Every recent RO is already on a timer."}
              </p>
            ) : (
              <ul className="card-inset divide-y divide-[var(--line-soft)] overflow-hidden">
                {attachableEntries.map((e) => {
                  const vehicle = vehicleLabel(e);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => handleAttach(e)}
                        disabled={pending}
                        className="flex w-full min-h-[44px] items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-3)]/40"
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
                        </span>
                        <span className="shrink-0 text-sm text-[var(--fg-0)]">
                          {fmtHours(e.flagHours)}h
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
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
                return (
                  <li key={line.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setLinePickSlotId(null);
                        run(() => setTimerLineAction(linePickSlot.id, line.id));
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
