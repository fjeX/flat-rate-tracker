"use client";

import { useState } from "react";
import Link from "next/link";
import { useGuestStore } from "@/lib/guest/context";
import {
  isoDate,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  getPeriodForDate,
  formatPeriodLabel,
} from "@/lib/periods";
import { aggregateStats } from "@/lib/stats";
import type { DailyClock, Entry } from "@/lib/types";
import { StatCard } from "@/components/dashboard/StatCard";
import { RoList } from "@/components/ro/RoList";
import { GuestRoDetailModal } from "@/components/guest/GuestRoDetailModal";

const NO_CLOCKS: DailyClock[] = [];

export default function GuestDashboard() {
  const { entries, settings } = useGuestStore();
  const [detailEntry, setDetailEntry] = useState<Entry | null>(null);
  const today = isoDate();
  const period = getPeriodForDate(today, settings.splitDay, settings.periodOverrides);
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  const statsToday = aggregateStats(entries, NO_CLOCKS, { start: today, end: today });
  const statsWeek = aggregateStats(entries, NO_CLOCKS, { start: weekStart, end: weekEnd });
  const statsPeriod = aggregateStats(entries, NO_CLOCKS, { start: period.start, end: period.end });
  const statsMonth = aggregateStats(entries, NO_CLOCKS, { start: monthStart, end: monthEnd });

  return (
    <>
    <main className="mx-auto max-w-5xl space-y-6 p-4 pb-16">
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500">Pay period</div>
        <div className="text-lg font-semibold">{formatPeriodLabel(period)}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Today" stats={statsToday} />
        <StatCard label="This Week" stats={statsWeek} />
        <StatCard label="Pay Period" stats={statsPeriod} highlighted />
        <StatCard label="This Month" stats={statsMonth} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">Recent ROs</h2>
        <RoList
          entries={entries.slice(0, 5)}
          onRowClick={setDetailEntry}
          emptyState={
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
              <p className="text-sm text-zinc-400">No ROs logged yet.</p>
              <Link
                href="/guest/log"
                className="mt-2 inline-block text-sm font-medium text-orange-400 hover:text-orange-300"
              >
                Log your first RO →
              </Link>
            </div>
          }
        />
      </section>
    </main>
    {detailEntry && (
      <GuestRoDetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} />
    )}
    </>
  );
}
