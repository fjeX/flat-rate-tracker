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
import { HistoryView } from "@/components/history/HistoryView";

export default async function HistoryPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const weekStartDay = (Number(cookieStore.get("frt_week_start")?.value ?? "0") as 0 | 1);

  const tz = cookieStore.get("frt_timezone")?.value;
  const today = tz ? isoDateInTz(tz) : isoDate();
  const weekStart = startOfWeek(today, weekStartDay);

  const PAGE_SIZE = 100;
  const [entries, library, settings, laborRates, photoEntryIds, clocks, schedules, daysOff, shiftOverrides] = await Promise.all([
    db.listEntries(supabase, { limit: PAGE_SIZE }),
    db.listOpCodes(supabase),
    db.getSettings(supabase),
    db.listLaborRates(supabase),
    db.listEntryIdsWithPhotos(supabase),
    db.listDailyClocks(supabase, { from: weekStart, to: today }),
    // Null pre-migration — the chart just skips the efficiency readout.
    db.listWorkSchedulesSafe(supabase),
    db.listDaysOffSafe(supabase),
    db.listShiftOverridesSafe(supabase),
  ]);
  const hasMore = entries.length === PAGE_SIZE;

  const period = getPeriodForDate(today, settings.splitDay, settings.periodOverrides);

  // Day-level efficiency for the Today/Week chart hover readouts.
  const scheduleCtx =
    schedules !== null && schedules.length > 0
      ? {
          schedules,
          daysOff: daysOff ?? [],
          confirmedZeroDays: [],
          today,
          shiftOverrides: shiftOverrides ?? {},
        }
      : null;
  const denomByDay = dailyDenominators(
    clocks,
    { start: weekStart, end: today },
    today,
    scheduleCtx,
  );

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
      monthStart={startOfMonth(today)}
      monthEnd={endOfMonth(today)}
      weekStartDay={weekStartDay}
      rates={ratesToMap(laborRates)}
      entryIdsWithPhotos={new Set(photoEntryIds)}
    />
  );
}
