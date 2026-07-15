"use client";

// Planned days off (vacation, injury) — the logging streak freezes on these
// dates instead of breaking (docs/gamification.md). Single days: same start
// and end date.
import { useState, useTransition } from "react";
import { addDayOffAction, deleteDayOffAction } from "@/app/actions/gamification";
import { formatDateShort } from "@/lib/periods";
import type { DayOff } from "@/lib/types";

export function DaysOffCard({ initialDaysOff }: { initialDaysOff: DayOff[] }) {
  const [daysOff, setDaysOff] = useState(initialDaysOff);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = start !== "" && (end === "" || end >= start);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      try {
        const added = await addDayOffAction(start, end || start);
        setDaysOff((prev) =>
          [added, ...prev].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
        );
        setStart("");
        setEnd("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save — try again.");
      }
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteDayOffAction(id);
        setDaysOff((prev) => prev.filter((d) => d.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete — try again.");
      }
    });
  }

  return (
    <section className="card padded-lg">
      <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--fg-0)" }}>
        Days Off
      </h2>
      <p className="mb-5 text-sm" style={{ color: "var(--fg-2)" }}>
        Vacation, injury, planned time away — your logging streak freezes on
        these dates instead of breaking. Leave the end date empty for a single day.
      </p>
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
        <label className="field" style={{ minWidth: 150 }}>
          <span className="field-label">From</span>
          <input
            type="date"
            required
            value={start}
            onChange={(e) => { setStart(e.target.value); setError(null); }}
            className="input"
          />
        </label>
        <label className="field" style={{ minWidth: 150 }}>
          <span className="field-label">To (optional)</span>
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => { setEnd(e.target.value); setError(null); }}
            className="input"
          />
        </label>
        <button type="submit" disabled={!valid || pending} className="btn btn-primary">
          {pending ? "Saving…" : "Add"}
        </button>
        {error && (
          <p role="alert" className="w-full text-sm" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}
      </form>
      {daysOff.length > 0 && (
        <ul className="mt-4" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {daysOff.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 py-2 text-sm"
              style={{ borderTop: "1px dashed var(--line-soft)", color: "var(--fg-1)" }}
            >
              <span className="tabular">
                {d.startDate === d.endDate
                  ? formatDateShort(d.startDate)
                  : `${formatDateShort(d.startDate)} → ${formatDateShort(d.endDate)}`}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: "var(--bad)" }}
                disabled={pending}
                onClick={() => handleDelete(d.id)}
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
