"use client";

import { Modal } from "@/components/ui/Modal";
import type { RoMatch } from "@/lib/types";
import { formatDateLong, isoDate } from "@/lib/periods";
import { LogIcon } from "./logParts";

// If the most recent matching entry is this recent, the user is probably still
// working the same RO (fixing a typo / adding a line) → default to editing it.
// Older than this, a recycled RO number is almost certainly a different job.
const RECENT_DAYS = 14;

function daysBetween(later: string, earlier: string): number {
  const a = new Date(later + "T00:00:00").getTime();
  const b = new Date(earlier + "T00:00:00").getTime();
  return Math.round((a - b) / 86_400_000);
}

// Shown when saving a NEW repair order whose RO number already exists. RO
// numbers aren't unique (shops recycle them), so we let the user choose: edit
// one of the existing entries, or log this as a genuinely separate repair.
export function DuplicateRoDialog({
  roNumber,
  matches,
  onEdit,
  onLogNew,
  onClose,
}: {
  roNumber: string;
  matches: RoMatch[];
  onEdit: (id: string) => void;
  onLogNew: () => void;
  onClose: () => void;
}) {
  // matches arrive newest-first — use the most recent to pick the default.
  const mostRecent = matches[0];
  const suggestEdit =
    mostRecent !== undefined &&
    daysBetween(isoDate(), mostRecent.date) <= RECENT_DAYS;

  return (
    <Modal open onClose={onClose} title={`RO #${roNumber} already exists`}>
      <p className="log-sub">
        {suggestEdit
          ? "You logged this RO number recently — did you mean to edit it?"
          : "This RO number was used before — likely a different repair. Date and vehicle keep them apart."}
      </p>

      <div className="log-picks">
        {matches.map((m, i) => {
          const recommended = suggestEdit && i === 0;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onEdit(m.id)}
              className={`log-pick${recommended ? " is-rec" : ""}`}
            >
              <span className="log-pick-txt">
                <b>{formatDateLong(m.date)}</b>
                <span className="log-pick-desc">{m.vehicleSummary || "No vehicle recorded"}</span>
              </span>
              <span className="log-pick-act">Edit</span>
            </button>
          );
        })}
      </div>

      <div className="log-dup-new">
        <button
          type="button"
          onClick={onLogNew}
          className={`btn btn-block ${suggestEdit ? "btn-line" : "btn-go"}`}
        >
          <LogIcon name="plus" small />
          Log as new entry
        </button>
        <p className="log-fine">
          Same RO number, different repair — kept separate from{" "}
          {matches.length === 1 ? "the one above" : `the ${matches.length} above`}.
        </p>
      </div>
    </Modal>
  );
}
