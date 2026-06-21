"use client";

import { useState } from "react";
import { ClipboardList } from "lucide-react";
import type { Entry, OpCode } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
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
  emptyState,
  onRowClick,
}: {
  entries: Entry[];
  library?: OpCode[];
  emptyState?: React.ReactNode;
  onRowClick?: (entry: Entry) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const openEntry = openId ? entries.find((e) => e.id === openId) : null;

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
        {entries.map((e) => {
          const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
            .filter(Boolean)
            .join(" ")
            .trim();
          return (
            <button
              key={e.id}
              type="button"
              className="ro-row"
              onClick={() => onRowClick ? onRowClick(e) : setOpenId(e.id)}
            >
              <div className="grow">
                <div>
                  <span className="ro-num">#{e.roNumber}</span>
                  <span className="ro-meta">· {formatDateShort(e.date)}</span>
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
              <div className="hours tabular">
                {fmtHours(e.flagHours)}
                <span className="unit">h</span>
              </div>
            </button>
          );
        })}
      </div>

      {!onRowClick && openEntry && (
        <RoDetailModal
          entry={openEntry}
          library={library}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
