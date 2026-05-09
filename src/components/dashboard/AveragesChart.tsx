"use client";

import { useEffect, useState } from "react";
import type { Entry } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { getPeriodForDate, addDays } from "@/lib/periods";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = "day" | "week" | "period" | "month";

type BarData = {
  label: string;
  value: number; // avg flag hours
  isBest: boolean;
  isCurrent: boolean; // today / this week / this period / this month
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
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
// JS getDay(): 0=Sun,1=Mon,...,6=Sat
// Display order: Mon(1),Tue(2),Wed(3),Thu(4),Fri(5),Sat(6),Sun(0)
const DISPLAY_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES_LONG = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------------------
// Computation helpers
// ---------------------------------------------------------------------------

function daysBetweenInclusive(start: string, end: string): number {
  const a = new Date(start + "T00:00:00");
  const b = new Date(end + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Get ISO date string for day at offset from windowStart. */
function dateAtOffset(windowStart: string, offset: number): string {
  return addDays(windowStart, offset);
}

// ---------------------------------------------------------------------------
// Per-tab data computation
// ---------------------------------------------------------------------------

function computeDay(
  entries: Entry[],
  windowStart: string,
  windowEnd: string,
  today: string,
  avgMode: "all" | "worked",
  weekStartDay: 0 | 1,
): BarData[] {
  const displayOrder = weekStartDay === 0
    ? [0, 1, 2, 3, 4, 5, 6]   // Sun-first
    : [1, 2, 3, 4, 5, 6, 0];  // Mon-first
  const labels = weekStartDay === 0
    ? ["S", "M", "T", "W", "T", "F", "S"]
    : ["M", "T", "W", "T", "F", "S", "S"];

  const totalByDow: number[] = new Array(7).fill(0);
  const countByDow: number[] = new Array(7).fill(0);   // calendar days
  const workedByDow: number[] = new Array(7).fill(0);  // distinct dates with entries

  const workedDates = new Set<string>();
  for (const entry of entries) {
    if (entry.date < windowStart || entry.date > windowEnd) continue;
    workedDates.add(entry.date);
  }

  const totalDays = daysBetweenInclusive(windowStart, windowEnd);
  for (let i = 0; i < totalDays; i++) {
    const d = dateAtOffset(windowStart, i);
    const jsDay = new Date(d + "T00:00:00").getDay();
    countByDow[jsDay]++;
    if (workedDates.has(d)) workedByDow[jsDay]++;
  }

  for (const entry of entries) {
    if (entry.date < windowStart || entry.date > windowEnd) continue;
    const jsDay = new Date(entry.date + "T00:00:00").getDay();
    totalByDow[jsDay] += entry.flagHours;
  }

  const divisor = avgMode === "worked" ? workedByDow : countByDow;
  const avgByDow = totalByDow.map((total, dow) =>
    divisor[dow] > 0 ? total / divisor[dow] : 0
  );

  const todayDow = new Date(today + "T00:00:00").getDay();

  const bars: BarData[] = displayOrder.map((dow, idx) => ({
    label: labels[idx],
    value: avgByDow[dow],
    isBest: false,
    isCurrent: dow === todayDow,
  }));

  const maxVal = Math.max(...bars.map((b) => b.value));
  if (maxVal > 0) {
    for (const bar of bars) {
      if (bar.value === maxVal) {
        bar.isBest = true;
        break;
      }
    }
  }

  return bars;
}

function getWeekStart(date: string, weekStartDay: 0 | 1): string {
  const dow = new Date(date + "T00:00:00").getDay(); // 0=Sun
  const offset = weekStartDay === 0 ? dow : (dow === 0 ? 6 : dow - 1);
  return addDays(date, -offset);
}

function computeWeek(
  entries: Entry[],
  windowStart: string,
  windowEnd: string,
  today: string,
  weekStartDay: 0 | 1,
): BarData[] {
  const weekTotals = new Map<string, number>();
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
  }

  const currentWeekStart = getWeekStart(today, weekStartDay);
  const sortedWeeks = Array.from(weekSet).sort();
  const bars: BarData[] = sortedWeeks.map((ws) => {
    const [, m2, d2] = ws.split("-").map(Number);
    return {
      label: `${MONTHS_SHORT[m2 - 1]} ${d2}`,
      value: weekTotals.get(ws) ?? 0,
      isBest: false,
      isCurrent: ws === currentWeekStart,
    };
  });

  const maxVal = Math.max(...bars.map((b) => b.value), 0);
  if (maxVal > 0) {
    for (const bar of bars) {
      if (bar.value === maxVal) {
        bar.isBest = true;
        break;
      }
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
): BarData[] {
  const periodTotals = new Map<string, { total: number; start: string; end: string }>();

  for (const entry of entries) {
    if (entry.date < windowStart || entry.date > windowEnd) continue;
    const period = getPeriodForDate(entry.date, splitDay, {});
    const existing = periodTotals.get(period.key);
    if (existing) {
      existing.total += entry.flagHours;
    } else {
      periodTotals.set(period.key, { total: entry.flagHours, start: period.start, end: period.end });
    }
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

  const bars: BarData[] = sorted.map(([key, { total, start }]) => {
    const [, m, d] = start.split("-").map(Number);
    return {
      label: `${MONTHS_SHORT[m - 1]} ${d}`,
      value: total,
      isBest: false,
      isCurrent: key === currentPeriod.key,
    };
  });

  const maxVal = Math.max(...bars.map((b) => b.value), 0);
  if (maxVal > 0) {
    for (const bar of bars) {
      if (bar.value === maxVal) {
        bar.isBest = true;
        break;
      }
    }
  }

  return bars;
}

function computeMonth(
  entries: Entry[],
  windowStart: string,
  windowEnd: string,
  today: string,
  avgMode: "all" | "worked",
): BarData[] {
  const monthTotals = new Map<string, number>();
  const workedDaysByMonth = new Map<string, Set<string>>();

  const [startYear, startMonth] = windowStart.split("-").map(Number);
  const [endYear, endMonth] = windowEnd.split("-").map(Number);

  let y = startYear;
  let m = startMonth;
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
    const divisor = avgMode === "worked"
      ? (workedDaysByMonth.get(key)?.size ?? 0)
      : daysInMonth(y2, m2);
    return {
      label: MONTHS_SHORT[m2 - 1],
      value: divisor > 0 ? total / divisor : 0,
      isBest: false,
      isCurrent: key === currentMonth,
    };
  });

  const maxVal = Math.max(...bars.map((b) => b.value), 0);
  if (maxVal > 0) {
    for (const bar of bars) {
      if (bar.value === maxVal) {
        bar.isBest = true;
        break;
      }
    }
  }

  return bars;
}

// ---------------------------------------------------------------------------
// Insight computation
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
    // Find best and worst non-zero days
    const withValues = bars.filter((b) => b.value > 0);
    if (withValues.length < 2) {
      const best = bars.find((b) => b.isBest);
      if (best) {
        const dayIdx = DAY_LABELS.indexOf(best.label);
        const dayName = dayIdx >= 0 ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dayIdx] : best.label;
        return `Your best day of the week is ${dayName}, averaging ${fmtHours(best.value)}h.`;
      }
      return "Log more ROs to see insights here.";
    }
    const best = [...bars].sort((a, b) => b.value - a.value)[0];
    const worst = [...withValues].sort((a, b) => a.value - b.value)[0];
    const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const bestIdx = DAY_LABELS.indexOf(best.label);
    const worstIdx = dayLabels.indexOf(worst.label);
    const bestName = bestIdx >= 0 ? dayLabels[bestIdx] : best.label;
    const worstDow = bars.indexOf(worst);
    const worstName = worstDow >= 0 ? dayLabels[worstDow] : worst.label;

    if (worst.value > 0) {
      const pct = Math.round(((best.value - worst.value) / worst.value) * 100);
      if (pct >= 10) {
        return `You average ${pct}% more hours on ${bestName} than ${worstName}.`;
      }
    }
    return `Your best day of the week is ${bestName}, averaging ${fmtHours(best.value)}h.`;
  }

  if (activeTab === "week" && bars.length >= 2) {
    const lastTwo = bars.slice(-2);
    const prev = lastTwo[0].value;
    const curr = lastTwo[1].value;
    if (prev > 0 && curr > prev) {
      const pct = Math.round(((curr - prev) / prev) * 100);
      return `Your flag hours are up ${pct}% from last week.`;
    }
    if (prev > 0 && curr < prev) {
      const pct = Math.round(((prev - curr) / prev) * 100);
      return `Your flag hours are down ${pct}% from last week.`;
    }
  }

  if (activeTab === "period" && bars.length >= 2) {
    const lastTwo = bars.slice(-2);
    const prev = lastTwo[0].value;
    const curr = lastTwo[1].value;
    if (prev > 0 && curr > prev) {
      const pct = Math.round(((curr - prev) / prev) * 100);
      return `Your flag hours are up ${pct}% from last period.`;
    }
    if (prev > 0 && curr < prev) {
      const pct = Math.round(((prev - curr) / prev) * 100);
      return `Your flag hours are down ${pct}% from last period.`;
    }
  }

  if (activeTab === "month" && bars.length >= 2) {
    const lastTwo = bars.slice(-2);
    const prev = lastTwo[0].value;
    const curr = lastTwo[1].value;
    if (prev > 0 && curr > prev) {
      const pct = Math.round(((curr - prev) / prev) * 100);
      return `Your flag hours are up ${pct}% from last month.`;
    }
    if (prev > 0 && curr < prev) {
      const pct = Math.round(((prev - curr) / prev) * 100);
      return `Your flag hours are down ${pct}% from last month.`;
    }
  }

  // Fallback: show best bar info
  const best = bars.find((b) => b.isBest);
  if (best) {
    const unitNames: Record<TabId, string> = { day: "day", week: "week", period: "period", month: "month" };
    return `Best ${unitNames[activeTab]}: ${best.label} with ${fmtHours(best.value)}h avg.`;
  }

  return "Log more ROs to see insights here.";
}

// ---------------------------------------------------------------------------
// Footer text
// ---------------------------------------------------------------------------

function computeFooter(tab: TabId, bars: BarData[]): string {
  const totalHours = bars.reduce((s, b) => s + b.value, 0);
  const nonZero = bars.filter((b) => b.value > 0);
  if (nonZero.length === 0) return "No data yet";

  const avg = totalHours / (tab === "day" ? 7 : bars.length);
  const best = bars.find((b) => b.isBest);

  const unitLabel = tab === "day" ? "day" : tab === "week" ? "week" : tab === "period" ? "period" : "month";
  const bestLabel = best?.label ?? "—";

  return `Avg ${fmtHours(avg)}h/${unitLabel} · best ${unitLabel}: ${bestLabel}`;
}

// ---------------------------------------------------------------------------
// SVG Bar Chart
// ---------------------------------------------------------------------------

const CHART_W = 300;
const CHART_H = 58;
const BAR_AREA_H = 42;
const LABEL_H = 14;
const MIN_BAR_H = 2;

function BarChart({ bars }: { bars: BarData[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const count = bars.length;
  if (count === 0) return null;

  const maxVal = Math.max(...bars.map((b) => b.value), 0.1);
  const barW = Math.max(8, Math.floor((CHART_W - (count - 1) * 6) / count));
  const totalW = barW * count + Math.max(0, count - 1) * 6;
  const offsetX = (CHART_W - totalW) / 2;

  const showAllLabels = count <= 8;
  const seenMonths = new Set<string>();
  const labelVisible = bars.map((bar) => {
    if (bar.isCurrent || bar.isBest) return true;
    const month = bar.label.split(" ")[0];
    if (!seenMonths.has(month)) { seenMonths.add(month); return true; }
    return false;
  });

  const TOOLTIP_W = 50;
  const TOOLTIP_H = 18;

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      width="100%"
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      {bars.map((bar, i) => {
        const x = offsetX + i * (barW + 6);
        const barH = bar.value > 0
          ? Math.max(MIN_BAR_H, Math.round((bar.value / maxVal) * BAR_AREA_H))
          : MIN_BAR_H;
        const y = BAR_AREA_H - barH;

        const tooltipCenterX = x + barW / 2;
        const tooltipX = Math.min(Math.max(tooltipCenterX - TOOLTIP_W / 2, 0), CHART_W - TOOLTIP_W);
        const tooltipY = y - TOOLTIP_H - 4;

        return (
          <g
            key={i}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={3}
              fill={bar.isCurrent ? "var(--brand)" : "var(--bg-4)"}
              style={
                bar.isCurrent
                  ? { filter: "drop-shadow(0 0 6px oklch(0.65 0.18 50 / 0.40))" }
                  : undefined
              }
            />
            {(showAllLabels || labelVisible[i]) && (
              <text
                x={x + barW / 2}
                y={CHART_H - 1}
                textAnchor="middle"
                fontSize={9}
                fill={bar.isCurrent ? "var(--brand)" : "var(--fg-3)"}
                fontWeight={bar.isCurrent ? 600 : 400}
              >
                {bar.label}
              </text>
            )}
            {hoveredIdx === i && (
              <>
                <rect
                  x={tooltipX}
                  y={tooltipY}
                  width={TOOLTIP_W}
                  height={TOOLTIP_H}
                  rx={4}
                  fill="var(--bg-3)"
                  stroke="var(--line)"
                  strokeWidth={1}
                />
                <text
                  x={tooltipX + TOOLTIP_W / 2}
                  y={tooltipY + TOOLTIP_H / 2 + 3}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--fg-0)"
                  fontWeight={bar.isCurrent ? 600 : 400}
                >
                  {bar.label}: {fmtHours(bar.value)}h
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// We need splitDay for period computation — pass it as a prop or derive from periodStart/End.
// Since we don't have it directly, we'll default to 15 (standard split).
// The page could pass it, but the spec doesn't include it, so we infer from periodStart.

function inferSplitDay(periodStart: string): number {
  const day = parseInt(periodStart.split("-")[2], 10);
  // P1 starts on day 1, P2 starts on day splitDay+1
  // If start day is 1, this is P1, splitDay is unknown — use 15 as default
  // If start day is > 1, this is P2, splitDay = start day - 1
  return day > 1 ? day - 1 : 15;
}

export function AveragesChart({
  entries,
  today,
  periodStart,
  periodEnd,
  weekStart,
  weekEnd,
  monthStart,
  monthEnd,
  weekStartDay,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("day");
  const [avgMode, setAvgMode] = useState<"all" | "worked">("worked");
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("frt:avg_mode");
      if (stored === "all" || stored === "worked") setAvgMode(stored);
    } catch { /* ignore */ }
  }, []);

  function toggleAvgMode(next: "all" | "worked") {
    setAvgMode(next);
    try { localStorage.setItem("frt:avg_mode", next); } catch { /* ignore */ }
  }

  const ninetyDaysAgo = addDays(today, -89);
  const windowStart = ninetyDaysAgo;
  const windowEnd = today;

  const splitDay = inferSplitDay(periodStart);

  const bars: BarData[] = (() => {
    switch (activeTab) {
      case "day":
        return computeDay(entries, windowStart, windowEnd, today, avgMode, weekStartDay);
      case "week":
        return computeWeek(entries, windowStart, windowEnd, today, weekStartDay);
      case "period":
        return computePeriod(entries, windowStart, windowEnd, splitDay, today);
      case "month":
        return computeMonth(entries, windowStart, windowEnd, today, avgMode);
    }
  })();

  const footerText = computeFooter(activeTab, bars);
  const insightText = computeInsight(entries, windowStart, windowEnd, activeTab, bars);

  const tabs: { id: TabId; label: string }[] = [
    { id: "day", label: "Day" },
    { id: "week", label: "Week" },
    { id: "period", label: "Period" },
    { id: "month", label: "Month" },
  ];

  const showModeToggle = activeTab === "day" || activeTab === "month";

  const infoText = activeTab === "day"
    ? avgMode === "worked"
      ? "Average flag hours per day of the week — only counting days you actually worked."
      : "Average flag hours per day of the week — spread across all calendar days in the last 90 days."
    : activeTab === "month"
    ? avgMode === "worked"
      ? "Average flag hours per day you worked, grouped by month."
      : "Average flag hours per calendar day of each month (total ÷ days in month)."
    : activeTab === "week"
    ? "Total flag hours per calendar week."
    : "Total flag hours per pay period.";

  return (
    <>
      <section>
        <div className="section-title">Averages</div>
        <div className="card padded">
          {/* Tab row */}
          <div className="avg-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`avg-tab${activeTab === tab.id ? " active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Mode toggle + info — only on day/month tabs */}
          {showModeToggle && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => toggleAvgMode("worked")}
                  style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    borderRadius: 20,
                    border: "1px solid",
                    cursor: "pointer",
                    borderColor: avgMode === "worked" ? "var(--brand)" : "var(--line)",
                    background: avgMode === "worked" ? "var(--brand-bg)" : "var(--bg-3)",
                    color: avgMode === "worked" ? "var(--brand)" : "var(--fg-3)",
                    fontWeight: avgMode === "worked" ? 600 : 400,
                  }}
                >
                  Worked days
                </button>
                <button
                  type="button"
                  onClick={() => toggleAvgMode("all")}
                  style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    borderRadius: 20,
                    border: "1px solid",
                    cursor: "pointer",
                    borderColor: avgMode === "all" ? "var(--brand)" : "var(--line)",
                    background: avgMode === "all" ? "var(--brand-bg)" : "var(--bg-3)",
                    color: avgMode === "all" ? "var(--brand)" : "var(--fg-3)",
                    fontWeight: avgMode === "all" ? 600 : 400,
                  }}
                >
                  All days
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowInfo((v) => !v)}
                aria-label="How is this calculated?"
                style={{
                  fontSize: 11,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: "1px solid var(--line)",
                  background: showInfo ? "var(--brand-bg)" : "var(--bg-3)",
                  color: showInfo ? "var(--brand)" : "var(--fg-3)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                i
              </button>
            </div>
          )}
          {!showModeToggle && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button
                type="button"
                onClick={() => setShowInfo((v) => !v)}
                aria-label="How is this calculated?"
                style={{
                  fontSize: 11,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: "1px solid var(--line)",
                  background: showInfo ? "var(--brand-bg)" : "var(--bg-3)",
                  color: showInfo ? "var(--brand)" : "var(--fg-3)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                i
              </button>
            </div>
          )}

          {/* Info tooltip */}
          {showInfo && (
            <p style={{
              margin: "0 0 8px",
              fontSize: 11.5,
              color: "var(--fg-2)",
              lineHeight: 1.5,
              padding: "6px 10px",
              background: "var(--bg-3)",
              borderRadius: 6,
              border: "1px solid var(--line-soft)",
            }}>
              {infoText}
            </p>
          )}

          {/* Bar chart */}
          <div style={{ padding: "2px 0 4px" }}>
            <BarChart bars={bars} />
          </div>

          {/* Footer */}
          <div className="avg-foot">
            <span style={{ color: "var(--fg-2)", fontSize: 12 }}>{footerText}</span>
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
