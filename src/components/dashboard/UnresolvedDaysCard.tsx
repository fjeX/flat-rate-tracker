"use client";

// Empty scheduled workdays awaiting a decision (schedule-based efficiency
// plan). These days are held OUT of efficiency until resolved, so a
// forgotten vacation mark can't silently tank the number — but a real slow
// day, once confirmed, honestly counts its full scheduled hours.
//
// Phase 2 adds a THIRD answer, "Worked — unpaid". The original two forced a
// lie on the most common kind of empty day in a flat-rate shop: you were there
// all day on a comeback, or waiting on parts, and flagged nothing. "Day off"
// poisons schedule inference; "Worked, zero flag" tanks the day with no record
// of why. The third option counts the day as worked (same marker as the second)
// AND writes a ledger row saying where the hours went.
import { useState, useTransition } from "react";
import { resolveZeroDayAction } from "@/app/actions/schedule";
import { formatDateLong } from "@/lib/periods";
import type { UnpaidTimeKind } from "@/lib/types";

const SHOW_LIMIT = 5;

// The kinds that plausibly explain a whole empty scheduled day. rework_same_visit
// is deliberately absent — it happens inside a day that DID flag hours, so it
// never explains a zero day on its own.
const ZERO_DAY_REASONS: { kind: UnpaidTimeKind; label: string }[] = [
  { kind: "comeback_own", label: "Comeback — my work" },
  { kind: "comeback_other", label: "Comeback — another tech's" },
  { kind: "wait_parts", label: "Waiting on parts" },
  { kind: "wait_approval", label: "Waiting on approval" },
  { kind: "shop_time", label: "Shop time / no work dispatched" },
];

export function UnresolvedDaysCard({ days }: { days: string[] }) {
  const [remaining, setRemaining] = useState(days);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Which day (if any) has the unpaid capture form open, plus its draft.
  const [unpaidDate, setUnpaidDate] = useState<string | null>(null);
  const [unpaidHours, setUnpaidHours] = useState("");
  const [unpaidKind, setUnpaidKind] = useState<UnpaidTimeKind>("comeback_own");
  const [unpaidNote, setUnpaidNote] = useState("");

  if (remaining.length === 0) return null;

  function closeUnpaid() {
    setUnpaidDate(null);
    setUnpaidHours("");
    setUnpaidKind("comeback_own");
    setUnpaidNote("");
  }

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

  function submitUnpaid(date: string) {
    const hours = Number(unpaidHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      setError("Enter how many hours the day actually took.");
      return;
    }
    setError(null);
    setBusyDate(date);
    startTransition(async () => {
      try {
        await resolveZeroDayAction(date, "worked-unpaid", {
          hours,
          kind: unpaidKind,
          note: unpaidNote,
        });
        setRemaining((prev) => prev.filter((d) => d !== date));
        closeUnpaid();
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
        zero counts against it, and unpaid work counts the day while recording
        where the hours went.
      </p>
      <ul className="mt-3" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {shown.map((date) => (
          <li
            key={date}
            className="py-2 text-sm"
            style={{ borderTop: "1px dashed var(--line-soft)", color: "var(--fg-1)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="tabular">{formatDateLong(date)}</span>
              <span className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busyDate !== null}
                  onClick={() => resolve(date, "day-off")}
                >
                  {busyDate === date && unpaidDate !== date ? "Saving…" : "Day off"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busyDate !== null}
                  onClick={() => resolve(date, "worked-zero")}
                >
                  Worked, zero flag
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busyDate !== null}
                  aria-expanded={unpaidDate === date}
                  onClick={() =>
                    unpaidDate === date ? closeUnpaid() : setUnpaidDate(date)
                  }
                >
                  Worked — unpaid
                </button>
              </span>
            </div>

            {unpaidDate === date && (
              <div
                className="mt-2 rounded-lg p-3"
                style={{
                  background: "var(--warn-bg)",
                  border:
                    "1px solid color-mix(in oklab, var(--warn) 35%, transparent)",
                }}
              >
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label
                      htmlFor={`unpaid-hours-${date}`}
                      className="mb-1 block text-xs"
                      style={{ color: "var(--fg-3)" }}
                    >
                      Hours
                    </label>
                    <input
                      id={`unpaid-hours-${date}`}
                      type="number"
                      min={0}
                      max={24}
                      step={0.25}
                      inputMode="decimal"
                      value={unpaidHours}
                      onChange={(e) => setUnpaidHours(e.target.value)}
                      className="input"
                      style={{ width: 88 }}
                      placeholder="8"
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 190 }}>
                    <label
                      htmlFor={`unpaid-kind-${date}`}
                      className="mb-1 block text-xs"
                      style={{ color: "var(--fg-3)" }}
                    >
                      Where the time went
                    </label>
                    <select
                      id={`unpaid-kind-${date}`}
                      value={unpaidKind}
                      onChange={(e) =>
                        setUnpaidKind(e.target.value as UnpaidTimeKind)
                      }
                      className="input"
                      style={{ width: "100%" }}
                    >
                      {ZERO_DAY_REASONS.map((r) => (
                        <option key={r.kind} value={r.kind}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label
                  htmlFor={`unpaid-note-${date}`}
                  className="mb-1 mt-2 block text-xs"
                  style={{ color: "var(--fg-3)" }}
                >
                  Note (optional)
                </label>
                <input
                  id={`unpaid-note-${date}`}
                  type="text"
                  value={unpaidNote}
                  onChange={(e) => setUnpaidNote(e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="RO 48213 back for the same leak"
                />

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyDate !== null}
                    onClick={() => submitUnpaid(date)}
                  >
                    {busyDate === date ? "Saving…" : "Save unpaid day"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busyDate !== null}
                    onClick={closeUnpaid}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
