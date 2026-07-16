"use client";

import { useState, useTransition } from "react";
import { upsertDailyClockHoursAction } from "@/app/actions/daily-clock";
import { computeEfficiency, fmtPct } from "@/lib/stats";

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
  const effGood = efficiency !== null && efficiency >= 100;
  const effBad  = efficiency !== null && efficiency < 85;

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
    <div className="card padded" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
      <div style={{ flex: 1 }}>
        <label style={{ display: "block" }}>
          <span className="field-label">Today&apos;s clocked hours</span>
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
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "clocked-hours-error" : undefined}
            className="input mono tabular"
            style={{ width: 120, marginTop: 6 }}
          />
        </label>
        {error && <p id="clocked-hours-error" role="alert" style={{ marginTop: 4, fontSize: 12, color: "var(--bad)" }}>{error}</p>}
        {!error && isPending && (
          <p style={{ marginTop: 4, fontSize: 12, color: "var(--fg-3)" }}>Saving…</p>
        )}
        {!error && !isPending && dirty && (
          <p style={{ marginTop: 4, fontSize: 12, color: "var(--fg-3)" }}>Enter or click away to save</p>
        )}
      </div>

      <div style={{ textAlign: "right" }}>
        <div className="field-label">Efficiency</div>
        <div
          className="tabular"
          style={{
            marginTop: 4,
            fontSize: 28,
            fontWeight: 650,
            letterSpacing: "-0.02em",
            color: effGood ? "var(--good)" : effBad ? "var(--bad)" : "var(--fg-1)",
          }}
        >
          {efficiency !== null ? fmtPct(efficiency) : "—"}
        </div>
        <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--fg-3)" }}>
          {todayFlagHours.toFixed(1)}h flag
        </div>
      </div>
    </div>
  );
}
