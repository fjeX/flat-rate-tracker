"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTimezoneAction } from "@/app/actions/settings";

const TIMEZONES = [
  { label: "Eastern (ET) — New York", value: "America/New_York" },
  { label: "Central (CT) — Chicago", value: "America/Chicago" },
  { label: "Mountain (MT) — Denver", value: "America/Denver" },
  { label: "Arizona (MST, no DST)", value: "America/Phoenix" },
  { label: "Pacific (PT) — Los Angeles", value: "America/Los_Angeles" },
  { label: "Alaska (AKT)", value: "America/Anchorage" },
  { label: "Hawaii (HT)", value: "Pacific/Honolulu" },
];

export function TimezoneCard({ initialTimezone }: { initialTimezone: string }) {
  const router = useRouter();
  const [tz, setTz] = useState(initialTimezone);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // If no timezone cookie yet, pre-fill with browser's detected timezone
    if (!initialTimezone) {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [initialTimezone]);

  function save(next: string) {
    setSaved(false);
    setTz(next);
    startTransition(async () => {
      await setTimezoneAction(next);
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    });
  }

  const isInList = TIMEZONES.some((t) => t.value === tz);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-1 text-base font-semibold text-zinc-100">Timezone</h2>
      <p className="mb-4 text-sm text-zinc-400">
        Sets what &ldquo;today&rdquo; means for your dashboard. If your ROs disappear partway through your shift, set this to your local timezone.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={isInList ? tz : ""}
          onChange={(e) => save(e.target.value)}
          disabled={pending}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-orange-500 focus:outline-none disabled:opacity-50"
          style={{ minWidth: 200 }}
        >
          {!isInList && tz && (
            <option value="">{tz}</option>
          )}
          {TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={pending}
          onClick={() => save(Intl.DateTimeFormat().resolvedOptions().timeZone)}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-50"
        >
          Auto-detect
        </button>
      </div>

      {tz && (
        <p className="mt-2 text-xs text-zinc-500">
          Current: {tz}
          {saved && <span className="ml-2 text-green-400">✓ Saved</span>}
        </p>
      )}
    </section>
  );
}
