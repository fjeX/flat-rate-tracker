"use client";

import { useState, useTransition } from "react";
import { upsertDailyClockHoursAction } from "@/app/actions/daily-clock";
import { computeEfficiency, fmtPct } from "@/lib/stats";

// Input state is a raw string so the field can be genuinely empty (not "0").
// Parsing happens at commit time + for the live efficiency calc.
function toText(hours: number): string {
  return hours > 0 ? String(hours) : "";
}

function parseHoursText(text: string): number {
  if (text.trim() === "") return 0;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function ClockedHoursInput({
  date,
  initialHours,
  todayFlagHours,
}: {
  date: string;
  initialHours: number;
  todayFlagHours: number;
}) {
  const [hoursText, setHoursText] = useState<string>(toText(initialHours));
  const [savedHours, setSavedHours] = useState<number>(initialHours);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const parsedHours = parseHoursText(hoursText);
  const efficiency = computeEfficiency(todayFlagHours, parsedHours);
  const dirty = parsedHours !== savedHours;

  function commit() {
    if (!dirty) return;
    setError(null);
    startTransition(async () => {
      try {
        await upsertDailyClockHoursAction(date, parsedHours);
        setSavedHours(parsedHours);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  }

  return (
    <section className="rounded-xl border border-orange-900/60 bg-gradient-to-br from-orange-950/60 to-red-950/40 p-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex-1">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-orange-300/80">
              Today&apos;s clocked hours
            </span>
            <input
              type="number"
              min={0}
              max={24}
              step={0.1}
              value={hoursText}
              onChange={(e) => setHoursText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="0"
              className="mt-1 w-28 rounded-md border border-orange-900/60 bg-zinc-950/80 px-3 py-2 text-lg font-semibold text-zinc-100 placeholder-zinc-600 focus:border-orange-500 focus:outline-none"
            />
          </label>
          {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
          {!error && isPending && (
            <p className="mt-1 text-xs text-orange-300/80">Saving…</p>
          )}
          {!error && !isPending && dirty && (
            <p className="mt-1 text-xs text-orange-300/80">
              Press enter or click away to save
            </p>
          )}
        </div>

        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-orange-300/80">
            Efficiency
          </div>
          <div className="mt-1 text-3xl font-semibold text-orange-300">
            {fmtPct(efficiency)}
          </div>
          <div className="mt-0.5 text-xs text-zinc-400">
            {todayFlagHours.toFixed(1)}h flag
          </div>
        </div>
      </div>
    </section>
  );
}
