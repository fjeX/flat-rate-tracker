import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import {
  endOfMonth,
  endOfWeek,
  formatPeriodLabel,
  getPeriodForDate,
  isoDate,
  startOfMonth,
  startOfWeek,
} from "@/lib/periods";
import { aggregateStats } from "@/lib/stats";
import { ClockedHoursInput } from "@/components/dashboard/ClockedHoursInput";
import { StatCard } from "@/components/dashboard/StatCard";
import { RecentRoList } from "@/components/dashboard/RecentRoList";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Ranges we care about today. We fetch once over the widest window
  // (start-of-month → today) and aggregate client-side. Cheap for personal
  // data volumes and avoids multiple roundtrips.
  const today = isoDate();
  const settings = await db.getSettings(supabase);
  const period = getPeriodForDate(
    today,
    settings.splitDay,
    settings.periodOverrides,
  );
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);

  // Widest range: the earliest of {monthStart, periodStart, weekStart}.
  const fetchFrom = [monthStart, period.start, weekStart].sort()[0];

  const [entries, clocks] = await Promise.all([
    db.listEntries(supabase, { from: fetchFrom, to: monthEnd }),
    db.listDailyClocks(supabase, { from: fetchFrom, to: monthEnd }),
  ]);

  const statsToday = aggregateStats(entries, clocks, { start: today, end: today });
  const statsWeek = aggregateStats(entries, clocks, {
    start: weekStart,
    end: weekEnd,
  });
  const statsPeriod = aggregateStats(entries, clocks, {
    start: period.start,
    end: period.end,
  });
  const statsMonth = aggregateStats(entries, clocks, {
    start: monthStart,
    end: monthEnd,
  });

  const todaysClock = clocks.find((c) => c.date === today);
  const recentEntries = entries.slice(0, 5);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Pay period
          </div>
          <div className="text-lg font-semibold">
            {formatPeriodLabel(period)}
          </div>
        </div>
      </div>

      <ClockedHoursInput
        date={today}
        initialHours={todaysClock?.hours ?? 0}
        todayFlagHours={statsToday.flagHours}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Today" stats={statsToday} />
        <StatCard label="This Week" stats={statsWeek} />
        <StatCard label="Pay Period" stats={statsPeriod} highlighted />
        <StatCard label="This Month" stats={statsMonth} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">Recent ROs</h2>
        <RecentRoList entries={recentEntries} />
      </section>
    </main>
  );
}
