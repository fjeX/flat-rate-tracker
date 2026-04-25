"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Entry, OpCode, UserSettings } from "@/lib/types";
import {
  endOfMonth,
  endOfWeek,
  getPeriodForDate,
  startOfMonth,
  startOfWeek,
} from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { RoList } from "@/components/ro/RoList";

type FilterKind = "today" | "week" | "period" | "month" | "all" | "custom";

const CHIPS: { kind: FilterKind; label: string }[] = [
  { kind: "today", label: "Today" },
  { kind: "week", label: "This Week" },
  { kind: "period", label: "Pay Period" },
  { kind: "month", label: "This Month" },
  { kind: "all", label: "All" },
  { kind: "custom", label: "Custom" },
];

function getRange(
  kind: FilterKind,
  today: string,
  settings: UserSettings,
  custom: { from: string; to: string },
): { start: string; end: string } | null {
  switch (kind) {
    case "today":
      return { start: today, end: today };
    case "week":
      return { start: startOfWeek(today), end: endOfWeek(today) };
    case "period": {
      const p = getPeriodForDate(
        today,
        settings.splitDay,
        settings.periodOverrides,
      );
      return { start: p.start, end: p.end };
    }
    case "month":
      return { start: startOfMonth(today), end: endOfMonth(today) };
    case "all":
      return null;
    case "custom":
      return { start: custom.from, end: custom.to };
  }
}

export function HistoryView({
  entries,
  library,
  settings,
  today,
}: {
  entries: Entry[];
  library: OpCode[];
  settings: UserSettings;
  today: string;
}) {
  const [filter, setFilter] = useState<FilterKind>("all");
  const [customFrom, setCustomFrom] = useState<string>(today);
  const [customTo, setCustomTo] = useState<string>(today);
  const [search, setSearch] = useState("");

  const range = getRange(filter, today, settings, {
    from: customFrom,
    to: customTo,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (range && (e.date < range.start || e.date > range.end)) return false;
      if (q) {
        const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
          .join(" ")
          .toLowerCase();
        const haystack = `${e.roNumber} ${vehicle} ${e.notes}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [entries, range, search]);

  const totalFlag = filtered.reduce((s, e) => s + e.flagHours, 0);
  const totalActual = filtered.reduce(
    (s, e) =>
      s + e.opCodes.reduce((ss, oc) => ss + (oc.actualHours ?? 0), 0),
    0,
  );

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 pb-16">
      <h1 className="text-xl font-semibold">History</h1>

      {/* Filter chips */}
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex min-w-max gap-2">
          {CHIPS.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              onClick={() => setFilter(chip.kind)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === chip.kind
                  ? "bg-orange-600 text-white"
                  : "border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom range inputs */}
      {filter === "custom" && (
        <div className="flex items-end gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">
              From
            </span>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="mt-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm focus:border-orange-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">
              To
            </span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="mt-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm focus:border-orange-500 focus:outline-none"
            />
          </label>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3">
        <Search className="h-4 w-4 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search RO#, vehicle, or notes"
          className="w-full bg-transparent py-2 text-sm placeholder-zinc-600 focus:outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs">
        <span className="text-zinc-400">
          <span className="font-semibold text-zinc-100">
            {filtered.length}
          </span>{" "}
          RO{filtered.length === 1 ? "" : "s"}
        </span>
        <span className="text-zinc-400">
          <span className="font-semibold text-orange-400">
            {fmtHours(totalFlag)}h
          </span>{" "}
          flag
        </span>
        <span className="text-zinc-400">
          <span className="font-semibold text-zinc-100">
            {fmtHours(totalActual)}h
          </span>{" "}
          actual
        </span>
      </div>

      {/* List */}
      <RoList entries={filtered} library={library} />
    </main>
  );
}
