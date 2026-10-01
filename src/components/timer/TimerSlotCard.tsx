"use client";

import {
  ClipboardCheck,
  Package,
  Pause,
  Plus,
  RotateCcw,
  Save,
  Wrench,
  X,
} from "lucide-react";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import {
  elapsedFor,
  formatDuration,
  formatElapsed,
  msToHours,
  STATUS_LABEL,
  STATUS_TONE,
  wasAutoStopped,
  type TimerSlot,
  type TimerStatus,
} from "@/lib/timer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DurationBar } from "@/components/ui/DurationBar";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { StatusField } from "@/components/ui/StatusField";
import { Zone } from "@/components/ui/Zone";

// One timer, as a zone (phase 5 sketch): the RO, the worked time as the
// headline figure with a duration bar under it, the waiting time, the line
// the hours will land on, the status picker, then Save / Reset / Clear.
// Purely presentational — every mutation goes out through a callback, so the
// signed-in page can wire server actions and the guest mirror can wire its
// in-memory reducer without either forking the markup. (The old TimerView and
// GuestTimerView each carried their own copy of the layout and their own
// StatusBadge, and had already drifted apart.)

const STATUS_ORDER: TimerStatus[] = [
  "working",
  "hold_parts",
  "hold_approval",
  "paused",
];

const STATUS_ICON: Record<TimerStatus, typeof Wrench> = {
  working: Wrench,
  hold_parts: Package,
  hold_approval: ClipboardCheck,
  paused: Pause,
};

const STATUS_BTN_LABEL: Record<TimerStatus, string> = {
  working: "Working",
  hold_parts: "Parts",
  hold_approval: "Approval",
  paused: "Pause",
};

export function lineLabelFor(
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

export function vehicleLabel(entry: Entry): string {
  return [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** The three steps a timer goes through; shown where a tech starts from nothing. */
export function TimerSteps() {
  return (
    <ol className="tmr-steps" aria-label="How a timer works">
      <li><b>Start</b> it on an RO</li>
      <li><b>Pick the line</b> the hours land on</li>
      <li><b>Save</b> when the job is done</li>
    </ol>
  );
}

/**
 * An empty slot, drawn where a timer would be (Liem, 2026-09-30): three bays,
 * some with a car on the lift, some free. The free bay IS the add button.
 */
export function FreeSlot({
  slot,
  onStart,
  disabled,
}: {
  slot: number;
  onStart: () => void;
  disabled?: boolean;
}) {
  return (
    <Zone className="tmr-slot tmr-free" name={`Timer ${slot}`} aside="Free">
      <p className="tmr-free-txt">Nothing on this lift.</p>
      <Button variant="line" onClick={onStart} disabled={disabled}>
        <Plus size={16} aria-hidden="true" />
        Start a timer
      </Button>
    </Zone>
  );
}

export function TimerSlotCard({
  slot,
  entry,
  capAt,
  now,
  libraryById,
  pending,
  onStatus,
  onReset,
  onRelease,
  onSave,
  onPickLine,
  onAttachRo,
  onOpenDetail,
}: {
  slot: TimerSlot;
  entry: Entry | null;
  /** Auto-stop deadline, or null when uncapped (guest mode has no schedule). */
  capAt: number | null;
  /** Null until the client has mounted — see useTickingNow. */
  now: number | null;
  libraryById: Map<string, OpCode>;
  pending: boolean;
  onStatus: (status: TimerStatus) => void;
  onReset: () => void;
  onRelease: () => void;
  onSave: () => void;
  onPickLine: () => void;
  /** Opens the RO picker for THIS slot. Only used while the slot has no RO. */
  onAttachRo?: () => void;
  onOpenDetail?: (entry: Entry) => void;
}) {
  const elapsed = elapsedFor(slot, now, capAt);
  const capped = wasAutoStopped(slot, now, capAt);
  const hasTime = elapsed.total > 0;

  const line =
    entry && slot.lineId
      ? (entry.opCodes.find((l) => l.id === slot.lineId) ?? null)
      : null;
  const needsLine = entry !== null && entry.opCodes.length > 1 && line === null;

  function handleReset() {
    if (
      hasTime &&
      !window.confirm(
        `Reset this timer? ${formatElapsed(elapsed.total)} will be discarded.`,
      )
    ) {
      return;
    }
    onReset();
  }

  function handleRelease() {
    if (
      hasTime &&
      !window.confirm(
        `Clear this timer? ${formatElapsed(elapsed.total)} will be discarded without saving.`,
      )
    ) {
      return;
    }
    onRelease();
  }

  // Started without an RO (Liem, 2026-09-30): the clock runs, the hours wait.
  const noRo = slot.entryId === null;
  const vehicle = entry ? vehicleLabel(entry) : "";
  const working = slot.status === "working";

  return (
    <Zone
      className="tmr-slot"
      name={`Timer ${slot.slot}`}
      aside={
        <Badge tone={STATUS_TONE[slot.status]}>
          {working && <span className={`tmr-dot${now !== null ? " is-live" : ""}`} aria-hidden="true" />}
          {STATUS_LABEL[slot.status]}
        </Badge>
      }
    >
      {entry ? (
        <>
          <div className="tmr-ro">
            {onOpenDetail ? (
              <button
                type="button"
                onClick={() => onOpenDetail(entry)}
                className="ro-link"
                aria-label={`RO ${entry.roNumber}`}
              >
                #{entry.roNumber}
              </button>
            ) : (
              <span className="ro-link" style={{ textDecoration: "none", cursor: "default" }}>
                #{entry.roNumber}
              </span>
            )}
            {/* Same tag as RoDetailModal and TicketTimeline (Open Tickets
                Phase 2) — one look for "this RO has no lines yet" everywhere. */}
            {entry.status === "open" && <Badge tone="neutral">Open ticket</Badge>}
            <span className="tmr-when">{formatDateShort(entry.date)}</span>
          </div>
          {vehicle && <div className="tmr-veh">{vehicle}</div>}
        </>
      ) : noRo ? (
        // Started without an RO, or the RO was deleted out from under the
        // timer (the FK nulls the link rather than leaving a dangling id).
        <p className="tmr-gone">No RO yet</p>
      ) : (
        // The slot names an RO that could not be loaded.
        <p className="tmr-gone">RO no longer available</p>
      )}

      {/* Worked time only. It deliberately stops moving the moment the job goes
          on hold — that stillness is the signal that nothing is being earned. */}
      <div className="tmr-fig">
        <RollingNumber
          value={formatElapsed(elapsed.work)}
          className={`tmr-time${working ? "" : " is-still"}`}
        />
        {/* Every non-working status freezes this clock, but they don't mean the
            same thing — "on hold" is the shop waiting on parts or approval,
            while "paused" is the tech stepping away. Saying "on hold" for a
            plain pause misreports why the money stopped. */}
        <div className="tmr-cap">
          {working
            ? "worked"
            : slot.status === "paused"
              ? "worked · not counting while paused"
              : "worked · not counting while on hold"}
        </div>
        <div className="tmr-bar">
          <DurationBar hours={msToHours(elapsed.work)} />
        </div>
      </div>

      {elapsed.hold > 0 && (
        <div className="tmr-split">
          {elapsed.holdParts > 0 && (
            <span>
              {slot.status === "hold_parts" && <span className="tmr-dot" aria-hidden="true" />}
              Waiting on parts <b className="num">{formatDuration(elapsed.holdParts)}</b>
            </span>
          )}
          {elapsed.holdApproval > 0 && (
            <span>
              {slot.status === "hold_approval" && <span className="tmr-dot" aria-hidden="true" />}
              Waiting on approval <b className="num">{formatDuration(elapsed.holdApproval)}</b>
            </span>
          )}
        </div>
      )}

      {capped && (
        <StatusField tag="Note" inset>
          Stopped counting at the end of your shift. Check the total before
          saving — if you really did work that long, reset and enter the hours
          on the RO by hand.
        </StatusField>
      )}

      {/* Show the binding whenever there is one — a single-line RO gets its line
          bound automatically at attach, and hiding that left the card silent
          about which line the hours were about to land on. Multi-line ROs also
          get the row while unbound, because there it's a prompt to act. */}
      {entry && (line !== null || entry.opCodes.length > 1) && (
        <div className="tmr-line">
          <span className="tmr-line-k">Line</span>
          {line ? (
            <>
              <Badge chip mono>{lineLabelFor(line, libraryById).code}</Badge>
              {/* Nothing to switch to on a single-line RO. */}
              {entry.opCodes.length > 1 && (
                <Button variant="quiet" size="sm" onClick={onPickLine}>
                  Change
                </Button>
              )}
            </>
          ) : (
            // The one thing standing between this timer and Save, so it is
            // the primary action while it is needed.
            <Button variant="go" size="sm" onClick={onPickLine}>
              Pick a line
            </Button>
          )}
        </div>
      )}

      {/* What to do next. A disabled Save with a tooltip explained nothing on
          a phone (Liem, 2026-09-30); this says the step out loud, and goes
          away once there is nothing left to do but work. */}
      {noRo && (
        <div className="tmr-attach">
          <StatusField tag="Next" inset>
            Attach an RO to save these hours.
          </StatusField>
          {onAttachRo && (
            <Button variant="go" onClick={onAttachRo} disabled={pending}>
              Attach RO
            </Button>
          )}
        </div>
      )}
      {entry && needsLine && (
        <StatusField tag="Next" inset>
          Pick the line these hours land on. Save unlocks after that.
        </StatusField>
      )}
      {entry && !needsLine && !hasTime && (
        <StatusField tag="Next" inset>
          {working
            ? "Counting. Save when the job is done, or put it on hold while you wait."
            : "Tap Working to start the clock."}
        </StatusField>
      )}

      <div className="seg tmr-seg" role="group" aria-label="Timer status">
        {STATUS_ORDER.map((status) => {
          const Icon = STATUS_ICON[status];
          const active = slot.status === status;
          return (
            <button
              key={status}
              type="button"
              className="timer-status-btn"
              data-tone={STATUS_TONE[status]}
              aria-pressed={active}
              aria-label={STATUS_LABEL[status]}
              disabled={pending || active}
              onClick={() => onStatus(status)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{STATUS_BTN_LABEL[status]}</span>
            </button>
          );
        })}
      </div>

      <div className="tmr-actions">
        <Button
          variant="go"
          onClick={onSave}
          disabled={pending || !entry || !hasTime || needsLine}
          title={
            noRo
              ? "Attach an RO first"
              : needsLine
              ? "Pick a line first"
              : !hasTime
                ? "Nothing to save yet"
                : undefined
          }
        >
          <Save size={16} aria-hidden="true" />
          Save
        </Button>
        <Button variant="line" onClick={handleReset} disabled={pending || !hasTime}>
          <RotateCcw size={16} aria-hidden="true" />
          Reset
        </Button>
        <Button
          variant="quiet"
          onClick={handleRelease}
          disabled={pending}
          aria-label={`Clear timer ${slot.slot}`}
          title="Clear this timer"
        >
          <X size={16} aria-hidden="true" />
          Clear
        </Button>
      </div>
    </Zone>
  );
}
