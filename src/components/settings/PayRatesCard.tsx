"use client";

import { useState, useTransition } from "react";
import {
  setLaborRatesAction,
  setDefaultLaborTypeAction,
} from "@/app/actions/labor-rates";
import { LABOR_TYPES, LABOR_TYPE_LABELS } from "@/lib/earnings";
import type { LaborRate, LaborType } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SettingRow } from "./SettingRow";

type RateInputs = Record<LaborType, string>;

function toInputs(rates: LaborRate[]): RateInputs {
  const inputs = {} as RateInputs;
  for (const t of LABOR_TYPES) inputs[t] = "";
  for (const r of rates) {
    if (r.hourlyRate > 0) inputs[r.laborType] = String(r.hourlyRate);
  }
  return inputs;
}

// Parse an input string to a positive rate, null (blank = unset), or NaN (bad).
function parseRate(val: string): number | null | typeof NaN {
  const trimmed = val.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 9999) return NaN;
  return n;
}

export function PayRatesCard({
  initialRates,
  initialDefaultLaborType,
}: {
  initialRates: LaborRate[];
  initialDefaultLaborType: LaborType | null;
}) {
  const [inputs, setInputs] = useState<RateInputs>(() => toInputs(initialRates));
  const [committed, setCommitted] = useState<RateInputs>(() => toInputs(initialRates));
  const [defaultType, setDefaultType] = useState<LaborType | "">(
    initialDefaultLaborType ?? "",
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [defaultPending, startDefaultTransition] = useTransition();

  const dirty = LABOR_TYPES.some((t) => inputs[t] !== committed[t]);
  const anyInvalid = LABOR_TYPES.some((t) => Number.isNaN(parseRate(inputs[t])));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || anyInvalid) return;
    setError(null);
    const payload = LABOR_TYPES.map((t) => ({
      laborType: t,
      hourlyRate: parseRate(inputs[t]) as number | null,
    }));
    startTransition(async () => {
      try {
        await setLaborRatesAction(payload);
        setCommitted({ ...inputs });
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

  function handleDefaultChange(value: string) {
    const next = value === "" ? null : (value as LaborType);
    setDefaultType(next ?? "");
    startDefaultTransition(async () => {
      try {
        await setDefaultLaborTypeAction(next);
      } catch {
        // Non-blocking convenience setting — revert the select on failure.
        setDefaultType(initialDefaultLaborType ?? "");
      }
    });
  }

  return (
    <>
      <SettingRow
        titleAs="h2"
        title="Pay Rates"
        wide
        description="Your hourly rate for each type of labor. Leave a row blank if it doesn't apply. Once any rate is set, earnings show up on the dashboard, pay period, and each RO. Warranty usually pays less than customer pay — that gap is what the warranty-loss figure measures."
      >
        <form onSubmit={handleSubmit}>
          <ul className="stg-rates">
            {LABOR_TYPES.map((t) => {
              const invalid = Number.isNaN(parseRate(inputs[t]));
              return (
                <li key={t}>
                  <label htmlFor={`rate-${t}`}>{LABOR_TYPE_LABELS[t]}</label>
                  <span className="stg-money">
                    <span className="stg-cur" aria-hidden="true">$</span>
                    <Input
                      id={`rate-${t}`}
                      type="number"
                      min={0}
                      max={9999}
                      step={0.5}
                      inputMode="decimal"
                      mono
                      className="is-money"
                      value={inputs[t]}
                      onChange={(e) => {
                        setInputs((prev) => ({ ...prev, [t]: e.target.value }));
                        setSaved(false);
                        setError(null);
                      }}
                      aria-invalid={invalid}
                      placeholder="—"
                    />
                    <span className="stg-unit">/hr</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="stg-actions">
            <Button type="submit" variant="go" disabled={!dirty || anyInvalid || pending} saved={saved}>
              {pending ? "Saving…" : saved ? "Saved ✓" : "Save rates"}
            </Button>
            {anyInvalid && <span className="stg-note is-bad" style={{ margin: 0 }}>Rates must be between 0 and 9999.</span>}
          </div>
          {error && (
            <p role="alert" className="stg-note is-bad">
              {error}
            </p>
          )}
        </form>
      </SettingRow>

      <SettingRow
        titleAs="h2"
        title="Default type for new lines"
        description="The labor type a new line starts on. Change it on the line whenever a job is different."
      >
        <Field label="Default type" htmlFor="default-labor-type" labelHidden>
          <select
            id="default-labor-type"
            value={defaultType}
            onChange={(e) => handleDefaultChange(e.target.value)}
            disabled={defaultPending}
            className="input"
          >
            <option value="">None (untyped)</option>
            {LABOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {LABOR_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      </SettingRow>
    </>
  );
}
