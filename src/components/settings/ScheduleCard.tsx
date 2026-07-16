"use client";

// Work schedule editor — the fallback efficiency denominator (schedule-based
// efficiency plan). Effective-dated: saving with a new date adds a version,
// saving with an existing version's date corrects it. Times are per-day so
// 4×10s, alternating Saturdays, and split shifts-lite all fit.
import { useState, useTransition } from "react";
import {
  deleteWorkScheduleAction,
  saveWorkScheduleAction,
} from "@/app/actions/schedule";
import { formatDateShort } from "@/lib/periods";
import {
  DEFAULT_SHIFT,
  emptyWeek,
  shiftFromHours,
  shiftPaidHours,
  validateWeeks,
  type ScheduleWeek,
  type ShiftDef,
  type WeekdayKey,
  type WorkSchedule,
} from "@/lib/schedule";
import { fmtHours } from "@/lib/stats";

const DAY_ORDER: { key: WeekdayKey; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function cloneWeek(week: ScheduleWeek): ScheduleWeek {
  const out = emptyWeek();
  for (const { key } of DAY_ORDER) {
    const s = week[key];
    out[key] = s ? { ...s } : null;
  }
  return out;
}

function weekPaidHours(week: ScheduleWeek): number {
  return DAY_ORDER.reduce(
    (sum, { key }) => sum + (week[key] ? shiftPaidHours(week[key]!) : 0),
    0,
  );
}

/** Shift to copy when a day is switched on: the last enabled day above it,
 * so "Mon 7–6" spreads down the week instead of retyping four times. */
function shiftTemplate(week: ScheduleWeek, upTo: WeekdayKey): ShiftDef {
  let template = DEFAULT_SHIFT;
  for (const { key } of DAY_ORDER) {
    if (key === upTo) break;
    if (week[key]) template = week[key]!;
  }
  return { ...template };
}

function WeekEditor({
  week,
  onChange,
  disabled,
}: {
  week: ScheduleWeek;
  onChange: (next: ScheduleWeek) => void;
  disabled: boolean;
}) {
  function patchDay(key: WeekdayKey, shift: ShiftDef | null) {
    const next = cloneWeek(week);
    next[key] = shift;
    onChange(next);
  }

  return (
    <div>
      {DAY_ORDER.map(({ key, label }) => {
        const shift = week[key];
        return (
          <div
            key={key}
            className="flex flex-wrap items-center gap-3 py-1.5 text-sm"
            style={{ borderTop: "1px dashed var(--line-soft)" }}
          >
            <label
              className="sched-day-toggle flex items-center gap-2"
              style={{ width: 64, color: shift ? "var(--fg-1)" : "var(--fg-3)" }}
            >
              <input
                type="checkbox"
                checked={shift !== null}
                disabled={disabled}
                onChange={(e) =>
                  patchDay(key, e.target.checked ? shiftTemplate(week, key) : null)
                }
              />
              <span className="font-medium">{label}</span>
            </label>
            {shift ? (
              <>
                <label className="flex items-center gap-1.5" style={{ color: "var(--fg-2)" }}>
                  <input
                    type="number"
                    min={0.5}
                    max={16}
                    step={0.5}
                    value={shiftPaidHours(shift)}
                    disabled={disabled}
                    aria-label={`${label} paid hours`}
                    onChange={(e) => {
                      const next = shiftFromHours(
                        Number(e.target.value),
                        shift.start,
                        shift.breakMin,
                      );
                      if (next) patchDay(key, next);
                    }}
                    className="input mono tabular"
                    style={{ width: 64 }}
                  />
                  <span style={{ fontSize: 12 }}>hrs</span>
                </label>
                <label className="flex items-center gap-1.5" style={{ color: "var(--fg-2)" }}>
                  <span style={{ fontSize: 12 }}>starts</span>
                  <input
                    type="time"
                    value={shift.start}
                    disabled={disabled}
                    aria-label={`${label} shift start`}
                    onChange={(e) => {
                      const next = shiftFromHours(
                        shiftPaidHours(shift),
                        e.target.value,
                        shift.breakMin,
                      );
                      if (next) patchDay(key, next);
                    }}
                    className="input mono tabular"
                    style={{ width: 104 }}
                  />
                </label>
                <label className="flex items-center gap-1.5" style={{ color: "var(--fg-2)" }}>
                  <span style={{ fontSize: 12 }}>lunch</span>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    step={15}
                    value={shift.breakMin}
                    disabled={disabled}
                    aria-label={`${label} unpaid lunch minutes`}
                    onChange={(e) => {
                      const next = shiftFromHours(
                        shiftPaidHours(shift),
                        shift.start,
                        Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      );
                      if (next) patchDay(key, next);
                    }}
                    className="input mono tabular"
                    style={{ width: 60 }}
                  />
                  <span style={{ fontSize: 12 }}>min</span>
                </label>
                <span
                  className="tabular ml-auto"
                  style={{ color: "var(--fg-3)", fontSize: 12 }}
                >
                  out ≈ {shift.end}
                </span>
              </>
            ) : (
              <span style={{ color: "var(--fg-3)", fontSize: 12 }}>Off</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ScheduleCard({
  initialSchedules,
  suggestion,
  today,
}: {
  initialSchedules: WorkSchedule[]; // newest effective_from first
  suggestion: ScheduleWeek | null; // inferred from logging history
  today: string;
}) {
  const [schedules, setSchedules] = useState(initialSchedules);
  const [editing, setEditing] = useState(initialSchedules.length === 0);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [weeks, setWeeks] = useState<ScheduleWeek[]>([emptyWeek()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rotation = weeks.length as 1 | 2;
  const active = schedules.find((s) => s.effectiveFrom <= today) ?? null;
  const problem = validateWeeks(weeks, rotation);

  function startEditingFrom(source: ScheduleWeek[] | null) {
    setWeeks(source ? source.map(cloneWeek) : [emptyWeek()]);
    setEffectiveFrom(today);
    setError(null);
    setEditing(true);
  }

  function setRotation(n: 1 | 2) {
    if (n === rotation) return;
    setWeeks(n === 2 ? [weeks[0], cloneWeek(weeks[0])] : [weeks[0]]);
  }

  function handleSave() {
    if (problem) return;
    setError(null);
    startTransition(async () => {
      try {
        const saved = await saveWorkScheduleAction({
          effectiveFrom,
          rotationWeeks: rotation,
          weeks,
        });
        setSchedules((prev) =>
          [saved, ...prev.filter((s) => s.effectiveFrom !== saved.effectiveFrom)].sort(
            (a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1),
          ),
        );
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save — try again.");
      }
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteWorkScheduleAction(id);
        setSchedules((prev) => prev.filter((s) => s.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete — try again.");
      }
    });
  }

  return (
    <section className="card padded-lg">
      <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--fg-0)" }}>
        Work Schedule
      </h2>
      <p className="mb-5 text-sm" style={{ color: "var(--fg-2)" }}>
        Your normal shifts. On days you don&apos;t enter clocked hours,
        efficiency falls back to these scheduled hours — entered clock hours
        always win. Changes apply from their effective date forward; past
        stats never recalculate.
      </p>

      {!editing && (
        <>
          {active ? (
            <div className="text-sm" style={{ color: "var(--fg-1)" }}>
              <span className="tabular">
                {active.rotationWeeks === 2 ? "2-week rotation" : "Weekly"} ·{" "}
                {fmtHours(
                  active.weeks.reduce((s, w) => s + weekPaidHours(w), 0) /
                    active.rotationWeeks,
                )}
                h/week
              </span>
              <span style={{ color: "var(--fg-3)" }}>
                {" "}
                · since {formatDateShort(active.effectiveFrom)}
              </span>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--fg-3)" }}>
              No schedule yet.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => startEditingFrom(active ? active.weeks : null)}
            >
              {active ? "Change schedule" : "Set up schedule"}
            </button>
            {!active && suggestion && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => startEditingFrom([suggestion])}
              >
                Suggest from my history
              </button>
            )}
          </div>
        </>
      )}

      {editing && (
        <div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="field" style={{ minWidth: 150 }}>
              <span className="field-label">Effective from</span>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="input"
              />
            </label>
            <div className="field">
              <span className="field-label">Pattern</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`btn btn-sm ${rotation === 1 ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setRotation(1)}
                >
                  Every week
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${rotation === 2 ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setRotation(2)}
                >
                  2-week rotation
                </button>
              </div>
            </div>
          </div>

          {weeks.map((week, i) => (
            <div key={i} className="mt-4">
              {rotation === 2 && (
                <div className="field-label mb-1">
                  {i === 0 ? "Week A (starts on the effective date's week)" : "Week B"}
                  <span className="tabular" style={{ color: "var(--fg-3)", marginLeft: 8 }}>
                    {fmtHours(weekPaidHours(week))}h
                  </span>
                </div>
              )}
              <WeekEditor
                week={week}
                disabled={pending}
                onChange={(next) =>
                  setWeeks((prev) => prev.map((w, j) => (j === i ? next : w)))
                }
              />
            </div>
          ))}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || problem !== null}
              onClick={handleSave}
            >
              {pending ? "Saving…" : "Save schedule"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <span className="tabular text-sm" style={{ color: "var(--fg-2)" }}>
              {fmtHours(
                weeks.reduce((s, w) => s + weekPaidHours(w), 0) / rotation,
              )}
              h/week
            </span>
          </div>
          {problem && (
            <p className="mt-2 text-sm" style={{ color: "var(--fg-3)" }}>
              {problem}
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}

      {schedules.length > 0 && (
        <ul className="mt-4" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {schedules.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 py-2 text-sm"
              style={{ borderTop: "1px dashed var(--line-soft)", color: "var(--fg-1)" }}
            >
              <span className="tabular">
                {formatDateShort(s.effectiveFrom)} →{" "}
                {s.rotationWeeks === 2 ? "2-week rotation" : "weekly"},{" "}
                {fmtHours(
                  s.weeks.reduce((sum, w) => sum + weekPaidHours(w), 0) /
                    s.rotationWeeks,
                )}
                h/week
                {s.id === active?.id && (
                  <span style={{ color: "var(--good)" }}> · current</span>
                )}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: "var(--bad)" }}
                disabled={pending}
                onClick={() => handleDelete(s.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
