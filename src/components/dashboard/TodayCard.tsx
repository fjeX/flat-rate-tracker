"use client";

import { useEffect, useState, useTransition } from "react";
import { upsertDailyClockHoursAction } from "@/app/actions/daily-clock";
import { minutesNowInTz, shiftPace } from "@/lib/pace";
import { shiftPaidHours, type ShiftDef } from "@/lib/schedule";
import { computeEfficiency, fmtHours, fmtPct } from "@/lib/stats";
import type { Stats } from "@/lib/stats";
import type { OpCode } from "@/lib/types";
import { QuickAddModal } from "./QuickAddModal";
import { useQuickAddEnabled } from "@/lib/quick-add-pref";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { Button } from "@/components/ui/Button";
import { Head, HeadCell, HeadCells } from "@/components/ui/Card";
import { withPt } from "@/components/ui/Figure";
import { actionErrorMessage } from "@/lib/action-error";
import { DashIcon } from "./DashIcon";
import { Zone } from "@/components/ui/Zone";
import { StatusField } from "@/components/ui/StatusField";

function toText(hours: number): string {
  return hours > 0 ? String(hours) : "";
}

function parseHoursText(text: string): number {
  if (text.trim() === "") return 0;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * The Today zone: the headline panel (flag hours, then efficiency or live
 * pace), the Clocked field, and the Quick Add RO button.
 */
export function TodayCard({
  date,
  stats,
  initialHours,
  library,
  todayShift = null,
  timezone = "",
  trackRoTime = false,
}: {
  date: string;
  stats: Stats;
  initialHours: number;
  library: OpCode[];
  /** Today's scheduled shift — enables the live pace gauge when no clocked
   * hours are entered yet. */
  todayShift?: ShiftDef | null;
  timezone?: string;
  /** Passed straight through to Quick Add — this card doesn't use it itself. */
  trackRoTime?: boolean;
}) {
  const [hoursText, setHoursText] = useState<string>(toText(initialHours));
  const [savedHours, setSavedHours] = useState<number>(initialHours);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // One store shared with Settings' QuickAddCard — see lib/quick-add-pref.
  const quickAddEnabled = useQuickAddEnabled();
  const [modalOpen, setModalOpen] = useState(false);

  // Set after mount and ticked once a minute — the server can't know the
  // client's clock, so pace renders "—" on first paint instead of mismatching.
  const [nowMin, setNowMin] = useState<number | null>(null);

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
  const effBad = shownPct !== null && shownPct < 85;

  function commit() {
    if (!dirty) return;
    setError(null);
    startTransition(async () => {
      try {
        await upsertDailyClockHoursAction(date, parsedHours);
        setSavedHours(parsedHours);
      } catch (e) {
        setError(actionErrorMessage(e, "Failed to save."));
      }
    });
  }

  const showTrigger = quickAddEnabled && library.length > 0;

  return (
    <>
      <Zone id="z-today" name="Today" className="today-card">
        <Head>
          <HeadCells>
            <HeadCell
              className="today-flag"
              label="Today · Flag"
              value={<RollingNumber value={fmtHours(stats.flagHours)} />}
              unit="h"
              // Hours on open tickets today — beside the flag, never in it
              // (Open Tickets, decision 7). A 0.0h flag day with 8.0h here is a
              // worked day whose pay is still coming.
              sub={
                stats.openTicketHours > 0 ? (
                  <span data-testid="open-ticket-line">
                    <span className="num">{withPt(fmtHours(stats.openTicketHours))}h</span> on{" "}
                    <span className="num">{stats.openTicketCount}</span> open ticket
                    {stats.openTicketCount === 1 ? "" : "s"}
                  </span>
                ) : undefined
              }
            />
            <HeadCell
              secondary
              label={shownLabel}
              value={
                <span className={effGood ? "is-good" : effBad ? "is-bad" : undefined}>
                  {shownPct !== null ? withPt(fmtPct(shownPct)) : "—"}
                </span>
              }
              sub={efficiency === null && paceCaption ? paceCaption : undefined}
            />
          </HeadCells>
        </Head>

        <div className={`today-tools${showTrigger ? "" : " is-solo"}`}>
          <label className="field">
            <span className="field-label">Clocked</span>
            <span className="clock-field">
              <input
                type="number"
                min={0}
                max={24}
                step={0.1}
                inputMode="decimal"
                value={hoursText}
                onChange={(e) => setHoursText(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                // Placeholder = today's scheduled paid hours: a hint at what
                // the day is planned to be, never treated as entered data.
                placeholder={todayShift ? fmtHours(shiftPaidHours(todayShift)) : "0"}
                aria-label="Clocked hours today"
                className="input num"
              />
              <span className="unit" aria-hidden="true">
                h
              </span>
            </span>
          </label>
          {showTrigger && (
            <Button
              variant="go"
              className="btn-field"
              onClick={() => setModalOpen(true)}
              title="Quick add RO"
            >
              <DashIcon name="plus" />
              Quick Add RO
            </Button>
          )}
        </div>
        {error && (
          <StatusField tag="Fix" inset role="alert">
            <p>{error}</p>
          </StatusField>
        )}
        {!error && isPending && <p className="fine today-saving">Saving…</p>}
      </Zone>

      {/* The key changes on open, so React discards the previous instance and
          every useState initialiser runs fresh — replacing eleven by-hand
          resets inside the modal. Safe to also remount on close: Modal renders
          null when closed, so there is no exit animation to interrupt. */}
      <QuickAddModal
        key={modalOpen ? "open" : "closed"}
        library={library}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        trackRoTime={trackRoTime}
        timeZone={timezone}
      />
    </>
  );
}
