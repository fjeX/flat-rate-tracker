"use client";

import { useMemo, useState } from "react";
import { loadMoreEntries } from "@/app/actions/entries";
import { Camera, Search, X } from "lucide-react";
import type { Entry, OpCode, UserSettings } from "@/lib/types";
import {
  endOfMonth,
  endOfWeek,
  getPeriodForDate,
  startOfMonth,
  startOfWeek,
} from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import type { RateMap } from "@/lib/earnings";
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import { EmptyState } from "@/components/ui/EmptyState";
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
  hasPhoto = false,
}: {
  entry: Entry;
  today: string;
  onOpen: () => void;
  hasPhoto?: boolean;
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
          {hasPhoto && (
            <Camera
              size={13}
              aria-label="Has photo"
              style={{ color: "var(--fg-3)", flexShrink: 0, alignSelf: "center" }}
            />
          )}
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
  hasMore: hasMoreProp = false,
  library,
  settings,
  today,
  weekStart: weekStartProp,
  weekEnd: weekEndProp,
  weekStartDay,
  renderDetail,
  rates = {},
  entryIdsWithPhotos,
}: {
  entries: Entry[];
  hasMore?: boolean;
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
  rates?: RateMap;
  // Entry ids that have at least one attached photo — drives the camera icon.
  // Absent in guest mode (no photo storage).
  entryIdsWithPhotos?: Set<string>;
}) {
  // `entries` comes from the live store. In guest mode it hydrates from
  // sessionStorage in an effect AFTER first render, so freezing it into state
  // here would strand the page on the empty initial value. Keep `entries` live
  // and track paginated ("load more") rows separately.
  const [extraEntries, setExtraEntries] = useState<Entry[]>([]);
  const [hasMore, setHasMore] = useState(hasMoreProp);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("period");
  const [sortBy, setSortBy] = useState<SortKind>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const allEntries = useMemo(
    () => [...entries, ...extraEntries],
    [entries, extraEntries],
  );

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const next = await loadMoreEntries(allEntries.length);
      setExtraEntries((prev) => [...prev, ...next]);
      setHasMore(next.length === 100);
    } finally {
      setLoadingMore(false);
    }
  }

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
    return allEntries
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
  }, [allEntries, range, search, sortBy, sortDir]);

  const openEntry = openId ? allEntries.find((e) => e.id === openId) ?? null : null;

  return (
    <main className="app-main" style={{ paddingBottom: 80 }}>
      <h1 className="sr-only">History</h1>
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

      {/* Bar chart — mirrors the dashboard "Flagged Hours" chart */}
      <HistoryBarChart
        entries={allEntries}
        filter={filter}
        today={today}
        weekStart={weekStartProp}
        weekEnd={weekEndProp}
        splitDay={settings.splitDay}
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
        <div className="card flush" style={{ marginTop: 12 }}>
          <EmptyState
            icon={<Search size={22} />}
            title="No ROs in this range"
            description={
              search.trim()
                ? "No matches — try a different search."
                : "Pick another range above, or log an RO to fill this in."
            }
          />
        </div>
      ) : (
        <div className="card flush" style={{ marginTop: 12 }}>
          {filtered.map((entry) => (
            <RoRow
              key={entry.id}
              entry={entry}
              today={today}
              onOpen={() => setOpenId(entry.id)}
              hasPhoto={entryIdsWithPhotos?.has(entry.id) ?? false}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="filter-chip"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {openEntry && (
        renderDetail
          ? renderDetail(openEntry, () => setOpenId(null))
          : <RoDetailModal entry={openEntry} library={library} rates={rates} onClose={() => setOpenId(null)} />
      )}
    </main>
  );
}
