"use client";

import { useGuestStore } from "@/lib/guest/context";
import { useClientToday } from "@/lib/use-client-today";
import { HistoryView } from "@/components/history/HistoryView";
import { GuestRoDetailModal } from "@/components/guest/GuestRoDetailModal";
import { parseHistoryParams } from "@/lib/history-url";
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
  // Same URL contract as the signed-in page. Nothing renders until `today` is
  // known, so this only ever runs in the browser and cannot mismatch a server
  // render; without it the view would write its defaults over a shared link.
  const params: Record<string, string | string[]> = {};
  new URLSearchParams(window.location.search).forEach((v, k) => {
    const prev = params[k];
    params[k] = prev === undefined ? v : [...(Array.isArray(prev) ? prev : [prev]), v];
  });
  const initial = parseHistoryParams(params, { from: period.start, to: today });

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
      initial={initial}
      renderDetail={(entry, onClose) => (
        <GuestRoDetailModal entry={entry} onClose={onClose} />
      )}
    />
  );
}
