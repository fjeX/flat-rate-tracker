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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // If no timezone cookie yet, pre-fill with browser's detected timezone
    if (!initialTimezone) {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [initialTimezone]);

  function save(next: string) {
    setSaved(false);
    setError(null);
    setTz(next);
    startTransition(async () => {
      try {
        await setTimezoneAction(next);
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save — check your connection and try again.");
      }
    });
  }

  const isInList = TIMEZONES.some((t) => t.value === tz);

  return (
    <section className="card padded-lg">
      <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--fg-0)" }}>Timezone</h2>
      <p className="mb-4 text-sm" style={{ color: "var(--fg-2)" }}>
        Sets what &ldquo;today&rdquo; means for your dashboard. If your ROs disappear partway through your shift, set this to your local timezone.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="field-label" htmlFor="timezone-select">
          Timezone
        </label>
        <select
          id="timezone-select"
          value={isInList ? tz : ""}
          onChange={(e) => save(e.target.value)}
          disabled={pending}
          aria-describedby={error ? "timezone-error" : undefined}
          className="input flex-1"
          style={{ minWidth: 200, padding: "6px 12px" }}
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
          className="btn btn-sm"
        >
          Auto-detect
        </button>
      </div>

      {error && (
        <p id="timezone-error" role="alert" className="mt-2 text-xs" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}

      {tz && (
        <p className="mt-2 text-xs" style={{ color: "var(--fg-3)" }}>
          Current: {tz}
          {saved && <span className="ml-2" style={{ color: "var(--good)" }}>✓ Saved</span>}
        </p>
      )}
    </section>
  );
}
