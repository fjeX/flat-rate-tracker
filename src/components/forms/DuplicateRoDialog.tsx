"use client";

import { Modal } from "@/components/ui/Modal";
import { Pencil, Plus } from "lucide-react";
import type { RoMatch } from "@/lib/types";
import { formatDateLong, isoDate } from "@/lib/periods";

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
      <p className="pb-3 text-sm text-[var(--fg-2)]">
        {suggestEdit
          ? "You logged this RO number recently — did you mean to edit it?"
          : "This RO number was used before — likely a different repair. Date and vehicle keep them apart."}
      </p>

      <div className="space-y-1.5">
        {matches.map((m, i) => {
          const recommended = suggestEdit && i === 0;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onEdit(m.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                recommended
                  ? "border-[var(--brand-soft)] bg-[var(--brand-bg)] hover:brightness-110"
                  : "border-[var(--line)] hover:bg-[var(--bg-3)]"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--fg-0)]">
                  {formatDateLong(m.date)}
                </span>
                <span className="block truncate text-xs text-[var(--fg-2)]">
                  {m.vehicleSummary || "No vehicle recorded"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--fg-1)]">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 border-t border-[var(--line)] pt-3">
        <button
          type="button"
          onClick={onLogNew}
          style={!suggestEdit ? { color: "oklch(0.18 0.04 50)" } : undefined}
          className={`flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${
            suggestEdit
              ? "border border-[var(--line)] text-[var(--fg-1)] hover:bg-[var(--bg-3)]"
              : "bg-[var(--brand)] hover:brightness-105"
          }`}
        >
          <Plus className="h-4 w-4" />
          Log as new entry
        </button>
        <p className="pt-2 text-center text-[11px] text-[var(--fg-3)]">
          Same RO number, different repair — kept separate from{" "}
          {matches.length === 1 ? "the one above" : `the ${matches.length} above`}.
        </p>
      </div>
    </Modal>
  );
}
