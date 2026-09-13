"use client";

import { useGuestStore } from "@/lib/guest/context";
import { useClientToday } from "@/lib/use-client-today";
import { HistoryView } from "@/components/history/HistoryView";
import { GuestRoDetailModal } from "@/components/guest/GuestRoDetailModal";
import {
  getPeriodForDate,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from "@/lib/periods";

export default function GuestHistoryPage() {
  const { entries, opCodes, settings } = useGuestStore();
  // Null until the browser has reported its own date — see the hook. Every
  // hook above this line stays above it; nothing below may be one.
  const today = useClientToday();
  if (!today) return null;
  const period = getPeriodForDate(today, settings.splitDay, settings.periodOverrides);

  return (
    <HistoryView
      entries={entries}
      library={opCodes}
      settings={settings}
      today={today}
      periodStart={period.start}
      periodEnd={period.end}
      weekStart={startOfWeek(today)}
      weekEnd={endOfWeek(today)}
      monthStart={startOfMonth(today)}
      monthEnd={endOfMonth(today)}
      weekStartDay={0}
      renderDetail={(entry, onClose) => (
        <GuestRoDetailModal entry={entry} onClose={onClose} />
      )}
    />
  );
}
