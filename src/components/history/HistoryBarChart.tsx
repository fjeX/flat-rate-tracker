"use client";

import { useState } from "react";
import type { Entry } from "@/lib/types";
import { addDays } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";

type FilterKind = "today" | "week" | "period" | "month" | "all";

type Props = {
  entries: Entry[];
  filter: FilterKind;
  today: string;
  periodStart: string;
  periodEnd: string;
  weekStart: string;
  weekEnd: string;
  monthStart: string;
  monthEnd: string;
  periodFlagHours: number;
  goalHours: number;
};

// Generate an array of YYYY-MM-DD strings from start to end inclusive.
function dateRange(start: string, end: string): string[] {
  const result: string[] = [];
  let cur = start;
  while (cur <= end) {
    result.push(cur);
    cur = addDays(cur, 1);
  }
  return result;
}

// Get YYYY-MM from a date string.
function yearMonth(d: string): string {
  return d.slice(0, 7);
}

// Format "Apr 1" from a YYYY-MM-DD string.
function fmtShort(d: string): string {
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [, m, day] = d.split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}`;
}

// Format "Apr 2026" for month labels in "all" mode.
function fmtMonthLabel(ym: string): string {
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [, m] = ym.split("-").map(Number);
  const year = ym.slice(0, 4);
  return `${MONTHS[m - 1]} '${year.slice(2)}`;
}

// Get hour label like "2 PM" from an hour 0-23.
function fmtHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

type BarData = {
  label: string;
  hours: number;
  isToday: boolean;
  isFuture: boolean;
};

function buildBars(
  entries: Entry[],
  filter: FilterKind,
  today: string,
  periodStart: string,
  periodEnd: string,
  weekStart: string,
  weekEnd: string,
  monthStart: string,
  monthEnd: string,
): BarData[] {
  // Map date -> flag hours
  const byDate = new Map<string, number>();
  for (const e of entries) {
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.flagHours);
  }

  switch (filter) {
    case "today": {
      // Group by hour using createdAt
      const byHour = new Map<number, number>();
      for (const e of entries) {
        if (e.date !== today) continue;
        const h = new Date(e.createdAt).getHours();
        byHour.set(h, (byHour.get(h) ?? 0) + e.flagHours);
      }
      if (byHour.size === 0) {
        // No entries today — show a single "Today" bar
        return [{ label: "Today", hours: 0, isToday: true, isFuture: false }];
      }
      const now = new Date();
      const currentHour = now.getHours();
      // Span from earliest logged hour to current hour
      const hours = Array.from(byHour.keys());
      const minH = Math.min(...hours);
      const result: BarData[] = [];
      for (let h = minH; h <= currentHour; h++) {
        result.push({
          label: fmtHour(h),
          hours: byHour.get(h) ?? 0,
          isToday: h === currentHour,
          isFuture: false,
        });
      }
      return result;
    }

    case "week": {
      const days = dateRange(weekStart, weekEnd);
      return days.map((d) => {
        const dt = new Date(d + "T12:00:00");
        const label = dt.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1) +
          dt.toLocaleDateString("en-US", { weekday: "short" }).slice(1, 3);
        return {
          label,
          hours: byDate.get(d) ?? 0,
          isToday: d === today,
          isFuture: d > today,
        };
      });
    }

    case "period": {
      const days = dateRange(periodStart, periodEnd);
      return days.map((d) => {
        return {
          label: fmtShort(d),
          hours: byDate.get(d) ?? 0,
          isToday: d === today,
          isFuture: d > today,
        };
      });
    }

    case "month": {
      const days = dateRange(monthStart, monthEnd);
      return days.map((d) => {
        const dayNum = Number(d.split("-")[2]);
        return {
          label: String(dayNum),
          hours: byDate.get(d) ?? 0,
          isToday: d === today,
          isFuture: d > today,
        };
      });
    }

    case "all": {
      if (entries.length === 0) {
        return [];
      }
      // Group by year-month
      const byMonth = new Map<string, number>();
      for (const e of entries) {
        const ym = yearMonth(e.date);
        byMonth.set(ym, (byMonth.get(ym) ?? 0) + e.flagHours);
      }
      const sortedMonths = Array.from(byMonth.keys()).sort();
      const todayYM = yearMonth(today);
      return sortedMonths.map((ym) => ({
        label: fmtMonthLabel(ym),
        hours: byMonth.get(ym) ?? 0,
        isToday: ym === todayYM,
        isFuture: ym > todayYM,
      }));
    }
  }
}

function getChartTitle(filter: FilterKind): string {
  switch (filter) {
    case "today":  return "Today";
    case "week":   return "This Week";
    case "period": return "Pay Period";
    case "month":  return "This Month";
    case "all":    return "All Time";
  }
}

export function HistoryBarChart({
  entries,
  filter,
  today,
  periodStart,
  periodEnd,
  weekStart,
  weekEnd,
  monthStart,
  monthEnd,
  periodFlagHours,
  goalHours,
}: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const bars = buildBars(
    entries,
    filter,
    today,
    periodStart,
    periodEnd,
    weekStart,
    weekEnd,
    monthStart,
    monthEnd,
  );

  const totalHours = bars.reduce((s, b) => s + b.hours, 0);
  const maxHours = Math.max(...bars.map((b) => b.hours), 0.1);

  const title = getChartTitle(filter);
  const metaLabel =
    filter === "period"
      ? `${fmtHours(periodFlagHours)}h / ${goalHours}h target`
      : `${fmtHours(totalHours)}h total`;

  if (bars.length === 0) {
    return (
      <div className="card padded">
        <div className="period-bars-head">
          <span className="title">{title}</span>
          <span className="meta">{metaLabel}</span>
        </div>
        <div
          style={{
            height: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--fg-3)",
            fontSize: 12,
          }}
        >
          No data yet
        </div>
      </div>
    );
  }

  // SVG layout constants
  const SVG_W = 320;
  const SVG_H = 90;
  const LABEL_H = 14; // height reserved at bottom for date labels
  const TOP_PAD = 6;
  const CHART_H = SVG_H - LABEL_H - TOP_PAD;
  const TOOLTIP_W = 56;
  const TOOLTIP_H = 18;
  const n = bars.length;

  // Bar dimensions — cap bar width to keep them readable
  const totalGap = Math.max(n - 1, 0) * 4;
  const rawBarW = n > 0 ? (SVG_W - totalGap) / n : SVG_W;
  const barW = Math.min(rawBarW, 18);
  const usedW = n * barW + Math.max(n - 1, 0) * 4;
  const startX = (SVG_W - usedW) / 2;

  // Find today bar index for marker
  const todayIdx = bars.findIndex((b) => b.isToday);

  return (
    <div className="card padded">
      <div className="period-bars-head">
        <span className="title">{title}</span>
        <span className="meta" style={{ fontVariantNumeric: "tabular-nums" }}>
          {metaLabel}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height="auto"
        style={{ display: "block", overflow: "visible" }}
        aria-label={`${title} bar chart`}
      >
        {bars.map((bar, i) => {
          const x = startX + i * (barW + 4);
          const heightRatio = bar.hours / maxHours;
          // Bars with 0 hours get a visible minimum height of 20% so the chart isn't blank
          const barH = Math.max(heightRatio * CHART_H, CHART_H * 0.12);
          const y = TOP_PAD + CHART_H - barH;

          let fillProps: React.SVGProps<SVGRectElement>;
          if (bar.isFuture) {
            fillProps = {
              fill: "none",
              stroke: "var(--fg-3)",
              strokeWidth: 1,
              strokeDasharray: "3 2",
            };
          } else if (bar.isToday) {
            fillProps = {
              fill: "var(--brand)",
              opacity: 0.95,
            };
          } else {
            fillProps = {
              fill: "var(--bg-4)",
              opacity: 0.9,
            };
          }

          const tooltipCenterX = x + barW / 2;
          const tooltipX = Math.min(Math.max(tooltipCenterX - TOOLTIP_W / 2, 0), SVG_W - TOOLTIP_W);
          const tooltipY = TOP_PAD - TOOLTIP_H - 4;

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
                ry={3}
                {...fillProps}
              />
              {/* Hour value above bar for today when not hovered */}
              {bar.hours > 0 && bar.isToday && hoveredIdx !== i && (
                <text
                  x={x + barW / 2}
                  y={y - 2}
                  textAnchor="middle"
                  fontSize="7"
                  fill="var(--brand)"
                  fontWeight="600"
                >
                  {fmtHours(bar.hours)}
                </text>
              )}
              {/* Hover tooltip */}
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
                    y={tooltipY + TOOLTIP_H / 2 + 3.5}
                    textAnchor="middle"
                    fontSize={9}
                    fill="var(--fg-0)"
                    fontWeight={bar.isToday ? 600 : 400}
                  >
                    {bar.label}: {fmtHours(bar.hours)}h
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* Bottom labels — show first and last only for dense charts, all for sparse */}
        {bars.length <= 8 ? (
          bars.map((bar, i) => {
            const x = startX + i * (barW + 4) + barW / 2;
            return (
              <text
                key={i}
                x={x}
                y={SVG_H - 2}
                textAnchor="middle"
                fontSize="7.5"
                fill={bar.isToday ? "var(--brand)" : "var(--fg-3)"}
              >
                {bar.label}
              </text>
            );
          })
        ) : (
          <>
            <text
              x={startX + barW / 2}
              y={SVG_H - 2}
              textAnchor="middle"
              fontSize="8"
              fill="var(--fg-3)"
            >
              {bars[0].label}
            </text>
            <text
              x={startX + (n - 1) * (barW + 4) + barW / 2}
              y={SVG_H - 2}
              textAnchor="middle"
              fontSize="8"
              fill="var(--fg-3)"
            >
              {bars[n - 1].label}
            </text>
            {/* Show "today" label if today is not first or last */}
            {todayIdx > 0 && todayIdx < n - 1 && (
              <text
                x={startX + todayIdx * (barW + 4) + barW / 2}
                y={SVG_H - 2}
                textAnchor="middle"
                fontSize="7.5"
                fill="var(--brand)"
              >
                Today
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
