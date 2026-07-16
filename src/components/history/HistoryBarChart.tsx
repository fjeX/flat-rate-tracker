"use client";

import { useState } from "react";
import type { Entry } from "@/lib/types";
import { addDays, getPeriodForDate } from "@/lib/periods";
import { fmtHours, type DayDenom } from "@/lib/stats";
import { ReadoutEfficiency } from "@/components/ui/ReadoutEfficiency";

type FilterKind = "today" | "week" | "period" | "month" | "all";

type Props = {
  entries: Entry[];        // all loaded entries — the chart windows them per filter
  filter: FilterKind;
  today: string;
  weekStart: string;
  weekEnd: string;
  splitDay: number;
  /** Per-day efficiency denominators (clocked > scheduled) — day-bar hover
   * shows that day's efficiency when present. Absent in guest mode. */
  denomByDay?: Record<string, DayDenom>;
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
  hours: number;
  isCurrent: boolean;  // today / current period / current month bar
};

// ── today: a single bar with the day's total flagged hours ───────────────
function buildTodayBars(entries: Entry[], today: string): BarData[] {
  const total = entries
    .filter((e) => e.date === today)
    .reduce((s, e) => s + e.flagHours, 0);
  return [{ label: "Today", longLabel: "Today", date: today, hours: total, isCurrent: true }];
}

// ── week: one bar per day of the current week ────────────────────────────
function buildWeekBars(
  entries: Entry[],
  today: string,
  weekStart: string,
  weekEnd: string,
): BarData[] {
  const byDate = new Map<string, number>();
  for (const e of entries) {
    if (e.date < weekStart || e.date > weekEnd) continue;
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.flagHours);
  }
  const bars: BarData[] = [];
  let d = weekStart;
  while (d <= weekEnd) {
    const wd = new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
    bars.push({
      label: wd,
      longLabel: fmtLongDay(d),
      date: d,
      hours: byDate.get(d) ?? 0,
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
  const totals = new Map<string, { total: number; start: string; end: string }>();

  for (const e of entries) {
    if (e.date < windowStart || e.date > windowEnd) continue;
    const p = getPeriodForDate(e.date, splitDay);
    const ex = totals.get(p.key);
    if (ex) ex.total += e.flagHours;
    else totals.set(p.key, { total: e.flagHours, start: p.start, end: p.end });
  }

  // Fill empty periods so the axis is continuous
  let cursor = windowStart;
  while (cursor <= windowEnd) {
    const p = getPeriodForDate(cursor, splitDay);
    if (!totals.has(p.key)) totals.set(p.key, { total: 0, start: p.start, end: p.end });
    cursor = addDays(p.end, 1);
    if (cursor <= windowStart) cursor = addDays(cursor, 1);
  }

  const currentKey = getPeriodForDate(today, splitDay).key;
  return Array.from(totals.entries())
    .sort(([, a], [, b]) => a.start.localeCompare(b.start))
    .map(([key, { total, start, end }]) => ({
      label: fmtShort(start),
      subLabel: key.endsWith("P1") ? "Wk 1" : "Wk 2",
      longLabel: `${fmtShort(start)} – ${fmtShort(end)}`,
      hours: total,
      isCurrent: key === currentKey,
    }));
}

// ── month / all: one bar per month, value = hours flagged that month ──────
function buildMonthBars(
  entries: Entry[],
  windowStart: string | null,
  windowEnd: string,
  today: string,
): BarData[] {
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (windowStart && (e.date < windowStart || e.date > windowEnd)) continue;
    const key = e.date.slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + e.flagHours);
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
      return {
        label: MONTHS[m - 1],
        longLabel: fmtMonthLong(key),
        hours: total,
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
  }
}

function unitName(filter: FilterKind): string {
  switch (filter) {
    case "today":  return "day";
    case "week":   return "day";
    case "period": return "period";
    case "month":  return "month";
    case "all":    return "month";
  }
}

// ── SVG layout (mirrors the dashboard "Flagged Hours" chart) ─────────────
const CHART_W = 358;
const CHART_H = 130;
const PAD_L = 4, PAD_R = 4, PAD_T = 6;
const INNER_W = CHART_W - PAD_L - PAD_R;

export function HistoryBarChart({
  entries,
  filter,
  today,
  weekStart,
  weekEnd,
  splitDay,
  denomByDay,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const windowStart = addDays(today, -(WINDOW_DAYS - 1));

  const bars: BarData[] = (() => {
    switch (filter) {
      case "today":  return buildTodayBars(entries, today);
      case "week":   return buildWeekBars(entries, today, weekStart, weekEnd);
      case "period": return buildPeriodBars(entries, windowStart, today, splitDay, today);
      case "month":  return buildMonthBars(entries, windowStart, today, today);
      case "all":    return buildMonthBars(entries, null, today, today);
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

  // Readout follows the hovered bar, else the current bar, else the best one
  const currIdx = bars.findIndex((b) => b.isCurrent);
  const activeIdx = hover ?? (currIdx >= 0 ? currIdx : bestIdx >= 0 ? bestIdx : 0);
  const activeBar = bars[activeIdx];

  // Period needs a second label row (Wk 1 / Wk 2)
  const PAD_B = filter === "period" ? 40 : 26;
  const INNER_H = CHART_H - PAD_T - PAD_B;
  const BASELINE = CHART_H - PAD_B;

  if (n === 0) {
    return (
      <section>
        <h2 className="section-title">Flagged Hours</h2>
        <div className="card padded">
          <div className="r-readout">
            <div className="r-readout-main">
              <span className="r-readout-label">—</span>
              <span className="r-readout-value">0h</span>
              <span className="r-readout-unit">flag hrs</span>
            </div>
          </div>
          <div
            style={{
              height: INNER_H, display: "flex", alignItems: "center",
              justifyContent: "center", color: "var(--fg-3)", fontSize: 12,
            }}
          >
            Nothing flagged in this range
          </div>
        </div>
      </section>
    );
  }

  const maxVal = Math.max(...bars.map((b) => b.hours), 0.01);
  const slot = INNER_W / n;
  const barW = Math.max(6, Math.min(slot * 0.70, 42));

  // Show every label when sparse, thin them out when dense; always keep the
  // current bar and the last bar labelled.
  const labelEvery = n <= 10 ? 1 : Math.max(1, Math.ceil(n / 8));

  return (
    <section>
      <div className="section-title">Flagged Hours</div>
      <div className="card padded">
        {/* READOUT — value lives here, never over the bars */}
        <div className="r-readout">
          <div className="r-readout-main">
            <span className="r-readout-label">{activeBar?.longLabel ?? "—"}</span>
            <span className="r-readout-value">
              {activeBar ? `${fmtHours(activeBar.hours)}h` : "—"}
            </span>
            <span className="r-readout-unit">flag hrs</span>
            {activeBar?.date && (
              <ReadoutEfficiency
                flagHours={activeBar.hours}
                denom={denomByDay?.[activeBar.date]}
              />
            )}
          </div>
        </div>

        {/* CHART — keyed by filter so bar-rise replays on a user-initiated
            filter switch (new data by intent) but not on an unrelated parent
            re-render with the same filter. */}
        <div className="r-chart-wrap" key={filter}>
          <svg
            className="r-chart"
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            overflow="visible"
            aria-label={`${totalCaption(filter)} flagged hours bar chart`}
            onMouseLeave={() => setHover(null)}
            onTouchEnd={() => setHover(null)}
          >
            {/* Baseline */}
            <line
              x1={PAD_L} x2={CHART_W - PAD_R}
              y1={BASELINE + 0.5} y2={BASELINE + 0.5}
              stroke="var(--line)" strokeWidth="1"
            />

            {bars.map((bar, i) => {
              const cx = PAD_L + slot * (i + 0.5);
              const h = Math.max(3, (bar.hours / maxVal) * INNER_H);
              const x = cx - barW / 2;
              const y = BASELINE - h;
              const isHover = hover === i;
              const highlight = isHover || bar.isCurrent;
              const showLabel = i % labelEvery === 0 || bar.isCurrent || i === n - 1;
              const labelColor = bar.isCurrent ? "var(--brand)" : "var(--fg-3)";

              return (
                <g key={i}>
                  {/* Touch / hover hit zone */}
                  <rect
                    x={PAD_L + slot * i} y={0} width={slot} height={BASELINE}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onTouchStart={() => setHover(i)}
                  />
                  {/* Bar — pointer-events off so it never occludes the
                      full-height hit zone behind it (hover must register). */}
                  <rect
                    x={x} y={y} width={barW} height={h}
                    rx={bar.hours > 0 ? Math.min(barW / 2, 6) : 0}
                    fill={highlight ? "var(--brand)" : "var(--bg-4)"}
                    pointerEvents="none"
                  />
                  {/* Primary axis label */}
                  {showLabel && (
                    <text
                      x={cx} y={BASELINE + 14}
                      textAnchor="middle"
                      fontSize={10.5}
                      fontFamily="ui-monospace, Menlo, monospace"
                      fill={labelColor}
                      fontWeight={bar.isCurrent ? 600 : 400}
                    >
                      {bar.label}
                    </text>
                  )}
                  {/* Secondary axis label (Wk 1 / Wk 2) */}
                  {showLabel && bar.subLabel && (
                    <text
                      x={cx} y={BASELINE + 27}
                      textAnchor="middle"
                      fontSize={9}
                      fontFamily="ui-monospace, Menlo, monospace"
                      fill={labelColor}
                      opacity={bar.isCurrent ? 1 : 0.7}
                      fontWeight={bar.isCurrent ? 600 : 400}
                    >
                      {bar.subLabel}
                    </text>
                  )}
                  {/* Hover indicator dot */}
                  {isHover && bar.hours > 0 && (
                    <circle cx={cx} cy={y - 7} r={2.2} fill="var(--brand)" pointerEvents="none" />
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* FOOTER */}
        <div className="r-footer">
          <span className="r-footer-stat">
            <span className="r-footer-num">{fmtHours(totalHours)}h</span>
            <span className="r-footer-cap">{totalCaption(filter)}</span>
          </span>
          <span className="r-footer-dot" />
          <span className="r-footer-stat">
            <span className="r-footer-num">
              {bestIdx >= 0 ? bars[bestIdx].longLabel : "—"}
            </span>
            <span className="r-footer-cap">best {unitName(filter)}</span>
          </span>
        </div>
      </div>
    </section>
  );
}
