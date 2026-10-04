"use client";

// History, in the final design language (phase 5 sketch; no mock screen
// existed for this page). Same features as before, re-arranged: one range
// control, a sort control and a search well up top; the Flagged hours chart
// in its zone; then the ROs as tags (the same object the dashboard and Pay
// Period draw), grouped under a day heading while the list is in date order.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadEntriesInRange, loadMoreEntries } from "@/app/actions/entries";
import { Camera, Download, Search, X } from "lucide-react";
import type { Entry, OpCode, UserSettings } from "@/lib/types";
import {
  endOfMonth,
  endOfWeek,
  formatDateShort,
  formatLoggedTime,
  getPeriodForDate,
  startOfMonth,
  startOfWeek,
} from "@/lib/periods";
import { fmtHours, type DayDenom } from "@/lib/stats";
import type { RateMap } from "@/lib/earnings";
import { lineCode } from "@/lib/line-code";
import { entryMatchesSearch, findSearchMatches, matchSnippet, type SearchField } from "@/lib/history-search";
import { buildHistoryCsv, csvFilename } from "@/lib/csv-export";
import { buildHistoryQuery, type HistoryRange, type HistorySort, type HistoryDir, type HistoryUrlState } from "@/lib/history-url";
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import type { JobTiming } from "@/lib/rankings";
import { RoTag } from "@/components/dashboard/RoTag";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DurationBar } from "@/components/ui/DurationBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { withPt } from "@/components/ui/Figure";
import { Zone } from "@/components/ui/Zone";
import { HistoryBarChart, customByDay, type BarRange, type ChartRow } from "./HistoryBarChart";

type FilterKind = HistoryRange;
type SortKind = HistorySort;
type SortDir = HistoryDir;

const CHIPS: { kind: FilterKind; label: string }[] = [
  { kind: "today",  label: "Today" },
  { kind: "week",   label: "Week" },
  { kind: "period", label: "Period" },
  { kind: "month",  label: "Month" },
  { kind: "all",    label: "All" },
  { kind: "custom", label: "Custom" },
];

const SORT_CHIPS: { kind: SortKind; label: string }[] = [
  { kind: "date",      label: "Date" },
  { kind: "hours",     label: "Hours" },
  { kind: "ro_number", label: "RO #" },
];

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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
    case "custom": // the page owns the custom dates
      return null;
  }
}

// Format a time string from an ISO timestamp, e.g. "2:14 PM".
// `tz` pins the output to the user's timezone so the server render (container
// clock, usually UTC) matches the client render — without it this line was a
// guaranteed hydration mismatch (React error 418) for any non-UTC user.
function fmtTime(isoTimestamp: string, tz?: string): string {
  const d = new Date(isoTimestamp);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

/**
 * The time on one row.
 *
 * WHICH TIME THIS IS — the one decision worth reading before changing it.
 *
 * This row has always shown `created_at`: when the RO was written down. That is
 * a decent stand-in for a tech who logs jobs as they finish them, and a bad one
 * for a tech who writes the whole day up at 9pm — every row reads 9:47 PM.
 *
 * `logged_time` is the answer to the question this slot was always ASKING, so it
 * wins when it exists. The fallback is unchanged, so no existing row loses
 * anything, and no row ever shows both — one slot, one value, best available.
 */
function rowTime(entry: Entry, tz?: string): string {
  return formatLoggedTime(entry.loggedTime) ?? fmtTime(entry.createdAt, tz);
}

function yesterdayOf(today: string): string {
  const d = new Date(today + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** "Today", "Yesterday", "Thu, Mar 12". */
function dayHeading(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === yesterdayOf(today)) return "Yesterday";
  const wd = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
  return `${wd}, ${formatDateShort(date)}`;
}

/** "March 2026". */
function monthHeading(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

const MATCH_LABEL: Record<SearchField, string> = {
  ro: "RO #",
  vehicle: "Vehicle",
  op: "Op code",
  note: "Note",
};

/** "Apr 1" for one day, "Apr 1 – Apr 7" for a span: the label a bar picked from the URL wears. */
function barLabel(start: string, end: string): string {
  return start === end ? formatDateShort(start) : `${formatDateShort(start)} – ${formatDateShort(end)}`;
}

/**
 * The rows History shows for a set of loaded ROs: the active date span, the
 * search box, then the chosen sort. One copy, used by the list AND by the CSV
 * export, so the file can never disagree with the screen about what "matches".
 */
function selectRows(
  list: Entry[],
  f: {
    noRange: boolean;
    range: { start: string; end: string } | null;
    search: string;
    libraryById: Map<string, OpCode>;
    sortBy: SortKind;
    sortDir: SortDir;
  },
): Entry[] {
  return list
    .filter((e) => {
      if (f.noRange) return false;
      if (f.range && (e.date < f.range.start || e.date > f.range.end)) return false;
      return entryMatchesSearch(e, f.search, f.libraryById);
    })
    .sort((a, b) => {
      let cmp = 0;
      if (f.sortBy === "date") {
        cmp = a.createdAt.localeCompare(b.createdAt);
      } else if (f.sortBy === "hours") {
        cmp = a.flagHours - b.flagHours;
      } else if (f.sortBy === "ro_number") {
        cmp = a.roNumber.localeCompare(b.roNumber, undefined, { numeric: true });
      }
      return f.sortDir === "desc" ? -cmp : cmp;
    });
}

type Group = { key: string; heading: string; entries: Entry[]; hours: number };

export function HistoryView({
  entries,
  hasMore: hasMoreProp = false,
  library,
  settings,
  today,
  tz,
  weekStart: weekStartProp,
  weekEnd: weekEndProp,
  weekStartDay,
  renderDetail,
  rates = {},
  entryIdsWithPhotos,
  denomByDay,
  chartRows,
  jobTimings,
  initial,
}: {
  entries: Entry[];
  hasMore?: boolean;
  library: OpCode[];
  settings: UserSettings;
  today: string;
  // User's IANA timezone (from the frt_timezone cookie). Keeps server- and
  // client-rendered timestamps identical; omitted in guest mode, where rows
  // only render after sessionStorage hydration (client-only, no mismatch).
  tz?: string;
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
  // Per-day efficiency denominators for the chart readout. Absent in guest mode.
  denomByDay?: Record<string, DayDenom>;
  // Every RO on the account as (date, flag hours), for the chart. The list
  // pages 100 at a time, so drawing bars from the loaded rows left older
  // periods and months short. Absent in guest mode: local entries are all of them.
  chartRows?: ChartRow[];
  // Every timed line on the account, slimmed, for the RO detail's "3rd fastest
  // of 9" sentence. All-time, from the same full read as chartRows. Absent in
  // guest mode: GuestRoDetailModal reads the guest store itself.
  jobTimings?: JobTiming[];
  // Filters read from the URL on the server, so the first render already shows
  // the view the tech left. Absent in guest mode: defaults.
  initial?: HistoryUrlState;
}) {
  // `entries` comes from the live store. In guest mode it hydrates from
  // sessionStorage in an effect AFTER first render, so freezing it into state
  // here would strand the page on the empty initial value. Keep `entries` live
  // and track paginated ("load more") rows separately.
  const router = useRouter();
  const [extraEntries, setExtraEntries] = useState<Entry[]>([]);
  const [hasMore, setHasMore] = useState(hasMoreProp);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<FilterKind>(initial?.range ?? "period");
  const [sortBy, setSortBy] = useState<SortKind>(initial?.sort ?? "date");
  const [sortDir, setSortDir] = useState<SortDir>(initial?.dir ?? "desc");
  const [search, setSearch] = useState(initial?.q ?? "");
  // A tapped chart bar narrows the list to that bar's dates. Cleared by tapping
  // it again, by "Show all", or by switching the range (the bars change).
  const [picked, setPicked] = useState<BarRange | null>(
    initial?.bar ? { ...initial.bar, label: barLabel(initial.bar.start, initial.bar.end) } : null,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  // Optimistically removed on delete. The 2026-07-23 fix pruned `extraEntries`
  // and called router.refresh(), which covers a row from "Load more" but NOT a
  // row on the first page — that one lives in the `entries` prop, and a refresh
  // is exactly the call that does not reliably repaint (bug c655c010, the same
  // reason RefreshFlusher exists). A freshly logged RO is the newest row, so it
  // is always on the first page: the common case was the uncovered one.
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(() => new Set());

  // Custom range: two dates the tech types, both inclusive. Starts on the
  // current pay period so the first tap shows something familiar.
  const [customFrom, setCustomFrom] = useState(
    () => initial?.from ?? getPeriodForDate(today, settings.splitDay, settings.periodOverrides).start,
  );
  const [customTo, setCustomTo] = useState(initial?.to ?? today);
  // ROs fetched for the custom range. Only the newest page is loaded up front,
  // so a range in the past is asked of the server: filtering whatever happens
  // to be loaded would quietly drop the older ROs. Kept apart from the paged
  // rows so "Load more" offsets still count pages only.
  const [rangeEntries, setRangeEntries] = useState<Entry[]>([]);
  const [rangeLoading, setRangeLoading] = useState(false);
  // The from_to that rangeEntries fully covers. The Custom chip count is only
  // exact once this matches the dates on screen.
  const [rangeKey, setRangeKey] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const rangeRequest = useRef(0);

  const customOrderError =
    customFrom && customTo && customFrom > customTo
      ? "The From date must be on or before the To date."
      : null;
  const customRange = useMemo(
    () => (customFrom && customTo && !customOrderError ? { start: customFrom, end: customTo } : null),
    [customFrom, customTo, customOrderError],
  );

  const libraryById = useMemo(() => new Map(library.map((oc) => [oc.id, oc])), [library]);

  const pagedEntries = useMemo(
    () => [...entries, ...extraEntries].filter((e) => !deletedIds.has(e.id)),
    [entries, extraEntries, deletedIds],
  );

  // One copy per RO: a range fetch overlaps the paged rows, and the paged
  // copy wins (the first page is the one a refresh keeps current).
  const allEntries = useMemo(() => {
    const seen = new Set(pagedEntries.map((e) => e.id));
    const fromRange = rangeEntries.filter((e) => !seen.has(e.id) && !deletedIds.has(e.id));
    return [...pagedEntries, ...fromRange];
  }, [pagedEntries, rangeEntries, deletedIds]);

  /** Ask the server for every RO in from..to, unless everything is loaded. */
  async function fetchRange(from: string, to: string) {
    setRangeError(null);
    if (!hasMore || !from || !to || from > to) return;
    const id = ++rangeRequest.current;
    setRangeLoading(true);
    try {
      const res = await loadEntriesInRange(from, to);
      if (id !== rangeRequest.current) return; // a newer range was asked for
      if ("error" in res) setRangeError(res.error);
      else {
        setRangeEntries(res.entries);
        setRangeKey(from + "_" + to);
      }
    } catch {
      if (id === rangeRequest.current) setRangeError("Couldn't load ROs for those dates. Try again.");
    } finally {
      if (id === rangeRequest.current) setRangeLoading(false);
    }
  }

  function setCustom(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
    setPicked(null);
    void fetchRange(from, to);
  }

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const next = await loadMoreEntries(pagedEntries.length);
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

  // A link that opens on Custom: the older ROs are not in the first page, so ask
  // for them once on mount, exactly as tapping the Custom chip does.
  // Deferred a tick so the effect body sets no state itself; the cleanup keeps
  // dev StrictMode's double-run to a single request.
  useEffect(() => {
    if (filter !== "custom") return;
    const t = setTimeout(() => void fetchRange(customFrom, customTo), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the filters into the query string. replaceState, not router.replace:
  // the router would round-trip to the server for every keystroke, and a
  // filter tweak should not fill the back button. Typing waits 300ms so a word
  // is one write; any other change writes straight away.
  const lastSearchRef = useRef(search);
  useEffect(() => {
    const delay = lastSearchRef.current !== search ? 300 : 0;
    lastSearchRef.current = search;
    const t = setTimeout(() => {
      try {
        const qs = buildHistoryQuery(
          {
            range: filter,
            from: customFrom,
            to: customTo,
            q: search,
            sort: sortBy,
            dir: sortDir,
            bar: picked ? { start: picked.start, end: picked.end } : null,
          },
          window.location.search,
        );
        window.history.replaceState(null, "", window.location.pathname + qs + window.location.hash);
      } catch {}
    }, delay);
    return () => clearTimeout(t);
  }, [filter, customFrom, customTo, search, sortBy, sortDir, picked]);

  const isCustom = filter === "custom";
  const range = picked ?? (isCustom ? customRange : getRange(filter, today, settings, weekStartDay));
  // Custom with a missing or backwards date shows nothing rather than everything.
  const noRange = isCustom && !range;

  const filtered = useMemo(
    () => selectRows(allEntries, { noRange, range, search, libraryById, sortBy, sortDir }),
    [allEntries, noRange, range, search, libraryById, sortBy, sortDir],
  );

  const shownHours = filtered.reduce((s, e) => s + e.flagHours, 0);

  // Counts on the range chips. Only the newest page of ROs is loaded, so a
  // count is a fact only when the loaded rows cover the whole range:
  //   - everything is loaded (no more pages), or
  //   - the range starts on a day newer than the oldest loaded RO (the day the
  //     page cut can still hold unloaded ROs, hence strictly newer), or
  //   - Custom, once its own fetch for exactly these dates has landed.
  // Otherwise the loaded rows are a floor, not the answer, so the chip says
  // "23+" rather than a number that reads as final. "All" with more pages
  // therefore reads "100+", never "100". A floor of zero is no information and
  // shows nothing; so does Custom while loading, errored, or not yet fetched
  // (a lower bound there would flicker as the fetch lands). Counts follow the
  // range and deleted-in-session ROs, and ignore the search box.
  const chipCounts = useMemo(() => {
    const out: Partial<Record<FilterKind, { text: string; exact: boolean; n: number }>> = {};
    let oldest: string | null = null;
    for (const e of pagedEntries) if (oldest === null || e.date < oldest) oldest = e.date;
    for (const chip of CHIPS) {
      const r = chip.kind === "custom" ? customRange : getRange(chip.kind, today, settings, weekStartDay);
      if (chip.kind === "custom" && !r) continue;
      const n = r
        ? allEntries.reduce((c, e) => (e.date >= r.start && e.date <= r.end ? c + 1 : c), 0)
        : allEntries.length;
      const covered = !hasMore || (r !== null && oldest !== null && r.start > oldest);
      const fetched =
        chip.kind === "custom" &&
        r !== null &&
        !rangeLoading &&
        !rangeError &&
        rangeKey === r.start + "_" + r.end;
      if (covered || fetched) out[chip.kind] = { text: String(n), exact: true, n };
      else if (chip.kind !== "custom" && n > 0) out[chip.kind] = { text: n + "+", exact: false, n };
    }
    return out;
  }, [allEntries, pagedEntries, hasMore, customRange, today, settings, weekStartDay, rangeLoading, rangeError, rangeKey]);

  // Groups only make sense in date order. Day groups for the short ranges;
  // month groups once the range spans months. Any other sort is one flat
  // list, and each tag carries its full date instead.
  const grouped = sortBy === "date";
  // A picked bar is at most one month, so it always reads by day.
  const byMonth =
    !picked && (filter === "month" || filter === "all" || (isCustom && !customByDay(customRange)));
  const groups: Group[] = useMemo(() => {
    if (!grouped) return [{ key: "all", heading: "", entries: filtered, hours: shownHours }];
    const out: Group[] = [];
    for (const e of filtered) {
      const key = byMonth ? e.date.slice(0, 7) : e.date;
      const last = out[out.length - 1];
      if (last && last.key === key) {
        last.entries.push(e);
        last.hours += e.flagHours;
      } else {
        out.push({
          key,
          heading: byMonth ? monthHeading(key) : dayHeading(key, today),
          entries: [e],
          hours: e.flagHours,
        });
      }
    }
    return out;
  }, [grouped, byMonth, filtered, shownHours, today]);

  // CSV of exactly the rows on screen. The list pages 100 ROs at a time, so
  // when more exist the loaded rows are only a floor of what the filters match;
  // an export from them would be a quietly short file. In that case ask the
  // server for the whole span first (the same call Custom uses) and run the
  // SAME filter and sort over the result. A custom range whose own fetch has
  // already landed, and any view with nothing left to page, export as loaded.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  async function handleExport() {
    setExportError(null);
    const covered =
      !hasMore ||
      (isCustom &&
        !picked &&
        range !== null &&
        !rangeLoading &&
        !rangeError &&
        rangeKey === range.start + "_" + range.end);
    let rows = filtered;
    if (!covered) {
      setExporting(true);
      try {
        // "All" has no span; the widest valid one is the whole account.
        const res = await loadEntriesInRange(range?.start ?? "1970-01-01", range?.end ?? "9999-12-31");
        if ("error" in res) {
          setExportError(res.error);
          return;
        }
        const seen = new Set(allEntries.map((e) => e.id));
        const fetched = res.entries.filter((e) => !seen.has(e.id) && !deletedIds.has(e.id));
        rows = selectRows([...allEntries, ...fetched], { noRange, range, search, libraryById, sortBy, sortDir });
      } catch {
        setExportError("Couldn't load every RO for the export. Try again.");
        return;
      } finally {
        setExporting(false);
      }
    }
    const csv = buildHistoryCsv({
      entries: rows,
      library,
      filters: {
        range: filter,
        from: customFrom,
        to: customTo,
        q: search,
        sort: sortBy,
        dir: sortDir,
        bar: picked ? { start: picked.start, end: picked.end } : null,
      },
      span: range,
      exportedAt: new Date(),
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFilename(today);
    a.click();
    URL.revokeObjectURL(url);
  }

  const openEntry = openId ? allEntries.find((e) => e.id === openId) ?? null : null;

  return (
    <main className="hist-page">
      <div className="pagehead">
        <div className="grow">
          <h1>History</h1>
          <p>
            <span className="num">{filtered.length}</span> {filtered.length === 1 ? "RO" : "ROs"} ·{" "}
            <span className="num">{withPt(fmtHours(shownHours))}</span>h in this range
          </p>
        </div>
      </div>

      <div className="hist-ctl">
        <div className="seg hist-range" role="group" aria-label="Range">
          {CHIPS.map((chip) => {
            const count = chipCounts[chip.kind];
            return (
            <button
              key={chip.kind}
              type="button"
              aria-pressed={filter === chip.kind}
              aria-label={
                count
                  ? chip.label + ", " + (count.exact ? "" : "at least ") + count.n + (count.n === 1 ? " RO" : " ROs")
                  : chip.label
              }
              onClick={() => {
                setFilter(chip.kind);
                setPicked(null);
                if (chip.kind === "custom") void fetchRange(customFrom, customTo);
              }}
            >
              {chip.label}
              <span className="hist-n num" aria-hidden="true">{count?.text}</span>
            </button>
            );
          })}
        </div>
        <div className="hist-ctl-row">
          <div className="seg" role="group" aria-label="Sort by">
            {SORT_CHIPS.map((chip) => {
              const active = sortBy === chip.kind;
              return (
                <button
                  key={chip.kind}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleSortClick(chip.kind)}
                  aria-label={`Sort by ${chip.label}${active ? `, ${sortDir === "desc" ? "descending" : "ascending"}` : ""}`}
                >
                  {chip.label}
                  {active && <span className="dir" aria-hidden="true">{sortDir === "desc" ? "↓" : "↑"}</span>}
                </button>
              );
            })}
          </div>
          <label className="search-well">
            <span className="sr-only">Search RO#, vehicle, op code, or notes</span>
            <Search aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search RO#, vehicle, op code, or notes"
              aria-label="Search RO#, vehicle, op code, or notes"
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <X size={18} />
              </button>
            )}
          </label>
        </div>
        {isCustom && (
          <div className="hist-custom">
            <div className="hist-custom-pair">
              <label className="field" htmlFor="hist-from">
                <span className="field-label">From</span>
                <input
                  id="hist-from"
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustom(e.target.value, customTo)}
                  aria-invalid={Boolean(customOrderError)}
                  aria-describedby={customOrderError ? "hist-custom-msg" : undefined}
                  className="input mono"
                />
              </label>
              <label className="field" htmlFor="hist-to">
                <span className="field-label">To</span>
                <input
                  id="hist-to"
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustom(customFrom, e.target.value)}
                  aria-invalid={Boolean(customOrderError)}
                  aria-describedby={customOrderError ? "hist-custom-msg" : undefined}
                  className="input mono"
                />
              </label>
            </div>
            {(customOrderError || rangeError) && (
              <p id="hist-custom-msg" className="field-msg field-msg-error" role="alert">
                {customOrderError ?? rangeError}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="hist-grid">
        <div className="hist-chart-col">
          <HistoryBarChart
            entries={chartRows ?? allEntries}
            filter={filter}
            today={today}
            weekStart={weekStartProp}
            weekEnd={weekEndProp}
            splitDay={settings.splitDay}
            customRange={customRange}
            denomByDay={denomByDay}
            selected={picked}
            onSelect={setPicked}
          />
        </div>

        <div>
          <Zone
            id="z-hist-ros"
            name="Repair orders"
            aside={
              filtered.length > 0 ? (
                <>
                  <span className="num">{filtered.length}</span> {filtered.length === 1 ? "RO" : "ROs"} ·{" "}
                  <span className="num">{withPt(fmtHours(shownHours))}</span>h
                </>
              ) : undefined
            }
          >
            <div className="hist-export">
              <Button
                variant="line"
                size="sm"
                onClick={() => void handleExport()}
                disabled={filtered.length === 0 || exporting}
                busy={exporting}
              >
                <Download size={16} aria-hidden="true" /> {exporting ? "Preparing…" : "Download CSV"}
              </Button>
              {exportError && (
                <p className="field-msg field-msg-error" role="alert">
                  {exportError}
                </p>
              )}
            </div>
            {picked && (
              <p className="hist-picked" aria-live="polite">
                <span>
                  Showing <b>{picked.label}</b>
                </span>
                <Button variant="quiet" size="sm" onClick={() => setPicked(null)}>
                  Show all
                </Button>
              </p>
            )}
            {filtered.length === 0 ? (
              <div className="hist-empty">
                <EmptyState
                  icon={<Search size={22} />}
                  title={rangeLoading ? "Loading ROs…" : "No ROs in this range"}
                  description={
                    rangeLoading
                      ? "Fetching the ROs between those dates."
                      : noRange
                        ? "Pick a From and a To date above."
                        : search.trim()
                          ? "No matches — try a different search."
                          : "Pick another range above, or log an RO to fill this in."
                  }
                />
              </div>
            ) : (
              <>
                <p className="scale-note">
                  <i aria-hidden="true" />
                  Bar is flagged time. This length is 1.0 hour.
                </p>
                <div className="hist-groups">
                  {groups.map((g) => (
                    <div key={g.key} className="hist-group">
                      {grouped && (
                        <h3 className="hist-group-h">
                          <span>{g.heading}</span>
                          <span className="hist-group-sum">
                            <span className="num">{g.entries.length}</span> {g.entries.length === 1 ? "RO" : "ROs"} ·{" "}
                            <span className="num">{withPt(fmtHours(g.hours))}</span>h
                          </span>
                        </h3>
                      )}
                      <ul className="tags">
                        {g.entries.map((e) => {
                          const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
                            .filter(Boolean)
                            .join(" ")
                            .trim();
                          // Under a day heading the tag needs only the time;
                          // in a flat list it carries the date too.
                          const when = grouped && !byMonth
                            ? rowTime(e, tz)
                            : `${formatDateShort(e.date)} · ${rowTime(e, tz)}`;
                          const matches = search.trim() ? findSearchMatches(e, search, libraryById) : [];
                          return (
                            <RoTag
                              key={e.id}
                              className="history-ro-row"
                              roNumber={e.roNumber}
                              onOpen={() => setOpenId(e.id)}
                              headExtra={
                                <>
                                  {e.status === "open" && <Badge tone="neutral">Open</Badge>}
                                  {entryIdsWithPhotos?.has(e.id) && (
                                    <Camera size={14} aria-label="Has photo" className="hist-photo" />
                                  )}
                                </>
                              }
                              // Until the frt_timezone cookie exists (a user's
                              // first ever page load) the server formats this
                              // time in UTC and the browser in the local zone:
                              // React error #418 on every row. The client value
                              // is the right one and React keeps it. Once the
                              // cookie is set, `tz` pins both sides.
                              when={<span suppressHydrationWarning={!tz}>{when}</span>}
                              hours={fmtHours(e.flagHours)}
                              body={
                                <>
                                  {/* vehicle and op codes share a line (compact tag) */}
                                  <div className="hist-line">
                                    {vehicle && <div className="tag-veh">{vehicle}</div>}
                                    {e.opCodes.length > 0 && (
                                      <ul className="ops" aria-label="Op codes, flagged over actual hours">
                                        {e.opCodes.map((line) => {
                                          const flag = fmtHours(line.flagHours);
                                          const actual =
                                            line.actualHours !== null ? fmtHours(line.actualHours) : "—";
                                          return (
                                            <li key={line.id}>
                                              <b>{lineCode(line, libraryById)}</b>
                                              <span className="num">
                                                {withPt(flag)}/{withPt(actual)}
                                              </span>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    )}
                                  </div>
                                  {matches.length > 0 && (
                                    <ul className="hist-match" aria-label="Matched in">
                                      {matches.map((m) => {
                                        const sn = matchSnippet(m);
                                        return (
                                          <li key={m.field}>
                                            <Badge tone="neutral">{MATCH_LABEL[m.field]}</Badge>
                                            <span className={"hist-match-text" + (m.field === "ro" ? " num" : "")}>
                                              {sn.before}
                                              <mark>{sn.hit}</mark>
                                              {sn.after}
                                            </span>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                  <DurationBar hours={e.flagHours} />
                                </>
                              }
                            />
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* a custom range is fetched whole; paging only serves the presets */}
            {hasMore && !isCustom && (
              <div className="hist-more">
                <Button variant="line" onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </Zone>
        </div>
      </div>

      {openEntry && (
        renderDetail
          ? renderDetail(openEntry, () => setOpenId(null))
          : <RoDetailModal
              entry={openEntry}
              library={library}
              rates={rates}
              // jobTimings is server-built; a deleted RO stays in it until the
              // refresh lands, so drop its timings here or "of N" runs one high.
              jobTimings={jobTimings?.filter((t) => !deletedIds.has(t.entryId))}
              onClose={() => setOpenId(null)}
              // A deleted RO can live in the paginated "Load more" state, which a
              // server refresh alone never prunes (that only refreshes the first
              // page's `entries` prop) — so it lingered on the list until a full
              // reload. Drop it from client state AND refresh the server page.
              onDeleted={(id) => {
                setDeletedIds((prev) => new Set(prev).add(id));
                setExtraEntries((prev) => prev.filter((e) => e.id !== id));
                setRangeEntries((prev) => prev.filter((e) => e.id !== id));
                setOpenId(null);
                router.refresh();
              }}
            />
      )}
    </main>
  );
}
