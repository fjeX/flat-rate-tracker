"use client";

// Month calendar for the work schedule (schedule-based efficiency plan).
// Visual layer over data that already exists elsewhere: the weekly pattern
// (work_schedules), one-day shift overrides, days off, clocked hours, and
// zero-day resolution. Clicking a day opens a panel with the same actions
// the dashboard/settings offer — this is the discoverable front door.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  const hoursLabel =
    day.clockedHours !== null && day.clockedHours > 0
      ? `${fmtHours(day.clockedHours)}h`
      : scheduled
        ? `${fmtHours(shiftPaidHours(day.shift!))}h`
        : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      aria-label={`${formatDateLong(day.date)}${off ? ", day off" : scheduled ? ", scheduled" : ""}`}
      aria-pressed={selected}
      className="tabular"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        minHeight: 62,
        padding: "6px 7px",
        textAlign: "left",
        cursor: "pointer",
        background: selected
          ? "var(--brand-bg)"
          : off
            ? "transparent"
            : scheduled
              ? "var(--card, transparent)"
              : "transparent",
        border: "1px solid",
        borderColor: selected
          ? "var(--brand)"
          : isToday
            ? "var(--fg-2)"
            : day.unresolved
              ? "var(--warn)"
              : "var(--line-soft)",
        borderRadius: "var(--radius-sm, 6px)",
        opacity: day.inMonth ? 1 : 0.35,
        color: "var(--fg-1)",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: isToday ? 700 : 500,
          color: isToday ? "var(--brand)" : off ? "var(--fg-3)" : "var(--fg-1)",
        }}
      >
        {dayNumber(day.date)}
        {day.hasOverride && (
          <span style={{ color: "var(--brand)" }} title="One-day shift override">
            *
          </span>
        )}
      </span>
      {day.flagHours > 0 && (
        <span style={{ fontSize: 11, color: "var(--good-strong)" }}>
          {fmtHours(day.flagHours)}h flag
        </span>
      )}
      {off ? (
        <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>off</span>
      ) : hoursLabel ? (
        <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
          {hoursLabel}
          {day.clockedHours !== null && day.clockedHours > 0 ? " clocked" : ""}
        </span>
      ) : null}
      {day.unresolved && (
        <span style={{ fontSize: 10.5, color: "var(--warn)" }}>empty?</span>
      )}
      {day.confirmedZero && (
        <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>zero day</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Selected-day action panel
// ---------------------------------------------------------------------------

function DayPanel({ day, today }: { day: CalendarDay; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isPastOrToday = day.date <= today;
  const off = day.offRange !== null;
  const baseShift = day.shift ?? { start: "08:00", end: "17:00", breakMin: 60 };

  const [hoursText, setHoursText] = useState(
    day.clockedHours !== null && day.clockedHours > 0 ? String(day.clockedHours) : "",
  );
  const [ovHours, setOvHours] = useState(String(shiftPaidHours(baseShift)));
  const [ovStart, setOvStart] = useState(baseShift.start);
  const [ovLunch, setOvLunch] = useState(String(baseShift.breakMin));

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save — try again.");
      }
    });
  }

  const statusBits: string[] = [];
  if (off) {
    statusBits.push(
      day.offRange!.startDate === day.offRange!.endDate
        ? "day off"
        : `day off (${formatDateShort(day.offRange!.startDate)} → ${formatDateShort(day.offRange!.endDate)})`,
    );
  } else if (day.shift) {
    statusBits.push(
      `scheduled ${fmtHours(shiftPaidHours(day.shift))}h from ${day.shift.start}${day.hasOverride ? " (override)" : ""}`,
    );
  } else {
    statusBits.push("not a scheduled workday");
  }
  if (day.roCount > 0)
    statusBits.push(`${fmtHours(day.flagHours)}h flag · ${day.roCount} RO${day.roCount === 1 ? "" : "s"}`);
  if (day.clockedHours !== null && day.clockedHours > 0)
    statusBits.push(`${fmtHours(day.clockedHours)}h clocked`);
  if (day.confirmedZero) statusBits.push("confirmed zero day");

  return (
    <div className="card padded mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--fg-0)" }}>
          {formatDateLong(day.date)}
        </h3>
        <span className="text-xs" style={{ color: "var(--fg-3)" }}>
          {statusBits.join(" · ")}
        </span>
      </div>

      {day.unresolved && (
        <p className="mt-2 text-sm" style={{ color: "var(--warn)" }}>
          This scheduled day has nothing on it — settle it so efficiency stays honest.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-4">
        {/* Actual hours — fact; beats the schedule. Past/today only. */}
        {isPastOrToday && (
          <div>
            <span className="field-label">Actual hours worked</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={24}
                step={0.1}
                value={hoursText}
                placeholder="—"
                onChange={(e) => setHoursText(e.target.value)}
                className="input mono tabular"
                style={{ width: 76 }}
                aria-label="Actual hours worked"
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pending || hoursText.trim() === ""}
                onClick={() =>
                  run(() => upsertDailyClockHoursAction(day.date, Number(hoursText) || 0))
                }
              >
                Save
              </button>
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--fg-3)" }}>
              Stayed late? Left early? This is the truth — it beats the schedule. 0 clears.
            </p>
          </div>
        )}

        {/* Day off toggle — any date (plan vacations ahead). */}
        <div>
          <span className="field-label">Day off</span>
          <div className="mt-1">
            {off ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={pending}
                onClick={() => run(() => deleteDayOffAction(day.offRange!.id))}
              >
                Remove
                {day.offRange!.startDate !== day.offRange!.endDate
                  ? ` ${formatDateShort(day.offRange!.startDate)}–${formatDateShort(day.offRange!.endDate)} range`
                  : " day off"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={pending}
                onClick={() => run(() => addDayOffAction(day.date, day.date))}
              >
                Mark day off
              </button>
            )}
          </div>
        </div>

        {/* Zero-day resolution. */}
        {(day.unresolved || day.confirmedZero) && (
          <div>
            <span className="field-label">Zero day</span>
            <div className="mt-1">
              {day.confirmedZero ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={pending}
                  onClick={() => run(() => deleteConfirmedZeroDayAction(day.date))}
                >
                  Undo zero day
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={pending}
                  onClick={() => run(() => resolveZeroDayAction(day.date, "worked-zero"))}
                >
                  Worked, zero flag
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* One-day shift override — a plan, not a fact. */}
      {!off && (
        <div className="mt-4" style={{ borderTop: "1px dashed var(--line-soft)", paddingTop: 12 }}>
          <span className="field-label">
            {day.hasOverride ? "Shift override for this day" : "Change this day's shift"}
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--fg-2)" }}>
              <input
                type="number"
                min={0.5}
                max={16}
                step={0.5}
                value={ovHours}
                onChange={(e) => setOvHours(e.target.value)}
                className="input mono tabular"
                style={{ width: 64 }}
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
                style={{ width: 100 }}
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
                style={{ width: 60 }}
                aria-label="Override lunch minutes"
              />
              min
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
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
                className="btn btn-ghost btn-sm"
                disabled={pending}
                onClick={() => run(() => clearShiftOverrideAction(day.date))}
              >
                Reset to pattern
              </button>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--fg-3)" }}>
            Still an estimate — for hours you actually worked, use “actual hours” above.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      {pending && (
        <p className="mt-2 text-xs" style={{ color: "var(--fg-3)" }}>
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
  const [selected, setSelected] = useState<string | null>(
    days.some((d) => d.date === today && d.inMonth) ? today : null,
  );

  const headers = useMemo(() => {
    const base = [...DOW_SUN];
    if (weekStartDay === 1) base.push(base.shift()!);
    return base;
  }, [weekStartDay]);

  const selectedDay = days.find((d) => d.date === selected) ?? null;

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 4,
        }}
      >
        {headers.map((h) => (
          <div
            key={h}
            className="field-label"
            style={{ textAlign: "left", padding: "0 7px 2px" }}
          >
            {h}
          </div>
        ))}
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
        <DayPanel key={selectedDay.date} day={selectedDay} today={today} />
      )}
    </div>
  );
}
