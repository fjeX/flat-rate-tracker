"use client";

import { useState, useTransition } from "react";
import { setGoalHoursAction } from "@/app/actions/settings";

export function GoalHoursCard({ initialGoalHours }: { initialGoalHours: number }) {
  const [inputVal, setInputVal] = useState(String(initialGoalHours));
  const [committed, setCommitted] = useState(initialGoalHours);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const parsed = parseInt(inputVal, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 999;
  const dirty = valid && parsed !== committed;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    startTransition(async () => {
      await setGoalHoursAction(parsed);
      setCommitted(parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-1 text-base font-semibold text-zinc-100">Pay Period Goal</h2>
      <p className="mb-5 text-sm text-zinc-400">
        Target flag hours per pay period. Drives the pace bar on the dashboard and the chart
        reference line in history.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
        <label htmlFor="goalHours" className="whitespace-nowrap text-sm text-zinc-300">
          Goal hours
        </label>
        <input
          id="goalHours"
          type="number"
          min={1}
          max={999}
          value={inputVal}
          onChange={(e) => {
            setInputVal(e.target.value);
            setSaved(false);
          }}
          className="w-24 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-sm text-zinc-100 focus:border-orange-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!dirty || pending}
          className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
        >
          {pending ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
      </form>
    </section>
  );
}
