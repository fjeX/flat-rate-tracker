"use client";

// Month calendar for the work schedule (schedule-based efficiency plan).
// Visual layer over data that already exists elsewhere: the weekly pattern
// (work_schedules), one-day shift overrides, days off, clocked hours, and
// zero-day resolution.
//
// The page's job is SETTLING the days that are lying to the efficiency number,
// so this component is built around that rather than around browsing a month:
// selection starts on the first unsettled day, a stepper walks the rest, and
// saving one advances to the next. The calendar is the map you fix them on.
//
// The day panel DOCKS to the bottom instead of rendering under six rows of
// grid — on a 390px phone the old layout scrolled the day you just tapped off
// the screen, which made the panel effectively undiscoverable.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { upsertDailyClockHoursAction } from "@/app/actions/daily-clock";
import { addDayOffAction, deleteDayOffAction } from "@/app/actions/gamification";
import {
  clearShiftOverrideAction,
  deleteConfirmedZeroDayAction,
  resolveZeroDayAction,
  setShiftOverrideAction,
} from "@/app/actions/schedule";
import { formatDateLong, formatDateShort } from "@/lib/periods";
import { shiftPaidHours, type ShiftDef } from "@/lib/schedule";
import { fmtHours } from "@/lib/stats";

export type CalendarDay = {
  date: string; // "YYYY-MM-DD"
  inMonth: boolean;
  /** Effective shift after overrides (null = not a workday by pattern). */
  shift: ShiftDef | null;
  hasOverride: boolean;
  /** Covered by a days_off range (id needed to remove it). */
  offRange: { id: string; startDate: string; endDate: string } | null;
  clockedHours: number | null;
  flagHours: number;
  roCount: number;
  confirmedZero: boolean;
  /** Completed scheduled workday with nothing on it — needs a decision. */
  unresolved: boolean;
};

const DOW_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

/**
 * The next day to settle after `from`, or null when that was the last one.
 *
 * Computed from the list as it stands BEFORE the server round-trip: the save
 * has already happened, but `days` won't reflect it until router.refresh()
 * lands, and waiting for that to advance makes the button feel broken.
 */
function nextUnsettled(dates: string[], from: string): string | null {
  const remaining = dates.filter((d) => d !== from);
  if (remaining.length === 0) return null;
  return remaining.find((d) => d > from) ?? remaining[0];
}

// ---------------------------------------------------------------------------
// Day cell
// ---------------------------------------------------------------------------

function DayCell({
  day,
  isToday,
  selected,
  onSelect,
}: {
  day: CalendarDay;
  isToday: boolean;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  const off = day.offRange !== null;
  const scheduled = !off && day.shift !== null;
  const logged = day.clockedHours !== null && day.clockedHours > 0;

  // One line of hours, never four lines of text. At 390px a cell is ~48px wide;
  // everything that used to be stacked in here (flag hours, "empty?", "zero
  // day", "clocked") is now either a dot or lives in the dock.
  const hours = logged
    ? fmtHours(day.clockedHours as number)
    : scheduled
      ? fmtHours(shiftPaidHours(day.shift as ShiftDef))
      : null;

  const cls = [
    "day-cell",
    !day.inMonth && "is-out",
    day.inMonth && (off || !scheduled) && "is-bare",
    isToday && "is-today",
    selected && "is-selected",
  ]
    .filter(Boolean)
    .join(" ");

  const state = day.unresolved
    ? ", needs a decision"
    : off
      ? ", day off"
      : logged
        ? `, ${fmtHours(day.clockedHours as number)} hours logged`
        : scheduled
          ? ", scheduled"
          : "";

  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      aria-label={`${formatDateLong(day.date)}${state}`}
      aria-pressed={selected}
      className={cls}
    >
      <span className="day-num">{dayNumber(day.date)}</span>
      {off ? (
        <span className="day-sub">off</span>
      ) : hours !== null ? (
        <span className={`day-sub${logged ? "" : " is-planned"}`}>{hours}</span>
      ) : null}
      {day.unresolved && <span className="day-flag" aria-hidden="true" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Docked day inspector
// ---------------------------------------------------------------------------

function DayDock({
  day,
  today,
  onSettled,
}: {
  day: CalendarDay;
  today: string;
  onSettled: (date: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState(false);

  const isPastOrToday = day.date <= today;
  const off = day.offRange !== null;
  const baseShift = day.shift ?? { start: "08:00", end: "17:00", breakMin: 60 };

  const [hoursText, setHoursText] = useState(
    day.clockedHours !== null && day.clockedHours > 0 ? String(day.clockedHours) : "",
  );
  const [ovHours, setOvHours] = useState(String(shiftPaidHours(baseShift)));
  const [ovStart, setOvStart] = useState(baseShift.start);
  const [ovLunch, setOvLunch] = useState(String(baseShift.breakMin));

  // `settles` is not "did it succeed" — it is "is this day no longer unsettled".
  // Saving 0 hours CLEARS the entry, which leaves the day exactly as unsettled
  // as it was, so advancing off it would skip a day the tech still owes an
  // answer for.
  function run(fn: () => Promise<unknown>, settles = false) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
        if (settles) onSettled(day.date);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save — try again.");
      }
    });
  }

  const badge = day.unresolved
    ? { cls: "badge-warn", text: "Needs a decision" }
    : off
      ? { cls: "badge-neutral", text: "Day off" }
      : day.clockedHours !== null && day.clockedHours > 0
        ? { cls: "badge-good", text: `${fmtHours(day.clockedHours)}h logged` }
        : day.confirmedZero
          ? { cls: "badge-neutral", text: "Zero day" }
          : day.shift
            ? { cls: "badge-neutral", text: `Scheduled ${fmtHours(shiftPaidHours(day.shift))}h` }
            : { cls: "badge-neutral", text: "Not a workday" };

  return (
    <div className="day-dock">
      <div className="day-dock-head">
        <h3 className="text-sm font-semibold" style={{ color: "var(--fg-0)" }}>
          {formatDateLong(day.date)}
        </h3>
        <span className={`badge ${badge.cls}`}>{badge.text}</span>
      </div>

      {(day.flagHours > 0 || day.roCount > 0) && (
        <p className="mb-3 text-xs" style={{ color: "var(--fg-3)" }}>
          <span className="mono tabular">{fmtHours(day.flagHours)}h</span> flag ·{" "}
          {day.roCount} RO{day.roCount === 1 ? "" : "s"}
        </p>
      )}

      {isPastOrToday && (
        <div className="mb-3">
          <label className="field-label" htmlFor="day-hours">
            Actual hours worked
          </label>
          <div className="flex items-center gap-2">
            <input
              id="day-hours"
              type="number"
              min={0}
              max={24}
              step={0.1}
              value={hoursText}
              placeholder="—"
              onChange={(e) => setHoursText(e.target.value)}
              className="input mono tabular"
              style={{ width: 96, flex: "0 0 auto" }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={pending || hoursText.trim() === ""}
              onClick={() =>
                run(
                  () => upsertDailyClockHoursAction(day.date, Number(hoursText) || 0),
                  Number(hoursText) > 0,
                )
              }
            >
              Save
            </button>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--fg-3)" }}>
            Stayed late? Left early? This is the truth — it beats the schedule. 0
            clears it.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {off ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending}
            onClick={() => run(() => deleteDayOffAction(day.offRange!.id))}
          >
            {day.offRange!.startDate !== day.offRange!.endDate
              ? `Remove ${formatDateShort(day.offRange!.startDate)}–${formatDateShort(day.offRange!.endDate)} range`
              : "Remove day off"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending}
            onClick={() => run(() => addDayOffAction(day.date, day.date), true)}
          >
            Day off
          </button>
        )}

        {day.confirmedZero ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending}
            onClick={() => run(() => deleteConfirmedZeroDayAction(day.date))}
          >
            Undo zero day
          </button>
        ) : (
          day.unresolved && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() => run(() => resolveZeroDayAction(day.date, "worked-zero"), true)}
            >
              Worked, zero flag
            </button>
          )
        )}

        {!off && (
          <button
            type="button"
            className="btn btn-sm"
            aria-expanded={editingShift}
            onClick={() => setEditingShift((v) => !v)}
          >
            {day.hasOverride ? "Edit shift" : "Change shift"}
          </button>
        )}
      </div>

      {/* A plan, not a fact — kept behind a press so the dock stays short
          enough to sit above the thumb bar on a phone. */}
      {!off && editingShift && (
        <div
          className="mt-3 pt-3"
          style={{ borderTop: "1px dashed var(--line-soft)" }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--fg-2)" }}>
              <input
                type="number"
                min={0.5}
                max={16}
                step={0.5}
                value={ovHours}
                onChange={(e) => setOvHours(e.target.value)}
                className="input mono tabular"
                style={{ width: 72 }}
                aria-label="Override paid hours"
              />
              hrs
            </label>
            <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--fg-2)" }}>
              starts
              <input
                type="time"
                value={ovStart}
                onChange={(e) => setOvStart(e.target.value)}
                className="input mono tabular"
                style={{ width: 116 }}
                aria-label="Override shift start"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--fg-2)" }}>
              lunch
              <input
                type="number"
                min={0}
                max={240}
                step={15}
                value={ovLunch}
                onChange={(e) => setOvLunch(e.target.value)}
                className="input mono tabular"
                style={{ width: 68 }}
                aria-label="Override lunch minutes"
              />
              min
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() =>
                run(() =>
                  setShiftOverrideAction(day.date, {
                    paidHours: Number(ovHours),
                    start: ovStart,
                    breakMin: Math.max(0, Math.floor(Number(ovLunch) || 0)),
                  }),
                )
              }
            >
              Save shift
            </button>
            {day.hasOverride && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending}
                onClick={() => run(() => clearShiftOverrideAction(day.date))}
              >
                Reset to pattern
              </button>
            )}
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--fg-3)" }}>
            Still an estimate — for hours you actually worked, use “actual hours”
            above.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      {pending && (
        <p className="mt-2 text-xs" style={{ color: "var(--fg-3)" }} aria-live="polite">
          Saving…
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export function ScheduleCalendar({
  days,
  today,
  weekStartDay,
}: {
  days: CalendarDay[]; // 42 cells, grid order
  today: string;
  weekStartDay: 0 | 1;
}) {
  // Only days in the displayed month: stepping into a neighbouring month's
  // leading cells would settle a day the header says you aren't looking at.
  const unsettled = useMemo(
    () => days.filter((d) => d.inMonth && d.unresolved).map((d) => d.date),
    [days],
  );

  const [selected, setSelected] = useState<string | null>(
    () =>
      unsettled[0] ??
      (days.some((d) => d.date === today && d.inMonth) ? today : null),
  );

  const headers = useMemo(() => {
    const base = [...DOW_SUN];
    if (weekStartDay === 1) base.push(base.shift()!);
    return base;
  }, [weekStartDay]);

  const selectedDay = days.find((d) => d.date === selected) ?? null;
  const stepIndex = selected === null ? -1 : unsettled.indexOf(selected);

  function step(delta: -1 | 1) {
    if (unsettled.length === 0) return;
    const from = stepIndex === -1 ? (delta === 1 ? -1 : 0) : stepIndex;
    const next = (from + delta + unsettled.length) % unsettled.length;
    setSelected(unsettled[next]);
  }

  return (
    <div>
      {unsettled.length > 0 && (
        <div className="card-inset settle-strip">
          <span className="settle-strip-label">
            <TriangleAlert size={16} style={{ color: "var(--warn)", flex: "none" }} />
            <span>
              {unsettled.length} unsettled
            </span>
          </span>
          <span className="settle-strip-nav">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous unsettled day"
              onClick={() => step(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="settle-count">
              {stepIndex === -1 ? `${unsettled.length}` : `${stepIndex + 1} of ${unsettled.length}`}
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next unsettled day"
              onClick={() => step(1)}
            >
              <ChevronRight size={16} />
            </button>
          </span>
        </div>
      )}

      {/* Above the grid, not below it. The dock is sticky, so anything sitting
          between the grid and the dock's resting position is hidden behind it
          at the top of the page — which is exactly where a first-time reader
          needs the key to the amber dot. */}
      <div className="day-legend" style={{ margin: "0 0 10px" }}>
        <span>
          <i className="day-flag" style={{ display: "inline-block" }} aria-hidden="true" />
          Needs a decision
        </span>
        <span>
          <i style={{ color: "var(--fg-3)", opacity: 0.55 }}>8.0</i>Scheduled
        </span>
        <span>
          <i style={{ color: "var(--fg-3)" }}>9.2</i>Hours you logged
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 4,
          marginBottom: 4,
        }}
      >
        {headers.map((h) => (
          <div key={h} className="field-label" style={{ textAlign: "center", marginBottom: 0 }}>
            <span aria-hidden="true">{h[0]}</span>
            <span className="sr-only">{h}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 4,
        }}
      >
        {days.map((day) => (
          <DayCell
            key={day.date}
            day={day}
            isToday={day.date === today}
            selected={day.date === selected}
            onSelect={(d) => setSelected(d === selected ? null : d)}
          />
        ))}
      </div>

      {selectedDay && (
        <DayDock
          key={selectedDay.date}
          day={selectedDay}
          today={today}
          onSettled={(date) => {
            const next = nextUnsettled(unsettled, date);
            if (next) setSelected(next);
          }}
        />
      )}
    </div>
  );
}
