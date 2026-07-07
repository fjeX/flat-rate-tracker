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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseInt(inputVal, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 30;
  const preview = valid ? buildPreview(parsed) : null;
  const dirty = valid && parsed !== committed;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    startTransition(async () => {
      try {
        await setSplitDayAction(parsed);
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
      <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--fg-0)" }}>Pay Period Defaults</h2>
      <p className="mb-5 text-sm" style={{ color: "var(--fg-2)" }}>
        The day of the month that ends the first pay period (P1). P2 runs from the next day through
        end of month.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="splitDay" className="whitespace-nowrap text-sm" style={{ color: "var(--fg-1)" }}>
            First period ends on day
          </label>
          <input
            id="splitDay"
            type="number"
            min={1}
            max={30}
            required
            aria-required="true"
            value={inputVal}
            onChange={(e) => {
              setSaved(false);
              setError(null);
              setInputVal(e.target.value);
            }}
            aria-invalid={!valid}
            aria-describedby={error ? "splitDay-error" : undefined}
            className="input w-20"
            style={{ padding: "6px 12px" }}
          />
          <button
            type="submit"
            disabled={!dirty || pending}
            className="btn btn-primary btn-sm"
          >
            {pending ? "Saving…" : saved ? "Saved!" : "Save"}
          </button>
        </div>

        {error && (
          <p id="splitDay-error" role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}

        {preview && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[var(--radius-sm)] border px-3 py-2" style={{ borderColor: "var(--line)", background: "var(--bg-3)" }}>
              <span className="text-xs font-medium" style={{ color: "var(--brand)" }}>P1</span>
              <p className="mt-0.5 text-sm" style={{ color: "var(--fg-1)" }}>
                {preview.p1 ? formatPeriodLabel(preview.p1) : "—"}
              </p>
            </div>
            <div className="rounded-[var(--radius-sm)] border px-3 py-2" style={{ borderColor: "var(--line)", background: "var(--bg-3)" }}>
              <span className="text-xs font-medium" style={{ color: "var(--brand)" }}>P2</span>
              <p className="mt-0.5 text-sm" style={{ color: "var(--fg-1)" }}>
                {preview.p2 ? formatPeriodLabel(preview.p2) : "—"}
              </p>
            </div>
          </div>
        )}

        {overrideCount > 0 && (
          <p className="text-xs" style={{ color: "var(--fg-3)" }}>
            {overrideCount} custom override{overrideCount !== 1 ? "s" : ""} in effect —{" "}
            <a href="/pay-period" className="underline underline-offset-2" style={{ color: "var(--brand)" }}>
              manage on the Pay Period tab
            </a>
            .
          </p>
        )}
      </form>
    </section>
  );
}
