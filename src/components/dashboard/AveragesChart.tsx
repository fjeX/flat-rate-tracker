"use client";

import { useState } from "react";
import type { Entry } from "@/lib/types";
import { fmtHours, type DayDenom } from "@/lib/stats";
import { getPeriodForDate, addDays } from "@/lib/periods";
import { ReadoutEfficiency } from "@/components/ui/ReadoutEfficiency";

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
  weekStart: string,
  weekEnd: string,
  windowStart: string,
  windowEnd: string,
  today: string,
  mode: Mode,
): BarData[] {
  // ── Avg source: day-of-week averages across the 90d window ──────────────
  const totalByDow: number[] = new Array(7).fill(0);
  const workedByDow: number[] = new Array(7).fill(0);
  const workedDates = new Set<string>();

  for (const entry of entries) {
    if (entry.date < windowStart || entry.date > windowEnd) continue;
    const jsDay = new Date(entry.date + "T00:00:00").getDay();
    totalByDow[jsDay] += entry.flagHours;
    workedDates.add(entry.date);
  }
  for (const d of workedDates) {
    const jsDay = new Date(d + "T00:00:00").getDay();
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
// SVG Bar Chart — Roomier Classic
// ---------------------------------------------------------------------------

const CHART_W = 358;
const CHART_H = 130;
const PAD_L = 4, PAD_R = 4, PAD_T = 6;
const INNER_W = CHART_W - PAD_L - PAD_R;

// Period needs extra bottom padding for its two label rows (date + Wk 1/2)
function getPadB(tab: TabId) { return tab === "period" ? 42 : 26; }

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

          if (tab === "week") {
            // One bar per weekday of the current week — short weekday label
            primaryLabel = bar.label;

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

          const labelFontSize = tab === "week" ? 10 : 11;

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
      case "week":   return computeWeek(entries, weekStart, weekEnd, windowStart, windowEnd, today, mode);
      case "period": return computePeriod(entries, windowStart, windowEnd, splitDay, today, mode, subMode);
      case "month":  return computeMonth(entries, windowStart, windowEnd, today, mode, subMode);
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

  const tabs: { id: TabId; label: string }[] = [
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
              {/* Day efficiency — total mode only (avg bars are synthetic) */}
              {mode === "total" && activeBar?.date && (
                <ReadoutEfficiency
                  flagHours={activeBar.value}
                  denom={denomByDay?.[activeBar.date]}
                />
              )}
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
          </div>

          {/* CHART — keyed by tab+mode so bar-rise replays on a user-initiated
              tab/mode switch (new data by intent) but NOT when an unrelated
              parent re-render (e.g. a dashboard quick-add refresh) just
              updates bar heights for the same view. */}
          <RoomierBarChart key={`${activeTab}-${mode}`} bars={bars} hover={hover} setHover={setHover} tab={activeTab} />

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
          Insight
        </div>
        <p style={{ margin: 0, fontSize: 14, color: "var(--fg-1)", lineHeight: 1.5 }}>
          {insightText}
        </p>
      </div>
    </>
  );
}
