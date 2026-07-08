"use client";

import { useState, useTransition } from "react";
import { setReferenceRateAction } from "@/app/actions/settings";

// Parse an input string to a positive rate, null (blank = unset), or NaN (bad).
function parseRate(val: string): number | null | typeof NaN {
  const trimmed = val.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 9999) return NaN;
  return n;
}

export function ReferenceRateCard({
  initialRate,
}: {
  initialRate: number | null;
}) {
  const initialStr = initialRate === null ? "" : String(initialRate);
  const [inputVal, setInputVal] = useState(initialStr);
  const [committed, setCommitted] = useState(initialStr);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseRate(inputVal);
  const invalid = Number.isNaN(parsed);
  const dirty = !invalid && inputVal.trim() !== committed.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || invalid) return;
    setError(null);
    const value = parsed as number | null;
    startTransition(async () => {
      try {
        await setReferenceRateAction(value);
        setCommitted(inputVal.trim());
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't save — check your connection and try again.",
        );
      }
    });
  }

  return (
    <section className="card padded-lg">
      <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--fg-0)" }}>
        Reference hourly rate
      </h2>
      <p className="mb-5 text-sm" style={{ color: "var(--fg-2)" }}>
        Compare your effective hourly pay against a rate you choose — for example,
        your local minimum wage. It shows up as a comparison on the pay period&apos;s
        Pay Check-Up. Leave it blank to skip the comparison. Minimum wage varies by
        city, county, and state and changes every year — look up the current figure
        on the{" "}
        <a
          href="https://www.dir.ca.gov/dlse/faq_minimumwage.htm"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          style={{ color: "var(--brand)" }}
        >
          California DIR minimum wage page
        </a>
        .
      </p>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="referenceRate"
          className="whitespace-nowrap text-sm"
          style={{ color: "var(--fg-1)" }}
        >
          Reference rate
        </label>
        <div className="flex items-center gap-1">
          <span style={{ color: "var(--fg-3)" }}>$</span>
          <input
            id="referenceRate"
            type="number"
            min={0}
            max={9999}
            step={0.25}
            inputMode="decimal"
            value={inputVal}
            onChange={(e) => {
              setInputVal(e.target.value);
              setSaved(false);
              setError(null);
            }}
            aria-invalid={invalid}
            aria-describedby={error ? "referenceRate-error" : undefined}
            placeholder="—"
            className="input mono w-24 text-right tabular-nums"
          />
          <span className="text-xs" style={{ color: "var(--fg-3)" }}>
            /hr
          </span>
        </div>
        <button
          type="submit"
          disabled={!dirty || invalid || pending}
          className="btn btn-primary"
        >
          {pending ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
        {invalid && (
          <span className="text-sm" style={{ color: "var(--bad)" }}>
            Rate must be between 0 and 9999.
          </span>
        )}
        {error && (
          <p
            id="referenceRate-error"
            role="alert"
            className="w-full text-sm"
            style={{ color: "var(--bad)" }}
          >
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
