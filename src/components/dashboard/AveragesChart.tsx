"use client";

import { useState } from "react";
import type { Entry, UnpaidTime } from "@/lib/types";
import { fmtHours, type DayDenom } from "@/lib/stats";
import { getPeriodForDate, addDays } from "@/lib/periods";
import { flagHoursByDate } from "@/lib/forecast";
import { ReadoutEfficiency } from "@/components/ui/ReadoutEfficiency";
import { Icon } from "@/components/layout/icons";
import { withPt } from "@/components/ui/Figure";
import { Zone } from "@/components/ui/Zone";
import { FiguresInText } from "./Figures";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = "week" | "period" | "month";
type Mode = "total" | "avg";
type SubMode = "worked" | "all";

type BarData = {
  label: string;       // short axis label (M, May 3)
  longLabel: string;   // readout label (Mon, May 3)
  subLabel?: string;   // secondary axis label (Wk 1 / Wk 2 for period tab)
  date?: string;       // ISO date for day-level bars — enables the efficiency readout
  value: number;
  isBest: boolean;
  isCurrent: boolean;
};

type Props = {
  entries: Entry[];
  /** The ledger, so a day on an open ticket is a worked day for the averages
   * (Open Tickets, decision 7). Optional: the guest page has no ledger. */
  unpaid?: UnpaidTime[];
  /** Per-day efficiency denominators (clocked > scheduled) — day-bar hover
   * shows that day's efficiency when present. */
  denomByDay?: Record<string, DayDenom>;
  today: string;
  periodStart: string;
  periodEnd: string;
  weekStart: string;
  weekEnd: string;
  monthStart: string;
  monthEnd: string;
  weekStartDay: 0 | 1;
  splitDay: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetweenInclusive(start: string, end: string): number {
  const a = new Date(start + "T00:00:00");
  const b = new Date(end + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

// ---------------------------------------------------------------------------
// Compute bar data per tab
// ---------------------------------------------------------------------------

// Week tab — one bar per day of the *current* week (mirrors the History page).
//   • Total: hours actually flagged that exact day (future days = 0).
//   • Avg:   the average hours typically flagged on that weekday, computed over
//            the 90-day window on a worked-days basis (days with no ROs don't
//            drag the average down).
function computeWeek(
  entries: Entry[],
  unpaid: UnpaidTime[],
  weekStart: string,
  weekEnd: string,
  windowStart: string,
  windowEnd: string,
  today: string,
  mode: Mode,
): BarData[] {
  // ── Avg source: day-of-week averages across the 90d window ──────────────
  // Worked days come from forecast.ts's flagHoursByDate rather than a local
  // loop. The two used to define "worked" differently — here any entry counted,
  // there only flagHours > 0 did — which meant the chart and the projection
  // could disagree about the same week. One shared source, one definition.
  const totalByDow: number[] = new Array(7).fill(0);
  const workedByDow: number[] = new Array(7).fill(0);

  for (const [date, hours] of flagHoursByDate(entries, windowStart, windowEnd, unpaid)) {
    const jsDay = new Date(date + "T00:00:00").getDay();
    totalByDow[jsDay] += hours;
    workedByDow[jsDay]++;
  }
  const avgByDow = totalByDow.map((total, dow) =>
    workedByDow[dow] > 0 ? total / workedByDow[dow] : 0
  );

  // ── Total source: this week's per-day totals ────────────────────────────
  const totalByDate = new Map<string, number>();
  for (const entry of entries) {
    if (entry.date < weekStart || entry.date > weekEnd) continue;
    totalByDate.set(entry.date, (totalByDate.get(entry.date) ?? 0) + entry.flagHours);
  }

  const bars: BarData[] = [];
  let d = weekStart;
  while (d <= weekEnd) {
    const jsDay = new Date(d + "T00:00:00").getDay();
    const wd = DAY_SHORT[jsDay];
    const [, m, day] = d.split("-").map(Number);
    const value = mode === "total" ? (totalByDate.get(d) ?? 0) : avgByDow[jsDay];
    bars.push({
      label: wd,
      longLabel: `${wd}, ${MONTHS_SHORT[m - 1]} ${day}`,
      date: d,
      value,
      isBest: false,
      isCurrent: d === today,
    });
    d = addDays(d, 1);
  }

  const maxVal = Math.max(...bars.map((b) => b.value), 0);
  if (maxVal > 0) {
    for (const bar of bars) {
      if (bar.value === maxVal) { bar.isBest = true; break; }
    }
  }
  return bars;
}

function computePeriod(
  entries: Entry[],
  unpaid: UnpaidTime[],
  windowStart: string,
  windowEnd: string,
  splitDay: number,
  today: string,
  mode: Mode,
  subMode: SubMode,
): BarData[] {
  const periodTotals = new Map<string, { total: number; start: string; end: string }>();
  const periodWorkedDates = new Map<string, Set<string>>();

  // Through flagHoursByDate — the app-wide worked-day rule — so a day on an
  // open ticket counts as worked here exactly as it does in the forecast.
  for (const [date, hours] of flagHoursByDate(entries, windowStart, windowEnd, unpaid)) {
    const period = getPeriodForDate(date, splitDay, {});
    const existing = periodTotals.get(period.key);
    if (existing) {
      existing.total += hours;
    } else {
      periodTotals.set(period.key, { total: hours, start: period.start, end: period.end });
    }
    if (!periodWorkedDates.has(period.key)) periodWorkedDates.set(period.key, new Set());
    periodWorkedDates.get(period.key)!.add(date);
  }

  let cursor = windowStart;
  while (cursor <= windowEnd) {
    const period = getPeriodForDate(cursor, splitDay, {});
    if (!periodTotals.has(period.key)) {
      periodTotals.set(period.key, { total: 0, start: period.start, end: period.end });
    }
    cursor = addDays(period.end, 1);
    if (cursor <= windowStart) cursor = addDays(cursor, 1);
  }

  const currentPeriod = getPeriodForDate(today, splitDay, {});
  const sorted = Array.from(periodTotals.entries())
    .sort(([, a], [, b]) => a.start.localeCompare(b.start));

  const bars: BarData[] = sorted.map(([key, { total, start, end }]) => {
    const [, m, d] = start.split("-").map(Number);
    const dateLabel = `${MONTHS_SHORT[m - 1]} ${d}`;

    let value: number;
    if (mode === "total") {
      value = total;
    } else if (subMode === "worked") {
      const workedDays = periodWorkedDates.get(key)?.size ?? 0;
      value = workedDays > 0 ? total / workedDays : 0;
    } else {
      const effStart = start < windowStart ? windowStart : start;
      const effEnd = end > windowEnd ? windowEnd : end;
      const allDays = effEnd >= effStart ? daysBetweenInclusive(effStart, effEnd) : 0;
      value = allDays > 0 ? total / allDays : 0;
    }

    const startDay = parseInt(start.split("-")[2], 10);
    const subLabel = startDay <= splitDay ? "Wk 1" : "Wk 2";
    return { label: dateLabel, longLabel: dateLabel, subLabel, value, isBest: false, isCurrent: key === currentPeriod.key };
  });

  const maxVal = Math.max(...bars.map((b) => b.value), 0);
  if (maxVal > 0) {
    for (const bar of bars) {
      if (bar.value === maxVal) { bar.isBest = true; break; }
    }
  }
  return bars;
}

function computeMonth(
  entries: Entry[],
  unpaid: UnpaidTime[],
  windowStart: string,
  windowEnd: string,
  today: string,
  mode: Mode,
  subMode: SubMode,
): BarData[] {
  const monthTotals = new Map<string, number>();
  const workedDaysByMonth = new Map<string, Set<string>>();

  const [startYear, startMonth] = windowStart.split("-").map(Number);
  const [endYear, endMonth] = windowEnd.split("-").map(Number);

  let y = startYear, m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!monthTotals.has(key)) monthTotals.set(key, 0);
    m++;
    if (m > 12) { m = 1; y++; }
  }

  // Through flagHoursByDate — the app-wide worked-day rule — so a day on an
  // open ticket counts as worked here exactly as it does in the forecast.
  for (const [date, hours] of flagHoursByDate(entries, windowStart, windowEnd, unpaid)) {
    const key = date.substring(0, 7);
    monthTotals.set(key, (monthTotals.get(key) ?? 0) + hours);
    if (!workedDaysByMonth.has(key)) workedDaysByMonth.set(key, new Set());
    workedDaysByMonth.get(key)!.add(date);
  }

  const currentMonth = today.substring(0, 7);
  const sorted = Array.from(monthTotals.entries()).sort(([a], [b]) => a.localeCompare(b));

  const bars: BarData[] = sorted.map(([key, total]) => {
    const [y2, m2] = key.split("-").map(Number);
    let value: number;
    if (mode === "total") {
      value = total;
    } else {
      const divisor = subMode === "worked"
        ? (workedDaysByMonth.get(key)?.size ?? 0)
        : daysInMonth(y2, m2);
      value = divisor > 0 ? total / divisor : 0;
    }
    return {
      label: MONTHS_SHORT[m2 - 1],
      longLabel: MONTHS_SHORT[m2 - 1],
      value,
      isBest: false,
      isCurrent: key === currentMonth,
    };
  });

  const maxVal = Math.max(...bars.map((b) => b.value), 0);
  if (maxVal > 0) {
    for (const bar of bars) {
      if (bar.value === maxVal) { bar.isBest = true; break; }
    }
  }
  return bars;
}

// ---------------------------------------------------------------------------
// Insight text
// ---------------------------------------------------------------------------

function computeInsight(
  entries: Entry[],
  windowStart: string,
  windowEnd: string,
  activeTab: TabId,
  bars: BarData[],
  mode: Mode,
): string {
  if (entries.length === 0 || bars.every((b) => b.value === 0)) {
    return "Log more ROs to see insights here.";
  }

  // Week tab = one bar per weekday of the current week.
  if (activeTab === "week") {
    const dayName = (b: BarData) => b.longLabel.split(",")[0]; // "Mon, May 3" -> "Mon"

    if (mode === "avg") {
      const withValues = bars.filter((b) => b.value > 0);
      if (withValues.length < 2) {
        const best = bars.find((b) => b.isBest);
        if (best) return `You typically flag the most on ${dayName(best)}, around ${fmtHours(best.value)}h.`;
        return "Log more ROs to see insights here.";
      }
      const best = [...bars].sort((a, b) => b.value - a.value)[0];
      const worst = [...withValues].sort((a, b) => a.value - b.value)[0];
      if (worst.value > 0) {
        const pct = Math.round(((best.value - worst.value) / worst.value) * 100);
        if (pct >= 10) return `You typically flag ${pct}% more on ${dayName(best)} than ${dayName(worst)}.`;
      }
      return `You typically flag the most on ${dayName(best)}, around ${fmtHours(best.value)}h.`;
    }

    // Total mode — what's actually been flagged this week so far.
    const best = bars.find((b) => b.isBest);
    if (best) return `Best day this week: ${dayName(best)} with ${fmtHours(best.value)}h flagged.`;
    return "Log more ROs to see insights here.";
  }

  if (activeTab === "period" && bars.length >= 2) {
    const lastTwo = bars.slice(-2);
    const prev = lastTwo[0].value, curr = lastTwo[1].value;
    if (prev > 0 && curr > prev) return `Your flag hours are up ${Math.round(((curr - prev) / prev) * 100)}% from last period.`;
    if (prev > 0 && curr < prev) return `Your flag hours are down ${Math.round(((prev - curr) / prev) * 100)}% from last period.`;
  }

  if (activeTab === "month" && bars.length >= 2) {
    const lastTwo = bars.slice(-2);
    const prev = lastTwo[0].value, curr = lastTwo[1].value;
    if (prev > 0 && curr > prev) return `Your flag hours are up ${Math.round(((curr - prev) / prev) * 100)}% from last month.`;
    if (prev > 0 && curr < prev) return `Your flag hours are down ${Math.round(((prev - curr) / prev) * 100)}% from last month.`;
  }

  const best = bars.find((b) => b.isBest);
  if (best) {
    const unitNames: Record<TabId, string> = { week: "week", period: "period", month: "month" };
    return `Best ${unitNames[activeTab]}: ${best.longLabel} with ${fmtHours(best.value)}h.`;
  }

  return "Log more ROs to see insights here.";
}


// ---------------------------------------------------------------------------
// The chart (mock `.chart`): plain bars on a ruled plot, the current bar in the
// accent, gridlines labelled on the left. Bars are the data; the hit layer over
// them only moves the readout, so a tech can run a finger along the week.
// ---------------------------------------------------------------------------

/** Gridline spacing: the smallest round step that keeps the plot to ~5 lines. */
function niceStep(max: number): number {
  for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) {
    if (max / step <= 5) return step;
  }
  return 1000;
}

function HoursChart({
  bars,
  hover,
  setHover,
  tab,
  mode,
  ariaLabel,
}: {
  bars: BarData[];
  hover: number | null;
  setHover: (i: number | null) => void;
  tab: TabId;
  mode: Mode;
  ariaLabel: string;
}) {
  const n = bars.length;
  if (n === 0) return null;

  const max = Math.max(...bars.map((b) => b.value), 0);
  const step = niceStep(max);
  const top = Math.max(Math.ceil((max + 0.01) / step) * step, step);
  const grid: number[] = [];
  for (let g = step; g <= top; g += step) grid.push(g);

  // A value on every bar while there are few of them; otherwise only the best.
  const few = n <= 7;
  // Month tab still uses sparse x labels; the other tabs label every bar.
  const labelEvery = Math.max(1, Math.ceil(n / 5));
  const lastRegularIdx = Math.floor((n - 1) / labelEvery) * labelEvery;

  return (
    <div className="chart" role="img" aria-label={ariaLabel}>
      <div
        className="chart-plot"
        onMouseLeave={() => setHover(null)}
        onTouchEnd={() => setHover(null)}
      >
        {grid.map((g) => (
          <div key={g} className="chart-grid" style={{ bottom: `${(g / top) * 100}%` }}>
            <span>{g}</span>
          </div>
        ))}
        <div className={`chart-bars${mode === "avg" ? " dim" : ""}`}>
          {bars.map((bar, i) => {
            const showValue = (few || bar.isBest) && bar.value > 0;
            const cls = [
              bar.value === 0 ? "zero" : "",
              bar.isCurrent ? "now" : "",
              hover === i && !bar.isCurrent && bar.value > 0 ? "hot" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div key={i} className={cls || undefined} style={{ height: `${(bar.value / top) * 100}%` }}>
                {showValue && <span>{withPt(fmtHours(bar.value))}</span>}
              </div>
            );
          })}
        </div>
        <div className="chart-hit" aria-hidden="true">
          {bars.map((_, i) => (
            <span key={i} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
          ))}
        </div>
      </div>
      <div className="chart-x" aria-hidden="true">
        {bars.map((bar, i) => {
          let primary: string | null = null;
          let secondary: string | null = null;
          if (tab === "week") {
            primary = bar.label;
          } else if (tab === "period") {
            // Always show the period date and Wk 1 / Wk 2.
            primary = bar.label;
            secondary = bar.subLabel ?? null;
          } else {
            const show = i % labelEvery === 0 || (i === n - 1 && n - 1 - lastRegularIdx >= 2);
            if (show) primary = bar.label;
          }
          return (
            <span key={i} className={bar.isCurrent ? "now" : undefined}>
              {primary}
              {secondary && <small>{secondary}</small>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const TABS: { id: TabId; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "period", label: "Period" },
  { id: "month", label: "Month" },
];
const MODES: { id: Mode; label: string }[] = [
  { id: "total", label: "Total" },
  { id: "avg", label: "Avg" },
];

export function AveragesChart({
  entries,
  unpaid = [],
  denomByDay,
  today,
  weekStart,
  weekEnd,
  splitDay,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("week");
  const [mode, setMode] = useState<Mode>("total");
  const [hover, setHover] = useState<number | null>(null);

  // Averages are always computed on a worked-days basis so days off don't drag
  // the number down. The Worked/All toggle was removed.
  const subMode: SubMode = "worked";

  const windowStart = addDays(today, -89);
  const windowEnd = today;

  const bars: BarData[] = (() => {
    switch (activeTab) {
      case "week":   return computeWeek(entries, unpaid, weekStart, weekEnd, windowStart, windowEnd, today, mode);
      case "period": return computePeriod(entries, unpaid, windowStart, windowEnd, splitDay, today, mode, subMode);
      case "month":  return computeMonth(entries, unpaid, windowStart, windowEnd, today, mode, subMode);
    }
  })();

  const bestIdx  = bars.findIndex((b) => b.isBest);
  const currIdx  = bars.findIndex((b) => b.isCurrent);
  const activeIdx = hover ?? (currIdx >= 0 ? currIdx : bestIdx >= 0 ? bestIdx : 0);
  const activeBar = bars[activeIdx];

  const unitLabel = mode === "total" ? "total" : "avg / day";

  const total90d = entries
    .filter((e) => e.date >= windowStart && e.date <= windowEnd)
    .reduce((s, e) => s + e.flagHours, 0);

  const unitNames: Record<TabId, string> = { week: "week", period: "period", month: "month" };
  const bestBar = bars[bestIdx];

  const insightText = computeInsight(entries, windowStart, windowEnd, activeTab, bars, mode);

  const ariaLabel =
    `Flagged hours, ${unitNames[activeTab]}, ${mode === "total" ? "total" : "average per day"}. ` +
    bars.map((b) => `${b.longLabel} ${fmtHours(b.value)}`).join(", ") +
    ".";

  return (
    <Zone id="z-chart" name="Flagged Hours">
      <div className="chart-ctl">
        <div className="seg" role="group" aria-label="Chart range">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Chart measure">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* READOUT — the value always lives here, never over the bars */}
      <div className="chart-headline" aria-live="polite">
        <span className="when">{activeBar?.longLabel ?? "—"}</span>
        <b className="num">
          {activeBar ? withPt(fmtHours(activeBar.value)) : "—"}
          {activeBar && <span className="unit">h</span>}
        </b>
        <span className="what">{unitLabel}</span>
        {/* Day efficiency — total mode only (avg bars are synthetic) */}
        {mode === "total" && activeBar?.date && (
          <ReadoutEfficiency flagHours={activeBar.value} denom={denomByDay?.[activeBar.date]} />
        )}
      </div>

      {/* Keyed by tab+mode so the bars rise again on a user-initiated switch
          (new data by intent) but NOT when an unrelated parent re-render (a
          dashboard quick-add refresh) just updates bar heights. */}
      <HoursChart
        key={`${activeTab}-${mode}`}
        bars={bars}
        hover={hover}
        setHover={setHover}
        tab={activeTab}
        mode={mode}
        ariaLabel={ariaLabel}
      />

      <div className="chart-foot">
        <span>
          <b className="num">{withPt(fmtHours(total90d))}h</b> last 90d
        </span>
        <span>
          <b>{bestBar?.longLabel ?? "—"}</b> best {unitNames[activeTab]}
        </span>
      </div>
      <p className="insight">
        <Icon name="insights" small />
        <span>
          <b>Insight.</b> <FiguresInText text={insightText} />
        </span>
      </p>
    </Zone>
  );
}
