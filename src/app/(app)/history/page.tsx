import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import {
  isoDate,
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

  const [entries, library, settings] = await Promise.all([
    db.listEntries(supabase),
    db.listOpCodes(supabase),
    db.getSettings(supabase),
  ]);

  const today = isoDate();
  const period = getPeriodForDate(today, settings.splitDay, settings.periodOverrides);

  return (
    <HistoryView
      entries={entries}
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
