"use client";

import { useState, useTransition } from "react";
import { setReferenceRateAction } from "@/app/actions/settings";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SettingRow } from "./SettingRow";

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
    <SettingRow
      titleAs="h2"
      title="Reference hourly rate"
      description={
        <>
          Compare your effective hourly pay against a rate you choose — for
          example, your local minimum wage. It shows up as a comparison on the
          pay period&apos;s Pay Check-Up. Leave it blank to skip the comparison.
          Minimum wage varies by city, county, and state and changes every year —
          look up the current figure on the{" "}
          <a
            href="https://www.dir.ca.gov/dlse/faq_minimumwage.htm"
            target="_blank"
            rel="noopener noreferrer"
          >
            California DIR minimum wage page
          </a>
          .
        </>
      }
    >
      <form onSubmit={handleSubmit} className="stg-inline">
        <Field label="Reference rate" htmlFor="referenceRate">
          <span className="stg-money">
            <span className="stg-cur" aria-hidden="true">$</span>
            <Input
              id="referenceRate"
              type="number"
              min={0}
              max={9999}
              step={0.25}
              inputMode="decimal"
              mono
              className="is-money"
              value={inputVal}
              onChange={(e) => {
                setInputVal(e.target.value);
                setSaved(false);
                setError(null);
              }}
              aria-invalid={invalid}
              aria-describedby={error ? "referenceRate-error" : undefined}
              placeholder="—"
            />
            <span className="stg-unit">/hr</span>
          </span>
        </Field>
        <Button type="submit" variant="go" disabled={!dirty || invalid || pending} saved={saved}>
          {pending ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </Button>
        {invalid && (
          <p className="stg-note is-bad" style={{ flexBasis: "100%" }}>
            Rate must be between 0 and 9999.
          </p>
        )}
        {error && (
          <p id="referenceRate-error" role="alert" className="stg-note is-bad" style={{ flexBasis: "100%" }}>
            {error}
          </p>
        )}
      </form>
    </SettingRow>
  );
}
