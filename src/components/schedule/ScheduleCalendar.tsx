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
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { actionErrorMessage } from "@/lib/action-error";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { StatusField } from "@/components/ui/StatusField";
import { Zone } from "@/components/ui/Zone";
import { withPt } from "@/components/ui/Figure";

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
  // day", "clocked") is now either a mark or lives in the dock.
  const hours = logged
    ? fmtHours(day.clockedHours as number)
    : scheduled
      ? fmtHours(shiftPaidHours(day.shift as ShiftDef))
      : null;

  const overridden = day.hasOverride && !off;

  const cls = [
    "day-cell",
    !day.inMonth && "is-out",
    day.inMonth && (off || !scheduled) && "is-bare",
    isToday && "is-today",
    selected && "is-selected",
    overridden && "is-override",
  ]
    .filter(Boolean)
    .join(" ");

  // The hours go in the label, not just the cell. A scheduled day used to
  // announce itself as ", scheduled" with no figure at all, so an 8h day and a
  // 10h day were indistinguishable to a screen reader — and a one-day override
  // set to the SAME hours as the pattern was invisible to everyone, since the
  // only thing that ever moved was the number.
  const state = day.unresolved
    ? ", needs a decision"
    : off
      ? ", day off"
      : logged
        ? `, ${fmtHours(day.clockedHours as number)} hours logged`
        : scheduled
          ? `, ${fmtHours(shiftPaidHours(day.shift as ShiftDef))} hours scheduled`
          : "";

  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      aria-label={`${formatDateLong(day.date)}${state}${overridden ? ", shift overridden" : ""}`}
      aria-pressed={selected}
      className={cls}
    >
      <span className="day-num">{dayNumber(day.date)}</span>
      {off ? (
        <span className="day-sub is-planned">off</span>
      ) : hours !== null ? (
        <span className={`day-sub${logged ? "" : " is-planned"}`}>
          {hours}
          {overridden && (
            <span className="day-override" aria-hidden="true">
              *
            </span>
          )}
        </span>
      ) : overridden ? (
        // An override that clears the shift leaves no number to hang the
        // marker on; it still must not look like an ordinary bare day.
        <span className="day-sub is-planned">
          <span className="day-override" aria-hidden="true">
            *
          </span>
        </span>
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
        setError(actionErrorMessage(err, "Couldn't save — try again."));
      }
    });
  }

  // The day's state as a tag. Colour is state: green = logged, red = still
  // owes a decision, everything else plain.
  const badge: { tone: "neutral" | "good" | "bad"; text: string } = day.unresolved
    ? { tone: "bad", text: "Needs a decision" }
    : off
      ? { tone: "neutral", text: "Day off" }
      : day.clockedHours !== null && day.clockedHours > 0
        ? { tone: "good", text: `${fmtHours(day.clockedHours)}h logged` }
        : day.confirmedZero
          ? { tone: "neutral", text: "Zero day" }
          : day.shift
            ? { tone: "neutral", text: `Scheduled ${fmtHours(shiftPaidHours(day.shift))}h` }
            : { tone: "neutral", text: "Not a workday" };

  return (
    <div className="day-dock">
      <div className="day-dock-head">
        <h3>{formatDateLong(day.date)}</h3>
        <Badge tone={badge.tone}>{badge.text}</Badge>
      </div>

      {(day.flagHours > 0 || day.roCount > 0) && (
        <p className="sch-dock-meta">
          <span className="num">{withPt(fmtHours(day.flagHours))}</span>h flag ·{" "}
          <span className="num">{day.roCount}</span> RO{day.roCount === 1 ? "" : "s"}
        </p>
      )}

      {isPastOrToday && (
        <>
          <div className="sch-hours">
            <Field label="Actual hours worked" htmlFor="day-hours">
              <Input
                id="day-hours"
                type="number"
                min={0}
                max={24}
                step={0.1}
                mono
                value={hoursText}
                placeholder="—"
                onChange={(e) => setHoursText(e.target.value)}
              />
            </Field>
            <Button
              variant="go"
              disabled={pending || hoursText.trim() === ""}
              onClick={() =>
                run(
                  () => upsertDailyClockHoursAction(day.date, Number(hoursText) || 0),
                  Number(hoursText) > 0,
                )
              }
            >
              Save
            </Button>
          </div>
          <p className="sch-fine">
            Stayed late? Left early? This is the truth — it beats the schedule. 0
            clears it.
          </p>
        </>
      )}

      <div className="sch-acts">
        {off ? (
          <Button
            variant="line"
            size="sm"
            disabled={pending}
            onClick={() => run(() => deleteDayOffAction(day.offRange!.id))}
          >
            {day.offRange!.startDate !== day.offRange!.endDate
              ? `Remove ${formatDateShort(day.offRange!.startDate)}–${formatDateShort(day.offRange!.endDate)} range`
              : "Remove day off"}
          </Button>
        ) : (
          <Button
            variant="line"
            size="sm"
            disabled={pending}
            onClick={() => run(() => addDayOffAction(day.date, day.date), true)}
          >
            Day off
          </Button>
        )}

        {day.confirmedZero ? (
          <Button
            variant="line"
            size="sm"
            disabled={pending}
            onClick={() => run(() => deleteConfirmedZeroDayAction(day.date))}
          >
            Undo zero day
          </Button>
        ) : (
          day.unresolved && (
            <Button
              variant="line"
              size="sm"
              disabled={pending}
              onClick={() => run(() => resolveZeroDayAction(day.date, "worked-zero"), true)}
            >
              Worked, zero flag
            </Button>
          )
        )}

        {!off && (
          <Button
            variant="quiet"
            size="sm"
            aria-expanded={editingShift}
            onClick={() => setEditingShift((v) => !v)}
          >
            {day.hasOverride ? "Edit shift" : "Change shift"}
          </Button>
        )}
      </div>

      {/* A plan, not a fact — kept behind a press so the dock stays short
          enough to sit above the thumb bar on a phone. */}
      {!off && editingShift && (
        <div className="sch-override">
          <div className="sch-shift-row">
            <label>
              <Input
                type="number"
                min={0.5}
                max={16}
                step={0.5}
                mono
                className="is-hrs"
                value={ovHours}
                onChange={(e) => setOvHours(e.target.value)}
                aria-label="Override paid hours"
              />
              hrs
            </label>
            <label>
              starts
              <Input
                type="time"
                mono
                className="is-time"
                value={ovStart}
                onChange={(e) => setOvStart(e.target.value)}
                aria-label="Override shift start"
              />
            </label>
            <label>
              lunch
              <Input
                type="number"
                min={0}
                max={240}
                step={15}
                mono
                className="is-min"
                value={ovLunch}
                onChange={(e) => setOvLunch(e.target.value)}
                aria-label="Override lunch minutes"
              />
              min
            </label>
          </div>
          <div className="sch-acts">
            <Button
              variant="go"
              size="sm"
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
            </Button>
            {day.hasOverride && (
              <Button
                variant="line"
                size="sm"
                disabled={pending}
                onClick={() => run(() => clearShiftOverrideAction(day.date))}
              >
                Reset to pattern
              </Button>
            )}
          </div>
          <p className="sch-fine">
            Still an estimate — for hours you actually worked, use “actual hours”
            above.
          </p>
        </div>
      )}

      {error && (
        <StatusField tag="Fix" role="alert" inset>
          {error}
        </StatusField>
      )}
      {pending && (
        <p className="sch-status" aria-live="polite">
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
  monthName,
}: {
  days: CalendarDay[]; // 42 cells, grid order
  today: string;
  weekStartDay: 0 | 1;
  /** "March 2026" — the zone's name. */
  monthName: string;
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

  const scheduledHours = days
    .filter((d) => d.inMonth && d.offRange === null && d.shift !== null)
    .reduce((s, d) => s + shiftPaidHours(d.shift as ShiftDef), 0);

  return (
    <>
      {/* Stepper that walks the unsettled days, so they don't have to be
          hunted. A status field, because it is the one thing on the page that
          asks for something. */}
      {unsettled.length > 0 && (
        <StatusField tag="Fix">
          <div className="sfield-act">
            <span>
              <b>{unsettled.length}</b> {unsettled.length === 1 ? "day needs" : "days need"} a decision —
              scheduled, nothing logged.
            </span>
            <span className="sch-step">
              <button
                type="button"
                className="iconbtn"
                aria-label="Previous unsettled day"
                onClick={() => step(-1)}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <span className="num">
                {stepIndex === -1 ? `${unsettled.length}` : `${stepIndex + 1} of ${unsettled.length}`}
              </span>
              <button
                type="button"
                className="iconbtn"
                aria-label="Next unsettled day"
                onClick={() => step(1)}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </span>
          </div>
        </StatusField>
      )}

      <Zone
        name={monthName}
        aside={
          <>
            <span className="num">{withPt(fmtHours(scheduledHours))}</span>h scheduled
          </>
        }
      >
        {/* Above the grid, not below it. The dock is sticky, so anything
            sitting between the grid and the dock's resting position is hidden
            behind it at the top of the page — which is exactly where a
            first-time reader needs the key to the mark. */}
        <div className="sch-legend">
          <span>
            <i className="day-flag" aria-hidden="true" />
            Needs a decision
          </span>
          <span>
            <i className="day-sub is-planned">8.0</i>Scheduled
          </span>
          <span>
            <i className="day-sub">9.2</i>Hours you logged
          </span>
          <span>
            <i className="day-override">*</i>
            One-day override
          </span>
        </div>

        <div className="sch-dow">
          {headers.map((h) => (
            <div key={h}>
              <span aria-hidden="true">{h[0]}</span>
              <span className="sr-only">{h}</span>
            </div>
          ))}
        </div>
        <div className="sch-grid">
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
      </Zone>
    </>
  );
}
