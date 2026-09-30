"use client";

// History, in the final design language (phase 5 sketch; no mock screen
// existed for this page). Same features as before, re-arranged: one range
// control, a sort control and a search well up top; the Flagged hours chart
// in its zone; then the ROs as tags (the same object the dashboard and Pay
// Period draw), grouped under a day heading while the list is in date order.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadMoreEntries } from "@/app/actions/entries";
import { Camera, Search, X } from "lucide-react";
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
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import { RoTag } from "@/components/dashboard/RoTag";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DurationBar } from "@/components/ui/DurationBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { withPt } from "@/components/ui/Figure";
import { Zone } from "@/components/ui/Zone";
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
}) {
  // `entries` comes from the live store. In guest mode it hydrates from
  // sessionStorage in an effect AFTER first render, so freezing it into state
  // here would strand the page on the empty initial value. Keep `entries` live
  // and track paginated ("load more") rows separately.
  const router = useRouter();
  const [extraEntries, setExtraEntries] = useState<Entry[]>([]);
  const [hasMore, setHasMore] = useState(hasMoreProp);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("period");
  const [sortBy, setSortBy] = useState<SortKind>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Optimistically removed on delete. The 2026-07-23 fix pruned `extraEntries`
  // and called router.refresh(), which covers a row from "Load more" but NOT a
  // row on the first page — that one lives in the `entries` prop, and a refresh
  // is exactly the call that does not reliably repaint (bug c655c010, the same
  // reason RefreshFlusher exists). A freshly logged RO is the newest row, so it
  // is always on the first page: the common case was the uncovered one.
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(() => new Set());

  const libraryById = useMemo(() => new Map(library.map((oc) => [oc.id, oc])), [library]);

  const allEntries = useMemo(
    () => [...entries, ...extraEntries].filter((e) => !deletedIds.has(e.id)),
    [entries, extraEntries, deletedIds],
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

  const shownHours = filtered.reduce((s, e) => s + e.flagHours, 0);

  // Groups only make sense in date order. Day groups for the short ranges;
  // month groups once the range spans months. Any other sort is one flat
  // list, and each tag carries its full date instead.
  const grouped = sortBy === "date";
  const byMonth = filter === "month" || filter === "all";
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
        <div className="seg" role="group" aria-label="Range">
          {CHIPS.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              aria-pressed={filter === chip.kind}
              onClick={() => setFilter(chip.kind)}
            >
              {chip.label}
            </button>
          ))}
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
          <label className="hist-search">
            <span className="sr-only">Search RO#, vehicle, or notes</span>
            <Search aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search RO#, vehicle, or notes"
            />
            {search && (
              <button
                type="button"
                className="hist-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <X size={18} />
              </button>
            )}
          </label>
        </div>
      </div>

      <div className="hist-grid">
        <div className="hist-chart-col">
          <HistoryBarChart
            entries={allEntries}
            filter={filter}
            today={today}
            weekStart={weekStartProp}
            weekEnd={weekEndProp}
            splitDay={settings.splitDay}
            denomByDay={denomByDay}
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
            {filtered.length === 0 ? (
              <div className="hist-empty">
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

            {hasMore && (
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
              onClose={() => setOpenId(null)}
              // A deleted RO can live in the paginated "Load more" state, which a
              // server refresh alone never prunes (that only refreshes the first
              // page's `entries` prop) — so it lingered on the list until a full
              // reload. Drop it from client state AND refresh the server page.
              onDeleted={(id) => {
                setDeletedIds((prev) => new Set(prev).add(id));
                setExtraEntries((prev) => prev.filter((e) => e.id !== id));
                setOpenId(null);
                router.refresh();
              }}
            />
      )}
    </main>
  );
}
