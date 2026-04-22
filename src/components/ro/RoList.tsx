"use client";

import { useState } from "react";
import type { Entry, OpCode } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { RoDetailModal } from "./RoDetailModal";

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
}: {
  entries: Entry[];
  library?: OpCode[];
  emptyState?: React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const openEntry = openId ? entries.find((e) => e.id === openId) : null;

  if (entries.length === 0) {
    return emptyState ? (
      <>{emptyState}</>
    ) : (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
        <p className="text-sm text-zinc-400">No ROs in this range.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900">
        {entries.map((e) => {
          const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
            .filter(Boolean)
            .join(" ")
            .trim();
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setOpenId(e.id)}
                className="w-full px-4 py-3 text-left transition-colors hover:bg-zinc-800/60"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-orange-400">
                      #{e.roNumber}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {formatDateShort(e.date)}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-zinc-100">
                    {fmtHours(e.flagHours)}h
                  </span>
                </div>
                {vehicle && (
                  <div className="mt-0.5 truncate text-xs text-zinc-400">
                    {vehicle}
                  </div>
                )}
                {e.opCodes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {e.opCodes.map((line) => {
                      const code = lineCode(line, libraryById);
                      const actual =
                        line.actualHours !== null
                          ? fmtHours(line.actualHours)
                          : "—";
                      return (
                        <span
                          key={line.id}
                          className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300"
                        >
                          <span className="font-mono text-orange-400">
                            {code}
                          </span>
                          <span className="ml-1.5 text-zinc-500">
                            {fmtHours(line.flagHours)}/{actual}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {openEntry && (
        <RoDetailModal
          entry={openEntry}
          library={library}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
