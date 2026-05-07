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

function groupByDate(entries: Entry[]): { date: string; entries: Entry[] }[] {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date)!.push(e);
  }
  return Array.from(map.entries())
    .map(([date, entries]) => ({ date, entries }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function formatGroupLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <main className="app-main" style={{ paddingBottom: 80 }}>
      <div className="section-title">
        <span>History</span>
      </div>

      {/* Filter chips */}
      <div className="filter-row">
        {CHIPS.map((chip) => (
          <button
            key={chip.kind}
            type="button"
            onClick={() => setFilter(chip.kind)}
            className={`filter-chip${filter === chip.kind ? " active" : ""}`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {filter === "custom" && (
        <div className="card padded" style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <label style={{ display: "block" }}>
            <div className="field-label">From</div>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="input"
            />
          </label>
          <label style={{ display: "block" }}>
            <div className="field-label">To</div>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="input"
            />
          </label>
        </div>
      )}

      {/* Search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--bg-0)",
          border: "1px solid var(--line-soft)",
          borderRadius: 8,
          padding: "0 12px",
        }}
      >
        <Search style={{ width: 16, height: 16, color: "var(--fg-3)", flexShrink: 0 }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search RO#, vehicle, or notes"
          className="input"
          style={{ border: "none", background: "transparent", flex: 1, padding: "8px 0" }}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            style={{ color: "var(--fg-3)", display: "flex", alignItems: "center" }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="history-summary">
        <div>
          <span className="k">ROs</span>
          <span className="v">{filtered.length}</span>
        </div>
        <div>
          <span className="k">Flag</span>
          <span className="v" style={{ color: "var(--brand)" }}>
            {fmtHours(totalFlag)}h
          </span>
        </div>
        <div>
          <span className="k">Actual</span>
          <span className="v">{fmtHours(totalActual)}h</span>
        </div>
      </div>

      {/* Grouped by day */}
      {groups.length === 0 ? (
        <div className="card padded" style={{ textAlign: "center" }}>
          <p style={{ fontSize: "0.875rem" }}>No ROs in this range.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groups.map((group) => {
            const groupFlag = group.entries.reduce((s, e) => s + e.flagHours, 0);
            const groupActual = group.entries.reduce(
              (s, e) => s + e.opCodes.reduce((ss, oc) => ss + (oc.actualHours ?? 0), 0),
              0,
            );
            const eff = groupActual > 0 ? groupFlag / groupActual : null;

            return (
              <div key={group.date} className="card flush">
                <div
                  style={{
                    padding: "11px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "var(--bg-1)",
                    borderBottom: "1px solid var(--line-soft)",
                  }}
                >
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
                    {formatGroupLabel(group.date)}
                  </span>
                  <span style={{ display: "flex", gap: 10, alignItems: "center", fontSize: "0.75rem" }}>
                    <span style={{ color: "var(--brand)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtHours(groupFlag)}h
                    </span>
                    {eff !== null && (
                      <span style={{ color: "var(--fg-3)", fontVariantNumeric: "tabular-nums" }}>
                        {Math.round(eff * 100)}%
                      </span>
                    )}
                  </span>
                </div>
                <RoList entries={group.entries} library={library} />
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
