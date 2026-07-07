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
import { EmptyState } from "@/components/ui/EmptyState";
import { EntranceGrid } from "@/components/ui/EntranceGrid";
import { ClipboardList } from "lucide-react";

const NO_CLOCKS: DailyClock[] = [];

export default function GuestDashboard() {
  const { entries, opCodes, settings } = useGuestStore();
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
    <main className="app-main" style={{ maxWidth: 1080 }}>
      <h1 className="sr-only">Dashboard</h1>
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wide text-[var(--fg-3)]">Pay period</div>
        <div className="text-lg font-semibold">{formatPeriodLabel(period)}</div>
      </div>

      <EntranceGrid className="stat-grid mb-6">
        <StatCard label="Today" stats={statsToday} />
        <StatCard label="This Week" stats={statsWeek} />
        <StatCard label="Pay Period" stats={statsPeriod} highlighted />
        <StatCard label="This Month" stats={statsMonth} />
      </EntranceGrid>

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--fg-2)]">Recent ROs</h2>
        <RoList
          entries={entries.slice(0, 5)}
          library={opCodes}
          onRowClick={setDetailEntry}
          emptyState={
            <div className="card flush">
              <EmptyState
                icon={<ClipboardList size={22} />}
                title="Nothing on the books"
                description="Log your first RO and the flag hours start counting."
                action={
                  <Link href="/guest/log" className="btn btn-primary btn-sm">
                    Log your first RO →
                  </Link>
                }
              />
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
