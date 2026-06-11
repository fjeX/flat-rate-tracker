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
import { HistoryView } from "@/components/history/HistoryView";

export default async function HistoryPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const weekStartDay = (Number(cookieStore.get("frt_week_start")?.value ?? "0") as 0 | 1);

  const tz = cookieStore.get("frt_timezone")?.value;

  const PAGE_SIZE = 100;
  const [entries, library, settings] = await Promise.all([
    db.listEntries(supabase, { limit: PAGE_SIZE }),
    db.listOpCodes(supabase),
    db.getSettings(supabase),
  ]);
  const hasMore = entries.length === PAGE_SIZE;

  const today = tz ? isoDateInTz(tz) : isoDate();
  const period = getPeriodForDate(today, settings.splitDay, settings.periodOverrides);

  return (
    <HistoryView
      entries={entries}
      hasMore={hasMore}
      library={library}
      settings={settings}
      today={today}
      periodStart={period.start}
      periodEnd={period.end}
      weekStart={startOfWeek(today, weekStartDay)}
      weekEnd={endOfWeek(today, weekStartDay)}
      monthStart={startOfMonth(today)}
      monthEnd={endOfMonth(today)}
      weekStartDay={weekStartDay}
    />
  );
}
