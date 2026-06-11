"use client";

import { useEffect, useState } from "react";
import type { Entry } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { getPeriodForDate, addDays } from "@/lib/periods";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = "day" | "week" | "period" | "month";
type Mode = "total" | "avg";
type SubMode = "worked" | "all";

type BarData = {
  label: string;       // short axis label (M, May 3)
  longLabel: string;   // readout label (Mon, May 3)
  subLabel?: string;   // secondary axis label (Wk 1 / Wk 2 for period tab)
  value: number;
  isBest: boolean;
  isCurrent: boolean;
};

type Props = {
  entries: Entry[];
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

function getWeekStart(date: string, weekStartDay: 0 | 1): string {
  const dow = new Date(date + "T00:00:00").getDay();
  const offset = weekStartDay === 0 ? dow : (dow === 0 ? 6 : dow - 1);
  return addDays(date, -offset);
}


// ---------------------------------------------------------------------------
// Compute bar data per tab
// ---------------------------------------------------------------------------

function computeDay(
  entries: Entry[],
  windowStart: string,
  windowEnd: string,
  today: string,
  mode: Mode,
  subMode: SubMode,
  weekStartDay: 0 | 1,
): BarData[] {
  const displayOrder = weekStartDay === 0
    ? [0, 1, 2, 3, 4, 5, 6]
    : [1, 2, 3, 4, 5, 6, 0];
  const shortLabels = weekStartDay === 0
    ? ["S", "M", "T", "W", "T", "F", "S"]
    : ["M", "T", "W", "T", "F", "S", "S"];

  const totalByDow: number[] = new Array(7).fill(0);
  const countByDow: number[] = new Array(7).fill(0);
  const workedByDow: number[] = new Array(7).fill(0);
  const workedDates = new Set<string>();

  for (const entry of entries) {
    if (entry.date < windowStart || entry.date > windowEnd) continue;
    workedDates.add(entry.date);
  }

  const totalDays = daysBetweenInclusive(windowStart, windowEnd);
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(windowStart, i);
    const jsDay = new Date(d + "T00:00:00").getDay();
    countByDow[jsDay]++;
    if (workedDates.has(d)) workedByDow[jsDay]++;
  }

  for (const entry of entries) {
    if (entry.date < windowStart || entry.date > windowEnd) continue;
    const jsDay = new Date(entry.date + "T00:00:00").getDay();
    totalByDow[jsDay] += entry.flagHours;
  }

  const divisor = subMode === "worked" ? workedByDow : countByDow;
  const avgByDow = totalByDow.map((total, dow) =>
    divisor[dow] > 0 ? total / divisor[dow] : 0
  );

  const todayDow = new Date(today + "T00:00:00").getDay();

  const bars: BarData[] = displayOrder.map((dow, idx) => ({
    label: shortLabels[idx],
    longLabel: DAY_SHORT[dow],
    value: mode === "total" ? totalByDow[dow] : avgByDow[dow],
    isBest: false,
    isCurrent: dow === todayDow,
  }));

  const maxVal = Math.max(...bars.map((b) => b.value));
  if (maxVal > 0) {
    for (const bar of bars) {
      if (bar.value === maxVal) { bar.isBest = true; break; }
    }
  }
  return bars;
}

function computeWeek(
  entries: Entry[],
  windowStart: string,
  windowEnd: string,
  today: string,
  weekStartDay: 0 | 1,
  mode: Mode,
  subMode: SubMode,
): BarData[] {
  const weekTotals = new Map<string, number>();
  const weekWorkedDates = new Map<string, Set<string>>();
  const weekSet = new Set<string>();

  const firstWeekStart = getWeekStart(windowStart, weekStartDay);

  let cursor = firstWeekStart;
  while (cursor <= windowEnd) {
    const wEnd = addDays(cursor, 6);
    if (wEnd >= windowStart) {
      weekSet.add(cursor);
      if (!weekTotals.has(cursor)) weekTotals.set(cursor, 0);
    }
    cursor = addDays(cursor, 7);
  }

  for (const entry of entries) {
    if (entry.date < windowStart || entry.date > windowEnd) continue;
    const ws = getWeekStart(entry.date, weekStartDay);
    weekTotals.set(ws, (weekTotals.get(ws) ?? 0) + entry.flagHours);
    if (!weekWorkedDates.has(ws)) weekWorkedDates.set(ws, new Set());
    weekWorkedDates.get(ws)!.add(entry.date);
  }

  const currentWeekStart = getWeekStart(today, weekStartDay);
  const sortedWeeks = Array.from(weekSet).sort();

  const bars: BarData[] = sortedWeeks.map((ws) => {
    const [, m2, d2] = ws.split("-").map(Number);
    const dateLabel = `${MONTHS_SHORT[m2 - 1]} ${d2}`;
    const total = weekTotals.get(ws) ?? 0;

    let value: number;
    if (mode === "total") {
      value = total;
    } else if (subMode === "worked") {
      const workedDays = weekWorkedDates.get(ws)?.size ?? 0;
      value = workedDays > 0 ? total / workedDays : 0;
    } else {
      const wEnd = addDays(ws, 6);
      const effStart = ws < windowStart ? windowStart : ws;
      const effEnd = wEnd > windowEnd ? windowEnd : wEnd;
      const allDays = effEnd >= effStart ? daysBetweenInclusive(effStart, effEnd) : 0;
      value = allDays > 0 ? total / allDays : 0;
    }

    return { label: dateLabel, longLabel: dateLabel, value, isBest: false, isCurrent: ws === currentWeekStart };
  });

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
  windowStart: string,
  windowEnd: string,
  splitDay: number,
  today: string,
  mode: Mode,
  subMode: SubMode,
): BarData[] {
  const periodTotals = new Map<string, { total: number; start: string; end: string }>();
  const periodWorkedDates = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (entry.date < windowStart || entry.date > windowEnd) continue;
    const period = getPeriodForDate(entry.date, splitDay, {});
    const existing = periodTotals.get(period.key);
    if (existing) {
      existing.total += entry.flagHours;
    } else {
      periodTotals.set(period.key, { total: entry.flagHours, start: period.start, end: period.end });
    }
    if (!periodWorkedDates.has(period.key)) periodWorkedDates.set(period.key, new Set());
    periodWorkedDates.get(period.key)!.add(entry.date);
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

  for (const entry of entries) {
    if (entry.date < windowStart || entry.date > windowEnd) continue;
    const key = entry.date.substring(0, 7);
    monthTotals.set(key, (monthTotals.get(key) ?? 0) + entry.flagHours);
    if (!workedDaysByMonth.has(key)) workedDaysByMonth.set(key, new Set());
    workedDaysByMonth.get(key)!.add(entry.date);
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
): string {
  if (entries.length === 0 || bars.every((b) => b.value === 0)) {
    return "Log more ROs to see insights here.";
  }

  if (activeTab === "day") {
    const withValues = bars.filter((b) => b.value > 0);
    if (withValues.length < 2) {
      const best = bars.find((b) => b.isBest);
      if (best) return `Your best day of the week is ${best.longLabel}, averaging ${fmtHours(best.value)}h.`;
      return "Log more ROs to see insights here.";
    }
    const best = [...bars].sort((a, b) => b.value - a.value)[0];
    const worst = [...withValues].sort((a, b) => a.value - b.value)[0];
    if (worst.value > 0) {
      const pct = Math.round(((best.value - worst.value) / worst.value) * 100);
      if (pct >= 10) return `You average ${pct}% more hours on ${best.longLabel} than ${worst.longLabel}.`;
    }
    return `Your best day of the week is ${best.longLabel}, averaging ${fmtHours(best.value)}h.`;
  }

  if (activeTab === "week" && bars.length >= 2) {
    const lastTwo = bars.slice(-2);
    const prev = lastTwo[0].value, curr = lastTwo[1].value;
    if (prev > 0 && curr > prev) return `Your flag hours are up ${Math.round(((curr - prev) / prev) * 100)}% from last week.`;
    if (prev > 0 && curr < prev) return `Your flag hours are down ${Math.round(((prev - curr) / prev) * 100)}% from last week.`;
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
    const unitNames: Record<TabId, string> = { day: "day", week: "week", period: "period", month: "month" };
    return `Best ${unitNames[activeTab]}: ${best.longLabel} with ${fmtHours(best.value)}h.`;
  }

  return "Log more ROs to see insights here.";
}

// ---------------------------------------------------------------------------
// SVG Bar Chart — Roomier Classic
// ---------------------------------------------------------------------------

const CHART_W = 358;
const CHART_H = 130;
const PAD_L = 4, PAD_R = 4, PAD_T = 6;
const INNER_W = CHART_W - PAD_L - PAD_R;

// Week and Period need extra bottom padding for two label rows
function getPadB(tab: TabId) { return (tab === "week" || tab === "period") ? 42 : 26; }

function RoomierBarChart({
  bars,
  hover,
  setHover,
  tab,
}: {
  bars: BarData[];
  hover: number | null;
  setHover: (i: number | null) => void;
  tab: TabId;
}) {
  const n = bars.length;
  if (n === 0) return null;

  const PAD_B = getPadB(tab);
  const INNER_H = CHART_H - PAD_T - PAD_B;
  const baseline = CHART_H - PAD_B;

  const maxVal = Math.max(...bars.map((b) => b.value), 0.01);
  const slot = INNER_W / n;
  const barW = Math.max(8, Math.min(slot * 0.70, 42));

  // Month tab still uses sparse labels; others have custom logic per-bar
  const labelEvery = Math.max(1, Math.ceil(n / 5));

  return (
    <div className="r-chart-wrap">
      <svg
        className="r-chart"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        overflow="visible"
        aria-hidden="true"
        onMouseLeave={() => setHover(null)}
        onTouchEnd={() => setHover(null)}
      >
        {/* Baseline */}
        <line
          x1={PAD_L} x2={CHART_W - PAD_R}
          y1={baseline + 0.5} y2={baseline + 0.5}
          stroke="var(--line)" strokeWidth="1"
        />

        {bars.map((bar, i) => {
          const cx = PAD_L + slot * (i + 0.5);
          const h = Math.max(3, (bar.value / maxVal) * INNER_H);
          const x = cx - barW / 2;
          const y = baseline - h;
          const isHover = hover === i;
          const highlight = isHover || bar.isCurrent;

          // ── Per-tab label logic ──────────────────────────────────
          let primaryLabel: string | null = null;
          let secondaryLabel: string | null = null;

          if (tab === "day") {
            // All 7 days, use 3-char long label
            primaryLabel = bar.longLabel;

          } else if (tab === "week") {
            // Always show day number; show month abbrev only at month transitions
            const [month, day] = bar.label.split(" ");
            primaryLabel = day ?? bar.label;
            const prevMonth = i > 0 ? bars[i - 1].label.split(" ")[0] : null;
            if (month !== prevMonth) secondaryLabel = month;

          } else if (tab === "period") {
            // Always show period date; always show Wk 1 / Wk 2
            primaryLabel = bar.label;
            secondaryLabel = bar.subLabel ?? null;

          } else {
            // Month tab: sparse labels
            const lastRegularIdx = Math.floor((n - 1) / labelEvery) * labelEvery;
            const show = i % labelEvery === 0 || (i === n - 1 && n - 1 - lastRegularIdx >= 2);
            if (show) primaryLabel = bar.label;
          }

          const labelFontSize = tab === "day" ? 10 : tab === "week" ? 9 : 11;

          return (
            <g key={i}>
              {/* Touch / hover hit zone */}
              <rect
                x={PAD_L + slot * i} y={0} width={slot} height={baseline}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
              />
              {/* Bar — no glow, just color change on highlight */}
              <rect
                x={x} y={y} width={barW} height={h}
                rx={bar.value > 0 ? Math.min(barW / 2, 6) : 0}
                fill={highlight ? "var(--brand)" : "var(--bg-4)"}
              />
              {/* Primary axis label */}
              {primaryLabel && (
                <text
                  x={cx} y={baseline + 14}
                  textAnchor="middle"
                  fontSize={labelFontSize}
                  fontFamily="ui-monospace, Menlo, monospace"
                  fill={bar.isCurrent ? "var(--brand)" : "var(--fg-3)"}
                  fontWeight={bar.isCurrent ? 600 : 400}
                >
                  {primaryLabel}
                </text>
              )}
              {/* Secondary axis label (month transitions for week; Wk 1/2 for period) */}
              {secondaryLabel && (
                <text
                  x={cx} y={baseline + 28}
                  textAnchor="middle"
                  fontSize={tab === "week" ? 8 : 9}
                  fontFamily="ui-monospace, Menlo, monospace"
                  fill="var(--fg-3)"
                  opacity={0.65}
                >
                  {secondaryLabel}
                </text>
              )}
              {/* Hover indicator dot */}
              {isHover && bar.value > 0 && (
                <circle cx={cx} cy={y - 7} r={2.2} fill="var(--brand)" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AveragesChart({
  entries,
  today,
  periodStart,
  weekStartDay,
  splitDay,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("day");
  const [mode, setMode] = useState<Mode>("total");
  const [subMode, setSubMode] = useState<SubMode>("worked");
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("frt:avg_mode");
      if (stored === "all" || stored === "worked") setSubMode(stored);
    } catch { /* ignore */ }
  }, []);

  function handleSubMode(next: SubMode) {
    setSubMode(next);
    try { localStorage.setItem("frt:avg_mode", next); } catch { /* ignore */ }
  }

  const windowStart = addDays(today, -89);
  const windowEnd = today;

  const bars: BarData[] = (() => {
    switch (activeTab) {
      case "day":    return computeDay(entries, windowStart, windowEnd, today, mode, subMode, weekStartDay);
      case "week":   return computeWeek(entries, windowStart, windowEnd, today, weekStartDay, mode, subMode);
      case "period": return computePeriod(entries, windowStart, windowEnd, splitDay, today, mode, subMode);
      case "month":  return computeMonth(entries, windowStart, windowEnd, today, mode, subMode);
    }
  })();

  const bestIdx  = bars.findIndex((b) => b.isBest);
  const currIdx  = bars.findIndex((b) => b.isCurrent);
  const activeIdx = hover ?? (currIdx >= 0 ? currIdx : bestIdx >= 0 ? bestIdx : 0);
  const activeBar = bars[activeIdx];

  const unitLabel = mode === "total"
    ? "total"
    : subMode === "worked" ? "avg / worked day" : "avg / day";

  const total90d = entries
    .filter((e) => e.date >= windowStart && e.date <= windowEnd)
    .reduce((s, e) => s + e.flagHours, 0);

  const unitNames: Record<TabId, string> = { day: "day", week: "week", period: "period", month: "month" };
  const bestBar = bars[bestIdx];

  const insightText = computeInsight(entries, windowStart, windowEnd, activeTab, bars);

  const tabs: { id: TabId; label: string }[] = [
    { id: "day", label: "Day" },
    { id: "week", label: "Week" },
    { id: "period", label: "Period" },
    { id: "month", label: "Month" },
  ];

  return (
    <>
      <section>
        <div className="section-title">Flagged Hours</div>
        <div className="card padded">
          {/* HEADER — tabs only */}
          <div className="r-tabbar" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTab === t.id}
                className={`r-tab${activeTab === t.id ? " active" : ""}`}
                onClick={() => setActiveTab(t.id)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* READOUT ROW — value always lives here, never over the bars */}
          <div className="r-readout">
            <div className="r-readout-main">
              <span className="r-readout-label">
                {activeBar?.longLabel ?? "—"}
              </span>
              <span className="r-readout-value">
                {activeBar ? `${fmtHours(activeBar.value)}h` : "—"}
              </span>
              <span className="r-readout-unit">{unitLabel}</span>
            </div>
          </div>

          {/* MODE ROW — Total/Avg pill; Worked/All only visible in Avg mode */}
          <div className="r-modewrap">
            <div className="r-mode-toggle" role="tablist" aria-label="Total or average">
              <button
                role="tab"
                aria-selected={mode === "total"}
                className={`r-mode-btn${mode === "total" ? " on" : ""}`}
                onClick={() => setMode("total")}
                type="button"
              >
                Total
              </button>
              <button
                role="tab"
                aria-selected={mode === "avg"}
                className={`r-mode-btn${mode === "avg" ? " on" : ""}`}
                onClick={() => setMode("avg")}
                type="button"
              >
                Avg
              </button>
            </div>
            {mode === "avg" && (
              <div className="r-sub-toggle">
                <button
                  className={`r-sub-btn${subMode === "worked" ? " on" : ""}`}
                  onClick={() => handleSubMode("worked")}
                  type="button"
                >
                  Worked days
                </button>
                <button
                  className={`r-sub-btn${subMode === "all" ? " on" : ""}`}
                  onClick={() => handleSubMode("all")}
                  type="button"
                >
                  All days
                </button>
              </div>
            )}
          </div>

          {/* CHART */}
          <RoomierBarChart bars={bars} hover={hover} setHover={setHover} tab={activeTab} />

          {/* FOOTER */}
          <div className="r-footer">
            <span className="r-footer-stat">
              <span className="r-footer-num">{fmtHours(total90d)}h</span>
              <span className="r-footer-cap">last 90d</span>
            </span>
            <span className="r-footer-dot" />
            <span className="r-footer-stat">
              <span className="r-footer-num">{bestBar?.longLabel ?? "—"}</span>
              <span className="r-footer-cap">best {unitNames[activeTab]}</span>
            </span>
          </div>
        </div>
      </section>

      {/* Insight bubble */}
      <div
        className="card brand-tinted"
        style={{ padding: "14px 16px", marginTop: -6 }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "var(--brand)",
            fontWeight: 550,
            marginBottom: 6,
          }}
        >
          💡 Insight
        </div>
        <p style={{ margin: 0, fontSize: 14, color: "var(--fg-1)", lineHeight: 1.5 }}>
          {insightText}
        </p>
      </div>
    </>
  );
}
