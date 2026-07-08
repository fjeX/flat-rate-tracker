"use client";

import { useState, useTransition } from "react";
import {
  setLaborRatesAction,
  setDefaultLaborTypeAction,
} from "@/app/actions/labor-rates";
import { LABOR_TYPES, LABOR_TYPE_LABELS } from "@/lib/earnings";
import type { LaborRate, LaborType } from "@/lib/types";

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
    <section className="card padded-lg">
      <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--fg-0)" }}>
        Pay Rates
      </h2>
      <p className="mb-5 text-sm" style={{ color: "var(--fg-2)" }}>
        Your hourly rate for each type of labor. Leave a row blank if it doesn&apos;t
        apply. Once any rate is set, earnings show up on the dashboard, pay period,
        and each RO. Warranty usually pays less than customer pay — that gap is what
        the warranty-loss figure measures.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        {LABOR_TYPES.map((t) => {
          const invalid = Number.isNaN(parseRate(inputs[t]));
          return (
            <div key={t} className="flex items-center gap-3">
              <label
                htmlFor={`rate-${t}`}
                className="flex-1 text-sm"
                style={{ color: "var(--fg-1)" }}
              >
                {LABOR_TYPE_LABELS[t]}
              </label>
              <div className="flex items-center gap-1">
                <span style={{ color: "var(--fg-3)" }}>$</span>
                <input
                  id={`rate-${t}`}
                  type="number"
                  min={0}
                  max={9999}
                  step={0.5}
                  inputMode="decimal"
                  value={inputs[t]}
                  onChange={(e) => {
                    setInputs((prev) => ({ ...prev, [t]: e.target.value }));
                    setSaved(false);
                    setError(null);
                  }}
                  aria-invalid={invalid}
                  placeholder="—"
                  className="input mono w-24 text-right tabular-nums"
                />
                <span className="text-xs" style={{ color: "var(--fg-3)" }}>/hr</span>
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!dirty || anyInvalid || pending}
            className="btn btn-primary"
          >
            {pending ? "Saving…" : saved ? "Saved ✓" : "Save rates"}
          </button>
          {anyInvalid && (
            <span className="text-sm" style={{ color: "var(--bad)" }}>
              Rates must be between 0 and 9999.
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}
      </form>

      <div
        className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4"
        style={{ borderColor: "var(--line)" }}
      >
        <label
          htmlFor="default-labor-type"
          className="text-sm"
          style={{ color: "var(--fg-1)" }}
        >
          Default type for new lines
        </label>
        <select
          id="default-labor-type"
          value={defaultType}
          onChange={(e) => handleDefaultChange(e.target.value)}
          disabled={defaultPending}
          className="input text-sm"
        >
          <option value="">None (untyped)</option>
          {LABOR_TYPES.map((t) => (
            <option key={t} value={t}>
              {LABOR_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
