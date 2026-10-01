// Schedule page: month calendar over the weekly pattern, one-day overrides,
// days off, clocked hours, and zero-day resolution — plus the pattern editor.
// The calendar is the visual front door; all data lives in the same tables
// the dashboard/efficiency engine already read.
import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { addDays, isoDate, isoDateInTz, startOfWeek } from "@/lib/periods";
import { inferScheduleWeek, shiftForDate } from "@/lib/schedule";
import { ScheduleCalendar, type CalendarDay } from "@/components/schedule/ScheduleCalendar";
import { ScheduleCard } from "@/components/settings/ScheduleCard";
import { StatusField } from "@/components/ui/StatusField";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthShift(monthKey: string, delta: -1 | 1): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const tz = cookieStore.get("frt_timezone")?.value;
  const today = tz ? isoDateInTz(tz) : isoDate();
  const weekStartDay = (Number(cookieStore.get("frt_week_start")?.value ?? "0") as 0 | 1);

  const params = await searchParams;
  const monthKey = MONTH_RE.test(params.m ?? "") ? params.m! : today.slice(0, 7);
  const monthStart = `${monthKey}-01`;
  // Fixed 6-week grid: layout never jumps between months.
  const gridStart = startOfWeek(monthStart, weekStartDay);
  const gridEnd = addDays(gridStart, 41);

  const [schedules, daysOff, confirmedZeroDays, overrides, entries, clocks] =
    await Promise.all([
      db.listWorkSchedulesSafe(supabase),
      db.listDaysOffSafe(supabase),
      db.listConfirmedZeroDaysSafe(supabase),
      db.listShiftOverridesSafe(supabase),
      db.listEntries(supabase, { from: gridStart, to: gridEnd }),
      db.listDailyClocks(supabase, { from: gridStart, to: gridEnd }),
    ]);

  if (schedules === null) {
    return (
      <main className="sch-page">
        <div className="pagehead">
          <div className="grow">
            <h1>Schedule</h1>
          </div>
        </div>
        <StatusField tag="Note">
          The schedule feature isn&apos;t available yet — the database migration
          hasn&apos;t been applied to this environment.
        </StatusField>
      </main>
    );
  }

  // First-time setup nicety: propose the weekdays the tech actually logs.
  let scheduleSuggestion = null;
  if (schedules.length === 0) {
    const entryDays = await db.listAllEntryDays(supabase);
    scheduleSuggestion = inferScheduleWeek(
      [...new Set(entryDays.map((d) => d.date))],
      today,
    );
  }

  const offRanges = daysOff ?? [];
  const zeroSet = new Set(confirmedZeroDays ?? []);
  const overrideMap = overrides ?? {};

  const flagByDay = new Map<string, { flag: number; count: number }>();
  for (const e of entries) {
    const agg = flagByDay.get(e.date) ?? { flag: 0, count: 0 };
    agg.flag += e.flagHours;
    agg.count += 1;
    flagByDay.set(e.date, agg);
  }
  const clockByDay = new Map(clocks.map((c) => [c.date, c.hours]));

  const days: CalendarDay[] = [];
  for (let i = 0, d = gridStart; i < 42; i++, d = addDays(d, 1)) {
    const offRange =
      offRanges.find((r) => r.startDate <= d && d <= r.endDate) ?? null;
    const shift = shiftForDate(schedules, d, overrideMap);
    const clocked = clockByDay.get(d) ?? null;
    const dayAgg = flagByDay.get(d) ?? { flag: 0, count: 0 };
    // Same holdout rule as the efficiency engine (stats.ts): a completed
    // scheduled workday with no flag, no clock, no off mark, no confirmation.
    const unresolved =
      d < today &&
      offRange === null &&
      shift !== null &&
      (clocked === null || clocked <= 0) &&
      dayAgg.flag === 0 &&
      !zeroSet.has(d);

    days.push({
      date: d,
      inMonth: d.slice(0, 7) === monthKey,
      shift,
      hasOverride: d in overrideMap,
      offRange: offRange
        ? { id: offRange.id, startDate: offRange.startDate, endDate: offRange.endDate }
        : null,
      clockedHours: clocked,
      flagHours: dayAgg.flag,
      roCount: dayAgg.count,
      confirmedZero: zeroSet.has(d),
      unresolved,
    });
  }

  return (
    <main className="sch-page">
      <div className="pagehead">
        <div className="grow">
          <h1>Schedule</h1>
          {/* Was seven sentences, which on a 390px phone was the entire first
              screen before a single day was visible. The calendar teaches most
              of this by being used; the mark is explained by the legend above
              the grid, and the weekly pattern explains itself where it sits. */}
          <p>
            Your efficiency is only as honest as the hours behind it. Tap any day
            to record what you actually worked.
          </p>
        </div>
        <div className="sch-picker">
          <Link
            href={`/schedule?m=${monthShift(monthKey, -1)}`}
            className="btn btn-line"
            aria-label="Previous month"
          >
            ‹
          </Link>
          <span className="sch-month">{monthLabel(monthKey)}</span>
          <Link
            href={`/schedule?m=${monthShift(monthKey, 1)}`}
            className="btn btn-line"
            aria-label="Next month"
          >
            ›
          </Link>
          {monthKey !== today.slice(0, 7) && (
            <Link href="/schedule" className="btn btn-quiet">
              Today
            </Link>
          )}
        </div>
      </div>

      <ScheduleCalendar
        days={days}
        today={today}
        weekStartDay={weekStartDay}
        monthName={monthLabel(monthKey)}
      />

      <ScheduleCard
        initialSchedules={schedules}
        suggestion={scheduleSuggestion}
        today={today}
      />
    </main>
  );
}
