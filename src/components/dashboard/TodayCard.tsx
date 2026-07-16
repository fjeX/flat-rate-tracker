"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { upsertDailyClockHoursAction } from "@/app/actions/daily-clock";
import { minutesNowInTz, shiftPace } from "@/lib/pace";
import type { ShiftDef } from "@/lib/schedule";
import { computeEfficiency, fmtHours, fmtPct } from "@/lib/stats";
import type { Stats } from "@/lib/stats";
import type { OpCode } from "@/lib/types";
import { QuickAddModal } from "./QuickAddModal";
import { RollingNumber } from "@/components/ui/RollingNumber";

const QUICK_ADD_KEY = "frt:quick_add_enabled";

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
  library,
  todayShift = null,
  timezone = "",
}: {
  date: string;
  stats: Stats;
  initialHours: number;
  library: OpCode[];
  /** Today's scheduled shift — enables the live pace gauge when no clocked
   * hours are entered yet. */
  todayShift?: ShiftDef | null;
  timezone?: string;
}) {
  const [hoursText, setHoursText] = useState<string>(toText(initialHours));
  const [savedHours, setSavedHours] = useState<number>(initialHours);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [quickAddEnabled, setQuickAddEnabled] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // Set after mount and ticked once a minute — the server can't know the
  // client's clock, so pace renders "—" on first paint instead of mismatching.
  const [nowMin, setNowMin] = useState<number | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(QUICK_ADD_KEY);
    if (stored === "false") setQuickAddEnabled(false);
  }, []);

  useEffect(() => {
    if (!todayShift) return;
    const tick = () => setNowMin(minutesNowInTz(timezone));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [todayShift, timezone]);

  const parsedHours = parseHoursText(hoursText);
  const efficiency = computeEfficiency(stats.flagHours, parsedHours);
  const dirty = parsedHours !== savedHours;

  // Clocked hours are ground truth; the scheduled shift's live pace fills in
  // until they're entered (the trip-MPG vs instantaneous-MPG split).
  const pace =
    efficiency === null && todayShift && nowMin !== null
      ? shiftPace(todayShift, stats.flagHours, nowMin)
      : null;
  const shownPct = efficiency ?? pace?.pacePct ?? null;
  const shownLabel = efficiency !== null ? "Efficiency" : pace ? "On Pace" : "Efficiency";
  const paceCaption =
    pace === null
      ? null
      : pace.status === "before"
        ? `shift starts ${todayShift!.start}`
        : pace.status === "early"
          ? "shift just started"
          : pace.status === "done"
            ? "shift over"
            : `${fmtHours(pace.elapsedPaidHours)}h in`;
  const effGood = shownPct !== null && shownPct >= 100;
  const effBad  = shownPct !== null && shownPct < 85;

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

  const showTrigger = quickAddEnabled && library.length > 0;

  return (
    <>
      <div className="stat featured today-card">
        {/* Top section — tappable when quick add is on */}
        {showTrigger ? (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            style={{
              display: "block",
              width: "100%",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              padding: 0,
            }}
            title="Quick add RO"
          >
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div className="stat-label">Today · Flag</div>
                <div className="stat-value tabular">
                  <RollingNumber value={stats.flagHours} decimals={1} /><span className="unit">h</span>
                </div>
              </div>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                color: "var(--brand)",
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                flexShrink: 0,
              }}>
                <Plus size={18} />
                <span>Quick Add RO</span>
              </div>
            </div>
          </button>
        ) : (
          <>
            <div className="stat-label">Today · Flag</div>
            <div className="stat-value tabular">
              <RollingNumber value={stats.flagHours} decimals={1} /><span className="unit">h</span>
            </div>
          </>
        )}

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
            <div className="stat-label" style={{ marginBottom: 4 }}>{shownLabel}</div>
            <div
              className="tabular"
              style={{
                fontSize: 22,
                fontWeight: 650,
                letterSpacing: "-0.02em",
                color: effGood ? "var(--good)" : effBad ? "var(--bad)" : "var(--fg-1)",
              }}
            >
              {shownPct !== null ? fmtPct(shownPct) : "—"}
            </div>
            {efficiency === null && paceCaption && (
              <div style={{ marginTop: 2, fontSize: 11, color: "var(--fg-3)" }}>
                {paceCaption}
              </div>
            )}
          </div>
        </div>
      </div>

      <QuickAddModal
        library={library}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
