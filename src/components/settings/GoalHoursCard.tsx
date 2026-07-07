"use client";

import { useState, useTransition } from "react";
import { setGoalHoursAction } from "@/app/actions/settings";

export function GoalHoursCard({ initialGoalHours }: { initialGoalHours: number }) {
  const [inputVal, setInputVal] = useState(String(initialGoalHours));
  const [committed, setCommitted] = useState(initialGoalHours);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseInt(inputVal, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 999;
  const dirty = valid && parsed !== committed;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    startTransition(async () => {
      try {
        await setGoalHoursAction(parsed);
        setCommitted(parsed);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save — check your connection and try again.");
      }
    });
  }

  return (
    <section className="card padded-lg">
      <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--fg-0)" }}>Pay Period Goal</h2>
      <p className="mb-5 text-sm" style={{ color: "var(--fg-2)" }}>
        Target flag hours per pay period. Drives the pace bar on the dashboard and the chart
        reference line in history.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
        <label htmlFor="goalHours" className="whitespace-nowrap text-sm" style={{ color: "var(--fg-1)" }}>
          Goal hours
        </label>
        <input
          id="goalHours"
          type="number"
          min={1}
          max={999}
          required
          aria-required="true"
          value={inputVal}
          onChange={(e) => {
            setInputVal(e.target.value);
            setSaved(false);
            setError(null);
          }}
          aria-invalid={!valid}
          aria-describedby={error ? "goalHours-error" : undefined}
          className="input w-24 text-center"
        />
        <button
          type="submit"
          disabled={!dirty || pending}
          className="btn btn-primary"
        >
          {pending ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
        {error && (
          <p id="goalHours-error" role="alert" className="w-full text-sm" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
