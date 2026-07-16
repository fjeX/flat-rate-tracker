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
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--fg-0)" }}>Schedule</h1>
        <section className="card padded-lg mt-6">
          <p className="text-sm" style={{ color: "var(--fg-2)" }}>
            The schedule feature isn&apos;t available yet — the database
            migration hasn&apos;t been applied to this environment.
          </p>
        </section>
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
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "var(--fg-0)" }}>Schedule</h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/schedule?m=${monthShift(monthKey, -1)}`}
            className="btn btn-ghost btn-sm hit-expand"
            aria-label="Previous month"
          >
            ‹
          </Link>
          <span className="tabular text-sm font-medium" style={{ color: "var(--fg-1)", minWidth: 110, textAlign: "center" }}>
            {monthLabel(monthKey)}
          </span>
          <Link
            href={`/schedule?m=${monthShift(monthKey, 1)}`}
            className="btn btn-ghost btn-sm hit-expand"
            aria-label="Next month"
          >
            ›
          </Link>
          {monthKey !== today.slice(0, 7) && (
            <Link href="/schedule" className="btn btn-ghost btn-sm">
              Today
            </Link>
          )}
        </div>
      </div>

      <p className="mt-1 text-sm" style={{ color: "var(--fg-2)" }}>
        Your efficiency is only as honest as the hours behind it. This
        calendar tells FRT what a normal day looks like for you — so on days
        you don&apos;t enter clocked hours, your flag divides by your real
        schedule instead of showing nothing. Set your weekly pattern below
        once; tap any day to record the hours you actually worked, mark a day
        off, or change one day&apos;s shift when you stay late.{" "}
        <span style={{ color: "var(--warn)" }}>Amber</span> days are scheduled
        workdays with nothing logged — settle those so they can&apos;t quietly
        skew your number.
      </p>

      <section className="mt-4">
        <ScheduleCalendar days={days} today={today} weekStartDay={weekStartDay} />
      </section>

      <section className="mt-8">
        <h2 className="section-title">Weekly pattern</h2>
        <ScheduleCard
          initialSchedules={schedules}
          suggestion={scheduleSuggestion}
          today={today}
        />
      </section>
    </main>
  );
}
