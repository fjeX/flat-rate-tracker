"use client";

// Empty scheduled workdays awaiting a decision (schedule-based efficiency
// plan). These days are held OUT of efficiency until resolved, so a
// forgotten vacation mark can't silently tank the number — but a real slow
// day, once confirmed, honestly counts its full scheduled hours.
import { useState, useTransition } from "react";
import { resolveZeroDayAction } from "@/app/actions/schedule";
import { formatDateLong } from "@/lib/periods";

const SHOW_LIMIT = 5;

export function UnresolvedDaysCard({ days }: { days: string[] }) {
  const [remaining, setRemaining] = useState(days);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (remaining.length === 0) return null;

  function resolve(date: string, resolution: "day-off" | "worked-zero") {
    setError(null);
    setBusyDate(date);
    startTransition(async () => {
      try {
        await resolveZeroDayAction(date, resolution);
        setRemaining((prev) => prev.filter((d) => d !== date));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save — try again.");
      } finally {
        setBusyDate(null);
      }
    });
  }

  const shown = remaining.slice(0, SHOW_LIMIT);
  const hidden = remaining.length - shown.length;

  return (
    <section className="card padded">
      <h2 className="text-sm font-semibold" style={{ color: "var(--fg-0)" }}>
        {remaining.length === 1
          ? "One scheduled day looks empty"
          : `${remaining.length} scheduled days look empty`}
      </h2>
      <p className="mt-1 text-sm" style={{ color: "var(--fg-2)" }}>
        No ROs or clocked hours on these workdays. They&apos;re left out of
        your efficiency until you settle them — a day off is excluded, a real
        zero counts against it.
      </p>
      <ul className="mt-3" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {shown.map((date) => (
          <li
            key={date}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            style={{ borderTop: "1px dashed var(--line-soft)", color: "var(--fg-1)" }}
          >
            <span className="tabular">{formatDateLong(date)}</span>
            <span className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busyDate !== null}
                onClick={() => resolve(date, "day-off")}
              >
                {busyDate === date ? "Saving…" : "Day off"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busyDate !== null}
                onClick={() => resolve(date, "worked-zero")}
              >
                Worked, zero flag
              </button>
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-1 text-sm" style={{ color: "var(--fg-3)" }}>
          …and {hidden} more once these are settled.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
