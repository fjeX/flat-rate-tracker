"use client";

import { useGuestStore } from "@/lib/guest/context";
import { HistoryView } from "@/components/history/HistoryView";
import { GuestRoDetailModal } from "@/components/guest/GuestRoDetailModal";
import {
  isoDate,
  getPeriodForDate,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from "@/lib/periods";

export default function GuestHistoryPage() {
  const { entries, opCodes, settings } = useGuestStore();
  const today = isoDate();
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
