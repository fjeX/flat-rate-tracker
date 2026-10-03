import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import {
  isoDate,
  isoDateInTz,
  getPeriodForDate,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from "@/lib/periods";
import { ratesToMap } from "@/lib/earnings";
import { dailyDenominators } from "@/lib/stats";
import { parseHistoryParams } from "@/lib/history-url";
import { HistoryView } from "@/components/history/HistoryView";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const weekStartDay = (Number(cookieStore.get("frt_week_start")?.value ?? "0") as 0 | 1);

  const tz = cookieStore.get("frt_timezone")?.value;
  const today = tz ? isoDateInTz(tz) : isoDate();
  const weekStart = startOfWeek(today, weekStartDay);

  const PAGE_SIZE = 100;
  const [entries, allEntries, library, settings, laborRates, photoEntryIds, clocks, schedules, daysOff, shiftOverrides, confirmedZeroDays, unpaid] = await Promise.all([
    db.listEntries(supabase, { limit: PAGE_SIZE }),
    // Every RO, for the chart only (the list still pages). Insights reads the
    // same whole set for its all-time figures.
    db.listEntries(supabase),
    db.listOpCodes(supabase),
    db.getSettings(supabase),
    db.listLaborRates(supabase),
    db.listEntryIdsWithPhotos(supabase),
    // Every clock through today: the chart's span starts at the first RO.
    db.listDailyClocks(supabase, { to: today }),
    // Null pre-migration — the chart just skips the efficiency readout.
    db.listWorkSchedulesSafe(supabase),
    db.listDaysOffSafe(supabase),
    db.listShiftOverridesSafe(supabase),
    db.listConfirmedZeroDaysSafe(supabase),
    // Open-ticket work pairs a day the same way it does on Dashboard and Pay
    // Period (withOpenWorkDays), so a bar's efficiency matches theirs.
    db.listUnpaidTimeSafe(supabase),
  ]);

  // The chart's whole span: the first RO ever logged through today. Every bar
  // (day, week, pay period, month) reads its efficiency from these days.
  const firstDate = allEntries.reduce((min, e) => (e.date < min ? e.date : min), today);
  const hasMore = entries.length === PAGE_SIZE;

  const period = getPeriodForDate(today, settings.splitDay, settings.periodOverrides);

  // The filters the tech left in the URL. A custom range with no usable dates
  // starts where the page always has: this pay period through today.
  const initial = parseHistoryParams(await searchParams, { from: period.start, to: today });

  // Per-day efficiency denominators over the chart's whole span.
  const scheduleCtx =
    schedules !== null && schedules.length > 0
      ? {
          schedules,
          daysOff: daysOff ?? [],
          // Was hardcoded []. Harmless while dailyDenominators ignored the
          // field; under the shared pairing rule an empty list turns every
          // confirmed real-zero day into an unresolved one and drops it from
          // the chart's denominator.
          confirmedZeroDays: confirmedZeroDays ?? [],
          today,
          shiftOverrides: shiftOverrides ?? {},
        }
      : null;
  const denomByDay = dailyDenominators(
    allEntries,
    clocks,
    { start: firstDate, end: today },
    today,
    scheduleCtx,
    unpaid ?? [],
  );
  const chartRows = allEntries.map((e) => ({ date: e.date, flagHours: e.flagHours }));

  return (
    <HistoryView
      entries={entries}
      hasMore={hasMore}
      library={library}
      settings={settings}
      today={today}
      tz={tz}
      periodStart={period.start}
      periodEnd={period.end}
      weekStart={weekStart}
      weekEnd={endOfWeek(today, weekStartDay)}
      denomByDay={denomByDay}
      chartRows={chartRows}
      monthStart={startOfMonth(today)}
      monthEnd={endOfMonth(today)}
      weekStartDay={weekStartDay}
      rates={ratesToMap(laborRates)}
      entryIdsWithPhotos={new Set(photoEntryIds)}
      initial={initial}
    />
  );
}
