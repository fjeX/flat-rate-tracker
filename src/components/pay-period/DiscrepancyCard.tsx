"use client";

import { useState, useTransition } from "react";
import type { Stats } from "@/lib/stats";
import { fmtHours } from "@/lib/stats";
import { setPaidPeriodHoursAction } from "@/app/actions/paid-periods";
import { toText, parseHours, verdictFor } from "@/lib/discrepancy";

export function DiscrepancyCard({
  periodKey,
  stats,
  initialPaid,
}: {
  periodKey: string;
  stats: Stats;
  initialPaid: number | null;
}) {
  const [paidText, setPaidText] = useState<string>(toText(initialPaid));
  const [savedPaid, setSavedPaid] = useState<number | null>(initialPaid);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const parsedPaid = parseHours(paidText);
  const logged = stats.flagHours;
  const verdict = verdictFor(parsedPaid, logged);
  const dirty = parsedPaid !== null && parsedPaid !== savedPaid;

  function commit() {
    if (!dirty || parsedPaid === null) return;
    setError(null);
    const value = parsedPaid;
    startTransition(async () => {
      try {
        await setPaidPeriodHoursAction(periodKey, value);
        setSavedPaid(value);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  }

  const diff = parsedPaid === null ? null : parsedPaid - logged;

  const diffColor =
    verdict === "missing"
      ? "text-[var(--bad)]"
      : verdict === "over"
        ? "text-[var(--warn)]"
        : verdict === "match"
          ? "text-[var(--good)]"
          : "text-[var(--fg-3)]";

  return (
    <section className="card padded-lg space-y-3">
      <h2 className="text-sm font-medium">
        Pay Discrepancy Check
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="field-label">
            Actual paid flag hrs
          </span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={paidText}
            onChange={(e) => setPaidText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="—"
            className="input mt-1 text-lg font-semibold"
          />
        </label>
        <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
          <div className="field-label">
            Logged flag hrs
          </div>
          <div className="mt-1 text-lg font-semibold text-[var(--fg-1)]">
            {fmtHours(logged)}h
          </div>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
          <div className="field-label">
            Difference
          </div>
          <div className={`mt-1 text-lg font-semibold ${diffColor}`}>
            {diff === null
              ? "—"
              : `${diff > 0 ? "+" : ""}${fmtHours(diff)}h`}
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-[var(--bad)]">{error}</p>}
      {!error && isPending && (
        <p className="text-xs text-[var(--fg-3)]">Saving…</p>
      )}
      {!error && !isPending && dirty && (
        <p className="text-xs text-[var(--fg-3)]">
          Press enter or click away to save
        </p>
      )}

      {verdict === "missing" && diff !== null && (
        <div className="rounded-[var(--radius-sm)] bg-[var(--bad-bg)] px-3 py-2 text-sm text-[var(--bad)]">
          Missing {fmtHours(-diff)} hours. Review the RO list below — use the
          logged ROs as proof when you talk to your service manager.
        </div>
      )}
    </section>
  );
}
