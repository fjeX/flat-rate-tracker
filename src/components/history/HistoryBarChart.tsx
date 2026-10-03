"use client";

// The History page's Flagged hours zone: the same chart as the dashboard's
// (HoursChart, the mock `.chart`), windowed by the page's range filter. The
// bar builders below are unchanged from the SVG version this replaced.
import { useId, useState } from "react";
import type { Entry } from "@/lib/types";
import { addDays, endOfMonth, getPeriodForDate } from "@/lib/periods";
import { fmtHours, type DayDenom } from "@/lib/stats";
import { ReadoutEfficiency } from "@/components/ui/ReadoutEfficiency";
import { withPt } from "@/components/ui/Figure";
import { Zone } from "@/components/ui/Zone";
import { Table, Th, Td } from "@/components/ui/Table";
import { HoursChart, type ChartBar, type TabId } from "@/components/dashboard/AveragesChart";
import "./history-chart-table.css";

type FilterKind = "today" | "week" | "period" | "month" | "all" | "custom";

/** A custom range up to this many days is drawn a bar per day; longer, a bar
 * per month. */
const CUSTOM_DAY_BARS_MAX = 31;

/** The dates one bar covers. Tapping a bar hands this to the page, which
 * narrows the RO list to it. */
export type BarRange = { start: string; end: string; label: string };

type Props = {
  entries: Entry[];        // all loaded entries — the chart windows them per filter
  filter: FilterKind;
  today: string;
  weekStart: string;
  weekEnd: string;
  splitDay: number;
  /** The custom range's dates; required when `filter` is "custom". */
  customRange?: { start: string; end: string } | null;
  /** Per-day efficiency denominators (clocked > scheduled) — day-bar hover
   * shows that day's efficiency when present. Absent in guest mode. */
  denomByDay?: Record<string, DayDenom>;
  /** The picked bar's range, or null. */
  selected: BarRange | null;
  /** Tapping a bar picks it; tapping the picked bar again clears it (null).
   * Without it the table twin shows plain labels. */
  onSelect?: (range: BarRange | null) => void;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Dashboard's "Flagged Hours" chart windows everything to the last 90 days.
const WINDOW_DAYS = 90;

// Format "Apr 1" from a YYYY-MM-DD string.
function fmtShort(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}`;
}

// Format "Mon, Apr 1" from a YYYY-MM-DD string (week readout label).
function fmtLongDay(d: string): string {
  const wd = new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
  return `${wd}, ${fmtShort(d)}`;
}

// Format "April 2026" from a YYYY-MM string (month readout label).
function fmtMonthLong(ym: string): string {
  const [, m] = ym.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${ym.slice(0, 4)}`;
}

type BarData = {
  label: string;       // primary axis label (15, Mon, Apr 1, Apr)
  subLabel?: string;   // secondary axis row (Wk 1 / Wk 2 for periods)
  longLabel: string;   // readout label (2 PM / Mon, Apr 3 / Apr 1 – 15 / April 2026)
  date?: string;       // ISO date for day-level bars — enables the efficiency readout
  start: string;       // first and last day the bar covers (the list filter)
  end: string;
  hours: number;
  ros: number;         // ROs (entries) behind the bar, the table twin's count column
  isCurrent: boolean;  // today / current period / current month bar
};

// ── today: a single bar with the day's total flagged hours ───────────────
function buildTodayBars(entries: Entry[], today: string): BarData[] {
  const todays = entries.filter((e) => e.date === today);
  const total = todays.reduce((s, e) => s + e.flagHours, 0);
  return [{ label: "Today", longLabel: "Today", date: today, start: today, end: today, hours: total, ros: todays.length, isCurrent: true }];
}

// ── week / short custom range: one bar per day ───────────────────────────
// A week labels its bars by weekday; a custom range by date, since a weekday
// alone is ambiguous once the range is not this week.
function buildDayBars(
  entries: Entry[],
  today: string,
  weekStart: string,
  weekEnd: string,
  axis: "weekday" | "date" = "weekday",
): BarData[] {
  const byDate = new Map<string, number>();
  const rosByDate = new Map<string, number>();
  for (const e of entries) {
    if (e.date < weekStart || e.date > weekEnd) continue;
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.flagHours);
    rosByDate.set(e.date, (rosByDate.get(e.date) ?? 0) + 1);
  }
  const bars: BarData[] = [];
  let d = weekStart;
  while (d <= weekEnd) {
    const wd = new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
    bars.push({
      label: axis === "weekday" ? wd : fmtShort(d),
      longLabel: fmtLongDay(d),
      date: d,
      start: d,
      end: d,
      hours: byDate.get(d) ?? 0,
      ros: rosByDate.get(d) ?? 0,
      isCurrent: d === today,
    });
    d = addDays(d, 1);
  }
  return bars;
}

// ── period: one bar per pay period over the window ───────────────────────
function buildPeriodBars(
  entries: Entry[],
  windowStart: string,
  windowEnd: string,
  splitDay: number,
  today: string,
): BarData[] {
  const totals = new Map<string, { total: number; ros: number; start: string; end: string }>();

  for (const e of entries) {
    if (e.date < windowStart || e.date > windowEnd) continue;
    const p = getPeriodForDate(e.date, splitDay);
    const ex = totals.get(p.key);
    if (ex) { ex.total += e.flagHours; ex.ros += 1; }
    else totals.set(p.key, { total: e.flagHours, ros: 1, start: p.start, end: p.end });
  }

  // Fill empty periods so the axis is continuous
  let cursor = windowStart;
  while (cursor <= windowEnd) {
    const p = getPeriodForDate(cursor, splitDay);
    if (!totals.has(p.key)) totals.set(p.key, { total: 0, ros: 0, start: p.start, end: p.end });
    cursor = addDays(p.end, 1);
    if (cursor <= windowStart) cursor = addDays(cursor, 1);
  }

  const currentKey = getPeriodForDate(today, splitDay).key;
  return Array.from(totals.entries())
    .sort(([, a], [, b]) => a.start.localeCompare(b.start))
    .map(([key, { total, ros, start, end }]) => ({
      label: fmtShort(start),
      subLabel: key.endsWith("P1") ? "Wk 1" : "Wk 2",
      longLabel: `${fmtShort(start)} – ${fmtShort(end)}`,
      start,
      end,
      hours: total,
      ros,
      isCurrent: key === currentKey,
    }));
}

// ── month / all / long custom range: one bar per month ───────────────────
// `clamp` trims each bar's dates to the window, so tapping the first or last
// month of a custom range never reaches outside it.
function buildMonthBars(
  entries: Entry[],
  windowStart: string | null,
  windowEnd: string,
  today: string,
  clamp = false,
): BarData[] {
  const totals = new Map<string, number>();
  const rosByMonth = new Map<string, number>();
  for (const e of entries) {
    if (windowStart && (e.date < windowStart || e.date > windowEnd)) continue;
    const key = e.date.slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + e.flagHours);
    rosByMonth.set(key, (rosByMonth.get(key) ?? 0) + 1);
  }

  // Windowed (month filter): fill empty months so the axis is continuous.
  if (windowStart) {
    const [sy, sm] = windowStart.split("-").map(Number);
    const [ey, em] = windowEnd.split("-").map(Number);
    let y = sy, m = sm;
    while (y < ey || (y === ey && m <= em)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      if (!totals.has(key)) totals.set(key, 0);
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }

  const currentMonth = today.slice(0, 7);
  return Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, total]) => {
      const m = Number(key.split("-")[1]);
      let start = `${key}-01`;
      let end = endOfMonth(start);
      if (clamp && windowStart) {
        if (start < windowStart) start = windowStart;
        if (end > windowEnd) end = windowEnd;
      }
      return {
        label: MONTHS[m - 1],
        longLabel: fmtMonthLong(key),
        start,
        end,
        hours: total,
        ros: rosByMonth.get(key) ?? 0,
        isCurrent: key === currentMonth,
      };
    });
}

function totalCaption(filter: FilterKind): string {
  switch (filter) {
    case "today":  return "today";
    case "week":   return "this week";
    case "period": return "last 90d";
    case "month":  return "last 90d";
    case "all":    return "all time";
    case "custom": return "in range";
  }
}

/** Days from start to end, both inclusive. */
function spanDays(start: string, end: string): number {
  const ms = new Date(end + "T12:00:00").getTime() - new Date(start + "T12:00:00").getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function customByDay(range: { start: string; end: string } | null | undefined): boolean {
  return !!range && spanDays(range.start, range.end) <= CUSTOM_DAY_BARS_MAX;
}

function unitName(filter: FilterKind, byDay: boolean): string {
  switch (filter) {
    case "today":  return "day";
    case "week":   return "day";
    case "period": return "period";
    case "month":  return "month";
    case "all":    return "month";
    case "custom": return byDay ? "day" : "month";
  }
}

// Which x-axis treatment the shared chart gives this range.
function chartTab(filter: FilterKind): TabId {
  switch (filter) {
    case "today":
    case "week":   return "week";
    case "period": return "period";
    case "month":
    case "all":
    case "custom": return "month";
  }
}

export function HistoryBarChart({
  entries,
  filter,
  today,
  weekStart,
  weekEnd,
  splitDay,
  customRange,
  denomByDay,
  selected,
  onSelect,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const tableId = useId();

  const windowStart = addDays(today, -(WINDOW_DAYS - 1));

  const bars: BarData[] = (() => {
    switch (filter) {
      case "today":  return buildTodayBars(entries, today);
      case "week":   return buildDayBars(entries, today, weekStart, weekEnd);
      case "period": return buildPeriodBars(entries, windowStart, today, splitDay, today);
      case "month":  return buildMonthBars(entries, windowStart, today, today);
      case "all":    return buildMonthBars(entries, null, today, today);
      case "custom":
        if (!customRange) return [];
        return customByDay(customRange)
          ? buildDayBars(entries, today, customRange.start, customRange.end, "date")
          : buildMonthBars(entries, customRange.start, customRange.end, today, true);
    }
  })();

  const n = bars.length;
  const totalHours = bars.reduce((s, b) => s + b.hours, 0);

  // Best bar = highest hours (only if anything's logged)
  let bestIdx = -1;
  let bestVal = 0;
  bars.forEach((b, i) => {
    if (b.hours > bestVal) { bestVal = b.hours; bestIdx = i; }
  });

  const selIdx = selected
    ? bars.findIndex((b) => b.start === selected.start && b.end === selected.end)
    : -1;

  // Readout follows the hovered bar, else the picked one, else the current
  // bar, else the best one
  const currIdx = bars.findIndex((b) => b.isCurrent);
  const activeIdx =
    hover ?? (selIdx >= 0 ? selIdx : currIdx >= 0 ? currIdx : bestIdx >= 0 ? bestIdx : 0);
  const activeBar = bars[activeIdx];

  const chartBars: ChartBar[] = bars.map((b, i) => ({
    label: b.label,
    longLabel: b.longLabel,
    subLabel: b.subLabel,
    date: b.date,
    value: b.hours,
    isBest: i === bestIdx,
    isCurrent: b.isCurrent,
  }));

  const pick = (i: number) => {
    const b = bars[i];
    onSelect?.(i === selIdx ? null : { start: b.start, end: b.end, label: b.longLabel });
  };

  const ariaLabel =
    `Flagged hours, ${totalCaption(filter)}. ` +
    bars.map((b) => `${b.longLabel} ${fmtHours(b.hours)}`).join(", ") +
    ".";

  return (
    <Zone id="z-hist-chart" name="Flagged hours">
      {n === 0 ? (
        <p className="hist-chart-empty">Nothing flagged in this range.</p>
      ) : (
        <>
          {/* READOUT — the value always lives here, never over the bars */}
          <div className="chart-headline" aria-live="polite">
            <span className="when">{activeBar?.longLabel ?? "—"}</span>
            <b className="num">
              {activeBar ? withPt(fmtHours(activeBar.hours)) : "—"}
              {activeBar && <span className="unit">h</span>}
            </b>
            <span className="what">flagged</span>
            {activeBar?.date && (
              <ReadoutEfficiency
                flagHours={activeBar.hours}
                denom={denomByDay?.[activeBar.date]}
              />
            )}
          </div>

          {/* Keyed by filter so bar-rise replays on a user-initiated range
              switch (new data by intent) but not on an unrelated parent
              re-render with the same filter. */}
          <HoursChart
            key={filter}
            bars={chartBars}
            hover={hover}
            setHover={setHover}
            tab={chartTab(filter)}
            mode="total"
            ariaLabel={ariaLabel}
            selected={selIdx >= 0 ? selIdx : null}
            onSelect={pick}
          />

          {/* TABLE TWIN: the same bars, same order, as a ruled table. On
              demand and visible (the chart's own aria-label stays). */}
          <button
            type="button"
            className="btn btn-quiet btn-sm hist-twin-toggle"
            aria-expanded={tableOpen}
            aria-controls={tableId}
            onClick={() => setTableOpen((o) => !o)}
          >
            {tableOpen ? "Hide table" : "Show as table"}
          </button>
          <div id={tableId} hidden={!tableOpen}>
            {tableOpen && (
              <Table className="hist-twin">
                <caption className="hist-twin-cap">
                  Flagged hours, {totalCaption(filter)}, one row per {unitName(filter, customByDay(customRange))}
                </caption>
                <thead>
                  <tr>
                    <Th scope="col">{unitName(filter, customByDay(customRange))}</Th>
                    <Th scope="col" num>Hours</Th>
                    <Th scope="col" num>ROs</Th>
                  </tr>
                </thead>
                <tbody>
                  {bars.map((b, i) => (
                    <tr key={`${b.start}-${b.end}`} aria-current={i === selIdx ? "true" : undefined}>
                      <th scope="row" className={b.isCurrent ? "now" : undefined}>
                        {onSelect ? (
                          <button
                            type="button"
                            className="hist-twin-pick"
                            aria-pressed={i === selIdx}
                            onClick={() => pick(i)}
                          >
                            {b.longLabel}
                          </button>
                        ) : (
                          b.longLabel
                        )}
                        {i === selIdx && <span className="hist-twin-tag"> · picked</span>}
                        {b.isCurrent && <span className="hist-twin-tag"> · now</span>}
                      </th>
                      <Td num>{withPt(fmtHours(b.hours))}</Td>
                      <Td num>{b.ros}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="table-foot">
                    <th scope="row">Total</th>
                    <Td num>{withPt(fmtHours(totalHours))}</Td>
                    <Td num>{bars.reduce((s, b) => s + b.ros, 0)}</Td>
                  </tr>
                </tfoot>
              </Table>
            )}
          </div>

          <div className="chart-foot">
            <span>
              <b className="num">{withPt(fmtHours(totalHours))}h</b> {totalCaption(filter)}
            </span>
            <span>
              <b>{bestIdx >= 0 ? bars[bestIdx].longLabel : "—"}</b> best {unitName(filter, customByDay(customRange))}
            </span>
          </div>
        </>
      )}
    </Zone>
  );
}
