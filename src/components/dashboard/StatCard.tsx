import type { Stats } from "@/lib/stats";
import { fmtHours, fmtPct, efficiencyTier } from "@/lib/stats";
import type { DenomSource } from "@/lib/types";
import { RollingNumber } from "@/components/ui/RollingNumber";

// Provenance of the efficiency denominator — a clocked number needs no badge;
// an estimated one says so (that honesty is what makes the stat portfolio-grade).
const SOURCE_BADGE: Record<DenomSource, string | null> = {
  clocked: null,
  scheduled: " · sched",
  mixed: " · mixed",
};
const SOURCE_TITLE: Record<DenomSource, string> = {
  clocked: "Efficiency measured against clocked hours",
  scheduled: "Efficiency measured against scheduled hours",
  mixed: "Clocked hours where entered, scheduled hours elsewhere",
};

export function StatCard({
  label,
  stats,
  highlighted = false,
}: {
  label: string;
  stats: Stats & { denomSource?: DenomSource | null };
  highlighted?: boolean;
}) {
  const eff = stats.efficiency;
  const tier = efficiencyTier(eff);
  const source = stats.denomSource ?? null;

  return (
    <div className={`stat${highlighted ? " featured" : ""}${tier ? ` eff-${tier}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular">
        <RollingNumber value={stats.flagHours} decimals={1} /><span className="unit">h</span>
      </div>
      <div
        className={`stat-delta ${tier ?? "neutral"}`}
        title={eff !== null && source ? SOURCE_TITLE[source] : undefined}
      >
        {eff !== null
          ? `${fmtPct(eff)} eff${(source && SOURCE_BADGE[source]) ?? ""}`
          : `${fmtHours(stats.clockedHours)}h clocked`}
      </div>
    </div>
  );
}
