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
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import { HistoryBarChart } from "./HistoryBarChart";

type FilterKind = "today" | "week" | "period" | "month" | "all";
type SortKind = "date" | "hours" | "ro_number";
type SortDir = "desc" | "asc";

const CHIPS: { kind: FilterKind; label: string }[] = [
  { kind: "today",  label: "Today" },
  { kind: "week",   label: "Week" },
  { kind: "period", label: "Period" },
  { kind: "month",  label: "Month" },
  { kind: "all",    label: "All" },
];

const SORT_CHIPS: { kind: SortKind; label: string }[] = [
  { kind: "date",      label: "Date" },
  { kind: "hours",     label: "Hours" },
  { kind: "ro_number", label: "RO #" },
];

const GOAL_HOURS = 88;

function getRange(
  kind: FilterKind,
  today: string,
  settings: UserSettings,
  weekStartDay: 0 | 1,
): { start: string; end: string } | null {
  switch (kind) {
    case "today":
      return { start: today, end: today };
    case "week":
      return { start: startOfWeek(today, weekStartDay), end: endOfWeek(today, weekStartDay) };
    case "period": {
      const p = getPeriodForDate(today, settings.splitDay, settings.periodOverrides);
      return { start: p.start, end: p.end };
    }
    case "month":
      return { start: startOfMonth(today), end: endOfMonth(today) };
    case "all":
      return null;
  }
}

// Format a time string from an ISO timestamp, e.g. "2:14 PM"
function fmtTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtRowDate(date: string, today: string, createdAt: string): string {
  const yesterday = (() => {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const time = fmtTime(createdAt);
  if (date === today) return `Today · ${time}`;
  if (date === yesterday) return `Yesterday · ${time}`;
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d} · ${time}`;
}

function RoRow({
  entry,
  today,
  onOpen,
}: {
  entry: Entry;
  today: string;
  onOpen: () => void;
}) {
  const vehicle = [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model]
    .filter(Boolean)
    .join(" ")
    .trim();
  const dateLine = fmtRowDate(entry.date, today, entry.createdAt);

  return (
    <button
      type="button"
      className="history-ro-row"
      onClick={onOpen}
      style={{ width: "100%", textAlign: "left", background: "transparent", border: "none" }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span className="history-ro-num">#{entry.roNumber}</span>
        </div>
        <div className="history-ro-meta">{dateLine}</div>
        {vehicle && <div className="history-ro-vehicle">{vehicle}</div>}
      </div>
      <div className="history-ro-hours">
        {fmtHours(entry.flagHours)}
        <span style={{ color: "var(--fg-3)", fontWeight: 500, fontSize: 12 }}>h</span>
      </div>
    </button>
  );
}

export function HistoryView({
  entries,
  library,
  settings,
  today,
  periodStart: periodStartProp,
  periodEnd: periodEndProp,
  weekStart: weekStartProp,
  weekEnd: weekEndProp,
  monthStart: monthStartProp,
  monthEnd: monthEndProp,
  weekStartDay,
  renderDetail,
}: {
  entries: Entry[];
  library: OpCode[];
  settings: UserSettings;
  today: string;
  periodStart: string;
  periodEnd: string;
  weekStart: string;
  weekEnd: string;
  monthStart: string;
  monthEnd: string;
  weekStartDay: 0 | 1;
  renderDetail?: (entry: Entry, onClose: () => void) => React.ReactNode;
}) {
  const [filter, setFilter] = useState<FilterKind>("period");
  const [sortBy, setSortBy] = useState<SortKind>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  function handleSortClick(kind: SortKind) {
    if (sortBy === kind) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(kind);
      setSortDir("desc");
    }
  }

  const range = getRange(filter, today, settings, weekStartDay);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries
      .filter((e) => {
        if (range && (e.date < range.start || e.date > range.end)) return false;
        if (q) {
          const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
            .join(" ")
            .toLowerCase();
          const haystack = `${e.roNumber} ${vehicle} ${e.notes}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortBy === "date") {
          cmp = a.createdAt.localeCompare(b.createdAt);
        } else if (sortBy === "hours") {
          cmp = a.flagHours - b.flagHours;
        } else if (sortBy === "ro_number") {
          cmp = a.roNumber.localeCompare(b.roNumber, undefined, { numeric: true });
        }
        return sortDir === "desc" ? -cmp : cmp;
      });
  }, [entries, range, search, sortBy, sortDir]);

  // Period flag hours for the chart header
  const periodFlagHours = useMemo(
    () =>
      entries
        .filter((e) => e.date >= periodStartProp && e.date <= periodEndProp)
        .reduce((s, e) => s + e.flagHours, 0),
    [entries, periodStartProp, periodEndProp],
  );

  // Entries scoped to chart's filter (not search-filtered, so chart always shows full picture)
  const chartEntries = useMemo(() => {
    if (!range) return entries;
    return entries.filter((e) => e.date >= range.start && e.date <= range.end);
  }, [entries, range]);

  const openEntry = openId ? entries.find((e) => e.id === openId) ?? null : null;

  return (
    <main className="app-main" style={{ paddingBottom: 80 }}>
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

      {/* Sort chips */}
      <div className="filter-row" style={{ marginTop: 6 }}>
        <span style={{ fontSize: 12, color: "var(--fg-3)", fontWeight: 500, alignSelf: "center", flexShrink: 0 }}>
          Sort By:
        </span>
        {SORT_CHIPS.map((chip) => {
          const active = sortBy === chip.kind;
          const arrow = active ? (sortDir === "desc" ? " ↓" : " ↑") : "";
          return (
            <button
              key={chip.kind}
              type="button"
              onClick={() => handleSortClick(chip.kind)}
              className={`filter-chip${active ? " active" : ""}`}
            >
              {chip.label}{arrow}
            </button>
          );
        })}
      </div>

      {/* Bar chart */}
      <HistoryBarChart
        entries={chartEntries}
        filter={filter}
        today={today}
        periodStart={periodStartProp}
        periodEnd={periodEndProp}
        weekStart={weekStartProp}
        weekEnd={weekEndProp}
        monthStart={monthStartProp}
        monthEnd={monthEndProp}
        periodFlagHours={periodFlagHours}
        goalHours={GOAL_HOURS}
      />

      {/* Search bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--bg-0)",
          border: "1px solid var(--line-soft)",
          borderRadius: 8,
          padding: "0 12px",
          marginTop: 12,
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
            style={{ color: "var(--fg-3)", display: "flex", alignItems: "center", background: "transparent", border: "none", cursor: "pointer" }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>

      {/* Flat RO list */}
      {filtered.length === 0 ? (
        <div className="card padded" style={{ textAlign: "center", marginTop: 12 }}>
          <p style={{ fontSize: "0.875rem", color: "var(--fg-3)", margin: 0 }}>No ROs in this range.</p>
        </div>
      ) : (
        <div className="card flush" style={{ marginTop: 12 }}>
          {filtered.map((entry) => (
            <RoRow
              key={entry.id}
              entry={entry}
              today={today}
              onOpen={() => setOpenId(entry.id)}
            />
          ))}
        </div>
      )}

      {openEntry && (
        renderDetail
          ? renderDetail(openEntry, () => setOpenId(null))
          : <RoDetailModal entry={openEntry} library={library} onClose={() => setOpenId(null)} />
      )}
    </main>
  );
}
