"use client";

import {
  ClipboardCheck,
  Package,
  Pause,
  RotateCcw,
  Save,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import {
  elapsedFor,
  formatDuration,
  formatElapsed,
  STATUS_LABEL,
  STATUS_TONE,
  wasAutoStopped,
  type TimerSlot,
  type TimerStatus,
} from "@/lib/timer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { RollingNumber } from "@/components/ui/RollingNumber";

// One timer card. Purely presentational — every mutation goes out through a
// callback, so the signed-in page can wire server actions and the guest mirror
// can wire its in-memory reducer without either forking the markup. (The old
// TimerView and GuestTimerView each carried their own copy of the layout and
// their own StatusBadge, and had already drifted apart.)

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
  onOpenDetail,
}: {
  slot: TimerSlot;
  entry: Entry | null;
  /** Auto-stop deadline, or null when uncapped (guest mode has no schedule). */
  capAt: number | null;
  now: number;
  libraryById: Map<string, OpCode>;
  pending: boolean;
  onStatus: (status: TimerStatus) => void;
  onReset: () => void;
  onRelease: () => void;
  onSave: () => void;
  onPickLine: () => void;
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

  const vehicle = entry ? vehicleLabel(entry) : "";

  return (
    <div className="card">
      <div className="timer-slot-head">
        <div style={{ minWidth: 0 }}>
          <div className="timer-slot-id">Timer {slot.slot}</div>
          {entry ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {onOpenDetail ? (
                  <button
                    type="button"
                    onClick={() => onOpenDetail(entry)}
                    className="timer-slot-ro hit-expand hover:underline"
                  >
                    #{entry.roNumber}
                  </button>
                ) : (
                  <span className="timer-slot-ro">#{entry.roNumber}</span>
                )}
                <span className="text-xs text-[var(--fg-3)]">
                  {formatDateShort(entry.date)}
                </span>
              </div>
              {vehicle && <div className="timer-slot-vehicle">{vehicle}</div>}
            </>
          ) : (
            // The RO was deleted out from under the timer. The FK nulls the
            // link rather than leaving a dangling id, so say so plainly.
            <div className="text-sm text-[var(--fg-2)]">RO no longer available</div>
          )}
        </div>
        <Badge tone={STATUS_TONE[slot.status]}>
          {slot.status === "working" && <span className="timer-dot" />}
          {STATUS_LABEL[slot.status]}
        </Badge>
      </div>

      {/* Worked time only. It deliberately stops moving the moment the job goes
          on hold — that stillness is the signal that nothing is being earned. */}
      <div className="timer-slot-display">
        <RollingNumber
          value={formatElapsed(elapsed.work)}
          className={`timer-slot-time${slot.status === "working" ? "" : " dim"}`}
        />
        <div className="timer-slot-caption">
          {slot.status === "working"
            ? "worked"
            : "worked · not counting while on hold"}
        </div>
      </div>

      {elapsed.hold > 0 && (
        <div className="timer-slot-split">
          {elapsed.holdParts > 0 && (
            <span className="wait">
              {slot.status === "hold_parts" && (
                <span className="timer-dot wait" aria-hidden="true" />
              )}{" "}
              Waiting on parts <b>{formatDuration(elapsed.holdParts)}</b>
            </span>
          )}
          {elapsed.holdApproval > 0 && (
            <span className="wait-approval">
              {slot.status === "hold_approval" && (
                <span className="timer-dot wait-approval" aria-hidden="true" />
              )}{" "}
              Waiting on approval <b>{formatDuration(elapsed.holdApproval)}</b>
            </span>
          )}
        </div>
      )}

      {capped && (
        <p className="timer-capped">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Stopped counting at the end of your shift. Check the total before
            saving — if you really did work that long, reset and enter the hours
            on the RO by hand.
          </span>
        </p>
      )}

      {entry && entry.opCodes.length > 1 && (
        <div className="timer-slot-line">
          <span>Line:</span>
          {line ? (
            <>
              <span className="code">{lineLabelFor(line, libraryById).code}</span>
              <button
                type="button"
                onClick={onPickLine}
                className="hit-expand text-[var(--fg-3)] hover:text-[var(--fg-1)]"
              >
                Change
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onPickLine}
              className="hit-expand text-[var(--fg-2)] hover:text-[var(--fg-1)]"
            >
              Pick a line →
            </button>
          )}
        </div>
      )}

      <div className="timer-status-grid">
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
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {STATUS_BTN_LABEL[status]}
            </button>
          );
        })}
      </div>

      <div className="timer-slot-actions">
        <Button
          variant="primary"
          onClick={onSave}
          disabled={pending || !entry || !hasTime || needsLine}
          title={
            needsLine
              ? "Pick a line first"
              : !hasTime
                ? "Nothing to save yet"
                : undefined
          }
        >
          <Save className="h-4 w-4" />
          Save
        </Button>
        <Button onClick={handleReset} disabled={pending || !hasTime}>
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
        <Button
          variant="ghost"
          onClick={handleRelease}
          disabled={pending}
          aria-label={`Clear timer ${slot.slot}`}
          title="Clear this timer"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
