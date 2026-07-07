"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Entry, OpCode } from "@/lib/types";
import type { PeriodRange } from "@/lib/periods";
import type { Stats } from "@/lib/stats";
import { formatPeriodLabel } from "@/lib/periods";
import { clearPeriodOverrideAction } from "@/app/actions/settings";
import { RoList } from "@/components/ro/RoList";
import { DiscrepancyCard } from "./DiscrepancyCard";
import { PeriodOverrideModal } from "./PeriodOverrideModal";
import { PeriodStats } from "./PeriodStats";

export function PayPeriodView({
  availablePeriods,
  currentKey,
  selected,
  hasOverride,
  stats,
  paidFlagHours,
  entries,
  library,
}: {
  availablePeriods: PeriodRange[];
  currentKey: string;
  selected: PeriodRange;
  hasOverride: boolean;
  stats: Stats;
  paidFlagHours: number | null;
  entries: Entry[];
  library: OpCode[];
}) {
  const router = useRouter();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [resetting, startResetting] = useTransition();
  const [resetError, setResetError] = useState<string | null>(null);

  function pickPeriod(key: string) {
    const params = new URLSearchParams();
    params.set("period", key);
    router.push(`/pay-period?${params.toString()}`);
  }

  function resetOverride() {
    setResetError(null);
    startResetting(async () => {
      try {
        await clearPeriodOverrideAction(selected.key);
        router.refresh();
      } catch (err) {
        setResetError(
          err instanceof Error ? err.message : "Failed to reset.",
        );
      }
    });
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 pb-16">
      <h1 className="text-xl font-semibold">Pay Period</h1>

      <div className="card padded space-y-3">
        <label className="block">
          <span className="field-label">
            Period
          </span>
          <select
            value={selected.key}
            onChange={(e) => pickPeriod(e.target.value)}
            className="input mt-1 text-sm"
          >
            {availablePeriods.map((p) => (
              <option key={p.key} value={p.key}>
                {formatPeriodLabel(p)}
                {p.key === currentKey ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOverrideOpen(true)}
            className="btn btn-sm btn-ghost"
          >
            {hasOverride ? "Edit custom dates" : "Set custom dates"}
          </button>
          {hasOverride && (
            <button
              type="button"
              onClick={resetOverride}
              disabled={resetting}
              className="btn btn-sm btn-ghost"
            >
              {resetting ? "Resetting…" : "Reset to default"}
            </button>
          )}
        </div>
        {resetError && (
          <p className="rounded-md border border-[color-mix(in_oklab,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-3 py-2 text-xs text-[var(--bad)]">
            {resetError}
          </p>
        )}
      </div>

      <PeriodStats stats={stats} />

      <DiscrepancyCard
        key={selected.key}
        periodKey={selected.key}
        stats={stats}
        initialPaid={paidFlagHours}
      />

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--fg-2)]">
          ROs in this period
        </h2>
        <RoList
          entries={entries}
          library={library}
          emptyState={
            <div className="card p-6 text-center">
              <p className="text-sm text-[var(--fg-2)]">
                No ROs in this period.
              </p>
            </div>
          }
        />
      </section>

      {overrideOpen && (
        <PeriodOverrideModal
          open={overrideOpen}
          periodKey={selected.key}
          initialRange={selected}
          onClose={() => setOverrideOpen(false)}
        />
      )}
    </main>
  );
}
