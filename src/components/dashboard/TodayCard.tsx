"use client";

import { useState, useTransition } from "react";
import { upsertDailyClockHoursAction } from "@/app/actions/daily-clock";
import { computeEfficiency, fmtHours, fmtPct } from "@/lib/stats";
import type { Stats } from "@/lib/stats";

function toText(hours: number): string {
  return hours > 0 ? String(hours) : "";
}

function parseHoursText(text: string): number {
  if (text.trim() === "") return 0;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function TodayCard({
  date,
  stats,
  initialHours,
}: {
  date: string;
  stats: Stats;
  initialHours: number;
}) {
  const [hoursText, setHoursText] = useState<string>(toText(initialHours));
  const [savedHours, setSavedHours] = useState<number>(initialHours);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const parsedHours = parseHoursText(hoursText);
  const efficiency = computeEfficiency(stats.flagHours, parsedHours);
  const dirty = parsedHours !== savedHours;
  const effGood = efficiency !== null && efficiency >= 1.0;
  const effBad  = efficiency !== null && efficiency < 0.85;

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
    <div className="stat featured today-card">
      <div className="stat-label">Today · Flag</div>
      <div className="stat-value tabular">
        {fmtHours(stats.flagHours)}<span className="unit">h</span>
      </div>

      <div style={{ height: 1, background: "var(--line)", margin: "10px 0" }} />

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
        <div>
          <label style={{ display: "block" }}>
            <span className="stat-label" style={{ display: "block", marginBottom: 4 }}>Clocked</span>
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
              className="input mono tabular"
              style={{ width: 72, fontSize: 13 }}
            />
          </label>
          {error && <p style={{ marginTop: 2, fontSize: 11, color: "var(--bad)", margin: 0 }}>{error}</p>}
          {!error && isPending && <p style={{ marginTop: 2, fontSize: 11, color: "var(--fg-3)", margin: 0 }}>Saving…</p>}
        </div>

        <div style={{ textAlign: "right" }}>
          <div className="stat-label" style={{ marginBottom: 4 }}>Efficiency</div>
          <div
            className="tabular"
            style={{
              fontSize: 22,
              fontWeight: 650,
              letterSpacing: "-0.02em",
              color: effGood ? "var(--good)" : effBad ? "var(--bad)" : "var(--fg-1)",
            }}
          >
            {efficiency !== null ? fmtPct(efficiency) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
