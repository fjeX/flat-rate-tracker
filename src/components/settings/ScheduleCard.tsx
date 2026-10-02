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
import { actionErrorMessage } from "@/lib/action-error";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { StatusField } from "@/components/ui/StatusField";
import { Zone } from "@/components/ui/Zone";
import { withPt } from "@/components/ui/Figure";

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
          <div key={key} className="sch-day">
            <label className={`sch-day-on${shift ? "" : " is-off"}`}>
              <input
                type="checkbox"
                checked={shift !== null}
                disabled={disabled}
                onChange={(e) =>
                  patchDay(key, e.target.checked ? shiftTemplate(week, key) : null)
                }
              />
              <span>{label}</span>
            </label>
            {shift ? (
              <div className="sch-shift-row">
                <label>
                  <Input
                    type="number"
                    min={0.5}
                    max={16}
                    step={0.5}
                    mono
                    className="is-hrs"
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
                  />
                  hrs
                </label>
                <label>
                  starts
                  <Input
                    type="time"
                    mono
                    className="is-time"
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
                  />
                  min
                </label>
              </div>
            ) : (
              <span className="sch-dim">Off</span>
            )}
            {shift && <span className="sch-dim">out ≈ <span className="num">{shift.end}</span></span>}
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
        if ("error" in saved) {
          setError(saved.error);
          return;
        }
        setSchedules((prev) =>
          [saved, ...prev.filter((s) => s.effectiveFrom !== saved.effectiveFrom)].sort(
            (a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1),
          ),
        );
        setEditing(false);
      } catch (err) {
        setError(actionErrorMessage(err, "Couldn't save — try again."));
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
        setError(actionErrorMessage(err, "Couldn't delete — try again."));
      }
    });
  }

  const activeWeekly = active
    ? active.weeks.reduce((s, w) => s + weekPaidHours(w), 0) / active.rotationWeeks
    : null;

  return (
    <Zone
      name="Weekly pattern"
      aside={
        activeWeekly !== null ? (
          <>
            <span className="num">{withPt(fmtHours(activeWeekly))}</span>h/week
          </>
        ) : undefined
      }
    >
      <p className="ins-sub">
        Your normal shifts. On days you don&apos;t enter clocked hours,
        efficiency falls back to these scheduled hours — entered clock hours
        always win. Changes apply from their effective date forward; past
        stats never recalculate.
      </p>

      {!editing && (
        <>
          <div className="sch-pattern-now" style={{ marginTop: "var(--s3)" }}>
            {active ? (
              <>
                <b>{active.rotationWeeks === 2 ? "2-week rotation" : "Weekly"}</b>
                <span>
                  · <span className="num">{withPt(fmtHours(activeWeekly as number))}</span>h/week
                </span>
                <span className="sch-dim">· since {formatDateShort(active.effectiveFrom)}</span>
              </>
            ) : (
              <span className="sch-dim">No schedule yet.</span>
            )}
          </div>
          <div className="sch-acts">
            <Button variant="go" onClick={() => startEditingFrom(active ? active.weeks : null)}>
              {active ? "Change schedule" : "Set up schedule"}
            </Button>
            {!active && suggestion && (
              <Button variant="line" onClick={() => startEditingFrom([suggestion])}>
                Suggest from my history
              </Button>
            )}
          </div>
        </>
      )}

      {editing && (
        <div className="sch-editor">
          <div className="sch-editor-head">
            <Field label="Effective from" htmlFor="sch-effective">
              <Input
                id="sch-effective"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </Field>
            <div className="field">
              <span className="field-label">Pattern</span>
              <div className="seg" role="group" aria-label="Pattern">
                <button type="button" aria-pressed={rotation === 1} onClick={() => setRotation(1)}>
                  Every week
                </button>
                <button type="button" aria-pressed={rotation === 2} onClick={() => setRotation(2)}>
                  2-week rotation
                </button>
              </div>
            </div>
          </div>

          {weeks.map((week, i) => (
            <div key={i} className="sch-week">
              {rotation === 2 && (
                <div className="sch-week-k">
                  <span className="field-label" style={{ margin: 0 }}>
                    {i === 0 ? "Week A (starts on the effective date's week)" : "Week B"}
                  </span>
                  <span className="num">{withPt(fmtHours(weekPaidHours(week)))}h</span>
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

          <div className="sch-editor-foot">
            <Button variant="go" disabled={pending || problem !== null} onClick={handleSave} busy={pending}>
              {pending ? "Saving…" : "Save schedule"}
            </Button>
            <Button variant="quiet" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <span className="num">
              {withPt(fmtHours(weeks.reduce((s, w) => s + weekPaidHours(w), 0) / rotation))}
              <span className="unit">h/week</span>
            </span>
          </div>
          {problem && <p className="sch-fine">{problem}</p>}
        </div>
      )}

      {error && (
        <StatusField tag="Fix" role="alert" inset>
          {error}
        </StatusField>
      )}

      {schedules.length > 0 && (
        <ul className="sch-versions">
          {schedules.map((s) => (
            <li key={s.id}>
              <span>
                {formatDateShort(s.effectiveFrom)} →{" "}
                {s.rotationWeeks === 2 ? "2-week rotation" : "weekly"},{" "}
                <span className="num">
                  {withPt(fmtHours(
                    s.weeks.reduce((sum, w) => sum + weekPaidHours(w), 0) /
                      s.rotationWeeks,
                  ))}
                </span>
                h/week
                {s.id === active?.id && <span className="is-current"> · current</span>}
              </span>
              <Button variant="quiet" size="sm" disabled={pending} onClick={() => handleDelete(s.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Zone>
  );
}
