"use client";

import { useState, useTransition } from "react";
import { setSplitDayAction } from "@/app/actions/settings";
import { getRangeForPeriodKey, formatPeriodLabel, isoDate } from "@/lib/periods";

interface Props {
  initialSplitDay: number;
  overrideCount: number;
}

function buildPreview(splitDay: number) {
  const today = isoDate();
  const [y, m] = today.split("-");
  const key = `${y}-${m}`;
  return {
    p1: getRangeForPeriodKey(`${key}-P1`, splitDay),
    p2: getRangeForPeriodKey(`${key}-P2`, splitDay),
  };
}

export function SplitDayCard({ initialSplitDay, overrideCount }: Props) {
  const [saved, setSaved] = useState(false);
  const [inputVal, setInputVal] = useState(String(initialSplitDay));
  const [committed, setCommitted] = useState(initialSplitDay);
  const [pending, startTransition] = useTransition();

  const parsed = parseInt(inputVal, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 30;
  const preview = valid ? buildPreview(parsed) : null;
  const dirty = valid && parsed !== committed;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    startTransition(async () => {
      await setSplitDayAction(parsed);
      setCommitted(parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-1 text-base font-semibold text-zinc-100">Pay Period Defaults</h2>
      <p className="mb-5 text-sm text-zinc-400">
        The day of the month that ends the first pay period (P1). P2 runs from the next day through
        end of month.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="splitDay" className="whitespace-nowrap text-sm text-zinc-300">
            First period ends on day
          </label>
          <input
            id="splitDay"
            type="number"
            min={1}
            max={30}
            value={inputVal}
            onChange={(e) => {
              setSaved(false);
              setInputVal(e.target.value);
            }}
            className="w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-orange-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!dirty || pending}
            className="rounded-lg bg-orange-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Saving…" : saved ? "Saved!" : "Save"}
          </button>
        </div>

        {preview && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-800/50 px-3 py-2">
              <span className="text-xs font-medium text-orange-400">P1</span>
              <p className="mt-0.5 text-sm text-zinc-300">
                {preview.p1 ? formatPeriodLabel(preview.p1) : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-800/50 px-3 py-2">
              <span className="text-xs font-medium text-orange-400">P2</span>
              <p className="mt-0.5 text-sm text-zinc-300">
                {preview.p2 ? formatPeriodLabel(preview.p2) : "—"}
              </p>
            </div>
          </div>
        )}

        {overrideCount > 0 && (
          <p className="text-xs text-zinc-500">
            {overrideCount} custom override{overrideCount !== 1 ? "s" : ""} in effect —{" "}
            <a href="/pay-period" className="text-orange-400 underline underline-offset-2">
              manage on the Pay Period tab
            </a>
            .
          </p>
        )}
      </form>
    </section>
  );
}
