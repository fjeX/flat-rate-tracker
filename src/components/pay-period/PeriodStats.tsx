import type { Stats } from "@/lib/stats";
import { fmtHours, fmtPct } from "@/lib/stats";
import type { DenomSource } from "@/lib/types";
import { fmtMoney } from "@/lib/earnings";
import { EntranceGrid } from "@/components/ui/EntranceGrid";

function Cell({
  label,
  value,
  highlighted = false,
}: {
  label: string;
  value: string;
  highlighted?: boolean;
}) {
  return (
    <div className={`stat${highlighted ? " featured" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular">{value}</div>
    </div>
  );
}

export function PeriodStats({
  stats,
  earnings = null,
  warrantyLoss = null,
  unflaggedTime = null,
}: {
  stats: Stats & { denomSource?: DenomSource | null };
  // Both null unless the user has priced rates — when null, nothing dollar-based
  // renders and the grid looks exactly as it did before this feature.
  earnings?: number | null;
  warrantyLoss?: number | null;
  // Dollar translation of the clock-vs-flag gap on a low-efficiency period. null
  // unless efficiency is below 100% AND the customer-pay rate is priced — reframes
  // the efficiency number as unflagged time with a dollar value (see wage-check).
  unflaggedTime?: { gapHours: number; dollars: number } | null;
}) {
  return (
    <div className="space-y-2">
      <EntranceGrid className="stat-grid">
        <Cell label="ROs" value={String(stats.roCount)} />
        <Cell
          label="Flag hrs"
          value={`${fmtHours(stats.flagHours)}h`}
          highlighted={earnings === null}
        />
        <Cell label="Clocked hrs" value={`${fmtHours(stats.clockedHours)}h`} />
        <Cell
          label={
            stats.denomSource === "scheduled"
              ? "Efficiency · sched"
              : stats.denomSource === "mixed"
                ? "Efficiency · mixed"
                : "Efficiency"
          }
          value={fmtPct(stats.efficiency)}
        />
        {earnings !== null && (
          <Cell label="Earnings" value={fmtMoney(earnings)} highlighted />
        )}
      </EntranceGrid>
      {unflaggedTime !== null && (
        <p className="card-inset px-3 py-2 text-xs text-[var(--fg-2)]">
          {fmtHours(unflaggedTime.gapHours)} clocked hours had no flagged work —
          at your customer-pay rate that window represents{" "}
          <span className="font-medium text-[var(--fg-1)]">
            {fmtMoney(unflaggedTime.dollars)}
          </span>{" "}
          of unflagged time.
        </p>
      )}
      {warrantyLoss !== null && warrantyLoss > 0 && (
        <p className="rounded-[var(--radius-sm)] bg-[var(--bad-bg)] px-3 py-2 text-xs text-[var(--fg-2)]">
          Warranty work cost you{" "}
          <span className="font-medium text-[var(--bad)]">{fmtMoney(warrantyLoss)}</span>{" "}
          this period versus customer-pay rates.
        </p>
      )}
    </div>
  );
}
