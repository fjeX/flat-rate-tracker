"use client";

import { useGuestStore } from "@/lib/guest/context";
import { HistoryView } from "@/components/history/HistoryView";
import { isoDate } from "@/lib/periods";

export default function GuestHistoryPage() {
  const { entries, settings } = useGuestStore();
  return (
    <HistoryView
      entries={entries}
      library={[]}
      settings={settings}
      today={isoDate()}
    />
  );
}
