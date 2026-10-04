"use client";

// The History page's Flagged hours zone: the same chart as the dashboard's
// (HoursChart, the mock `.chart`), windowed by the page's range filter. The
// bar builders below are unchanged from the SVG version this replaced.
import { useId, useState } from "react";
import type { Entry } from "@/lib/types";
import { addDays, endOfMonth, getPeriodForDate } from "@/lib/periods";
import { fmtHours, fmtPct, spanEfficiency, type DayDenom } from "@/lib/stats";
import { barRankSentence } from "@/lib/rankings";
import { spanEfficiencyDisplay } from "@/lib/efficiency-display";
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

/** What a bar needs from an RO: its day and its flag hours. Signed in, the page
 * sends one per RO on the account (not just the loaded page of the list), so
 * older bars are never short; a guest's entries are all local already. */
export type ChartRow = Pick<Entry, "date" | "flagHours">;

type Props = {
  entries: ChartRow[];     // every RO the chart may draw — it windows them per filter
  filter: FilterKind;
  today: string;
  weekStart: string;
  weekEnd: string;
  splitDay: number;
  /** The custom range's dates; required when `filter` is "custom". */
  customRange?: { start: string; end: string } | null;
  /** Per-day efficiency denominators (clocked > scheduled) over the chart's
   * whole span. Every bar's efficiency is its counted days' flag over these
   * (spanEfficiency). Absent in guest mode. */
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
function buildTodayBars(entries: ChartRow[], today: string): BarData[] {
  const todays = entries.filter((e) => e.date === today);
  const total = todays.reduce((s, e) => s + e.flagHours, 0);
  return [{ label: "Today", longLabel: "Today", date: today, start: today, end: today, hours: total, ros: todays.length, isCurrent: true }];
}

// ── week / short custom range: one bar per day ───────────────────────────
// A week labels its bars by weekday; a custom range by date, since a weekday
// alone is ambiguous once the range is not this week.
function buildDayBars(
  entries: ChartRow[],
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
  entries: ChartRow[],
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
  entries: ChartRow[],
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

/** The table twin's efficiency cell: the same figure as the readout, "—" when
 * no day in the row counted, or when the figure is withheld (the same gate
 * /pay-period uses, via efficiencyDisplay). */
function effCell(eff: ReturnType<typeof spanEfficiency>): string {
  const d = spanEfficiencyDisplay(eff);
  return d.kind === "shown" ? fmtPct(d.pct) : "—";
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

  // Efficiency for any bar, not only a day: its counted days' flag over their
  // denominators — the Pay Period figure's rule, per bar.
  const effOf = (start: string, end: string) =>
    denomByDay ? spanEfficiency(entries, denomByDay, start, end) : null;
  const activeEff = activeBar ? effOf(activeBar.start, activeBar.end) : null;

  // "4th highest efficiency of 31 weeks". Efficiency comes ONLY from effOf (spanEfficiency), the
  // readout's own call, so the rank and the figure beside it cannot disagree.
  // Pool = bars of this tab that PRINT an efficiency (null, no flag on the
  // counted days, or withheld by efficiencyDisplay = the readout shows no
  // percentage, so it is not ranked and N counts only bars with a figure). The in-progress
  // bar (isCurrent: today / this period / this month) is neither ranked nor in
  // the pool — it is still being earned, and ranking half a period against whole
  // ones would make a good morning look like a bad month. `bars` is built from
  // every RO on the account (chartRows), not the paged list.
  // Ranked on the percent as SHOWN (ReadoutEfficiency's rounding): two bars
  // that both read "96%" are tied, not 3rd and 4th.
  const shownPct = (flag: number, denom: number) => Math.round((flag / denom) * 100);
  const rankSentence = (() => {
    if (!activeBar || activeBar.isCurrent || !activeEff) return null;
    if (spanEfficiencyDisplay(activeEff).kind !== "shown") return null;
    const pool: number[] = [];
    for (const b of bars) {
      if (b.isCurrent) continue;
      const e = effOf(b.start, b.end);
      if (e && spanEfficiencyDisplay(e).kind === "shown") pool.push(shownPct(e.flagHours, e.denom.hours));
    }
    const unit = unitName(filter, customByDay(customRange));
    return barRankSentence(
      shownPct(activeEff.flagHours, activeEff.denom.hours),
      pool,
      unit === "period" ? "pay period" : unit,
      filter === "week" || filter === "today" ? undefined : totalCaption(filter),
    );
  })();

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
            {activeEff && (
              <ReadoutEfficiency
                flagHours={activeEff.flagHours}
                denom={activeEff.denom}
                unpairedFlagHours={activeEff.unpairedFlagHours}
                unpairedDays={activeEff.unpairedDays}
              />
            )}
          </div>
          {rankSentence && <p className="chart-spread">{rankSentence}</p>}

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
                    {denomByDay && <Th scope="col" num>Efficiency</Th>}
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
                      {denomByDay && <Td num>{effCell(effOf(b.start, b.end))}</Td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="table-foot">
                    <th scope="row">Total</th>
                    <Td num>{withPt(fmtHours(totalHours))}</Td>
                    <Td num>{bars.reduce((s, b) => s + b.ros, 0)}</Td>
                    {denomByDay && (
                      <Td num>{effCell(n > 0 ? effOf(bars[0].start, bars[n - 1].end) : null)}</Td>
                    )}
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
