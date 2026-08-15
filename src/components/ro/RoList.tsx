"use client";

import { useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import type { Entry, OpCode } from "@/lib/types";
import { formatDateShort, formatLoggedTime } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import type { RateMap } from "@/lib/earnings";
import { RoDetailModal } from "./RoDetailModal";
import { EmptyState } from "@/components/ui/EmptyState";

// Resolve a line's display code using either its custom fields or a
// reference from the library.
function lineCode(
  line: Entry["opCodes"][number],
  libraryById: Map<string, OpCode>,
): string {
  if (line.custom) return (line.customCode ?? "").trim() || "—";
  if (line.opCodeId) return libraryById.get(line.opCodeId)?.code ?? "—";
  return "—";
}

export function RoList({
  entries,
  library = [],
  rates = {},
  emptyState,
  onRowClick,
  maxRows,
  showAddUpsell = false,
}: {
  entries: Entry[];
  library?: OpCode[];
  rates?: RateMap;
  emptyState?: React.ReactNode;
  onRowClick?: (entry: Entry) => void;
  /**
   * Show an "Upsell" shortcut on each row, opening the RO with the op-code
   * picker already up. Dashboard only — the customer approving extra work is a
   * thing that happens WHILE the day is running, which is the only page open at
   * that moment. Pay Period is a review surface and History is a search surface;
   * neither is where you're standing at the car.
   *
   * A boolean rather than a callback because the dashboard is a server
   * component, and a function prop can't cross that boundary.
   *
   * Ignored when `onRowClick` is set: the parent owns the modal in that case, so
   * this list has nothing to open.
   */
  showAddUpsell?: boolean;
  // Cap the visible rows behind a "Show all N" toggle. Undefined (the default)
  // renders every entry, which is what the dashboard and guest page want — a
  // busy semi-monthly period is 50-90 ROs, so only the Pay Period page needs
  // this, and only once the period is settled and reconciliation has become
  // the real drill-down.
  maxRows?: number;
}) {
  // `addLine` carries WHY the modal opened: tapping the row is "show me this
  // RO", tapping Upsell is "I need to add a line to it". Same modal, different
  // starting state — see RoDetailModal's autoOpenAddLine.
  const [open, setOpen] = useState<{ id: string; addLine: boolean } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  // Resolve against the FULL list, not the visible slice — the detail modal
  // must still open for a row that a later collapse would hide.
  const openEntry = open ? entries.find((e) => e.id === open.id) : null;
  // The picker renders nothing without a library, so a button that opens an
  // empty picker is a button that does nothing.
  const upsellShortcut = showAddUpsell && !onRowClick && library.length > 0;

  const capped =
    maxRows !== undefined && !showAll && entries.length > maxRows;
  const visible = capped ? entries.slice(0, maxRows) : entries;
  const hiddenCount = entries.length - visible.length;

  if (entries.length === 0) {
    return emptyState ? (
      <>{emptyState}</>
    ) : (
      <div className="card flush">
        <EmptyState
          icon={<ClipboardList size={22} />}
          title="No ROs in this range"
          description="Nothing logged here yet."
        />
      </div>
    );
  }

  return (
    <>
      <div className="ro-list">
        {visible.map((e) => {
          const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
            .filter(Boolean)
            .join(" ")
            .trim();
          return (
            // A div, not a button. The row used to BE the button; the Upsell
            // shortcut has to sit inside it, and a button inside a button is
            // invalid HTML that browsers resolve by dropping one of them.
            <div key={e.id} className="ro-row">
            <button
              type="button"
              className="ro-row-main"
              onClick={() => onRowClick ? onRowClick(e) : setOpen({ id: e.id, addLine: false })}
            >
              <div className="grow">
                <div>
                  <span className="ro-num">#{e.roNumber}</span>
                  <span className="ro-meta">· {formatDateShort(e.date)}</span>
                  {/* Only when there is one. An RO logged before the feature, or
                      with the setting off, shows the date alone — no placeholder
                      and no dash, because "no time recorded" is not a value. */}
                  {formatLoggedTime(e.loggedTime) && (
                    <span className="ro-meta">
                      {" "}
                      · {formatLoggedTime(e.loggedTime)}
                    </span>
                  )}
                </div>
                {vehicle && (
                  <div className="ro-vehicle">{vehicle}</div>
                )}
                {e.opCodes.length > 0 && (
                  <div className="ro-codes">
                    {e.opCodes.map((line) => {
                      const code = lineCode(line, libraryById);
                      const flag = fmtHours(line.flagHours);
                      const actual =
                        line.actualHours !== null
                          ? fmtHours(line.actualHours)
                          : "—";
                      return (
                        <span key={line.id} className="ro-code-chip">
                          <span className="c">{code}</span>{" "}
                          <span
                            className="mono"
                            style={{ color: "var(--fg-3)" }}
                          >
                            {flag}/{actual}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </button>
            {/* Between the RO information and the hours, in that order — its own
                control with its own edge, rather than something crowding the
                hours column. The row's tap area still covers the hours (see
                .ro-row-main::after); this button sits above it. */}
            {upsellShortcut && (
              <button
                type="button"
                className="ro-upsell"
                onClick={() => setOpen({ id: e.id, addLine: true })}
                aria-label={`Add an upsell to RO ${e.roNumber}`}
              >
                <Plus size={13} aria-hidden="true" />
                Upsell
              </button>
            )}
            <div className="hours tabular">
              {fmtHours(e.flagHours)}
              <span className="unit">h</span>
            </div>
            </div>
          );
        })}
      </div>

      {capped && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="ro-show-all"
        >
          Show all {entries.length} ROs
          <span className="text-[var(--fg-3)]"> · {hiddenCount} hidden</span>
        </button>
      )}

      {!onRowClick && openEntry && (
        <RoDetailModal
          entry={openEntry}
          library={library}
          rates={rates}
          autoOpenAddLine={open?.addLine}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
