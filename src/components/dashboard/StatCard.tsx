import type { Stats } from "@/lib/stats";
import { fmtHours, fmtPct, efficiencyTier } from "@/lib/stats";
import type { DenomSource } from "@/lib/types";
import { RollingNumber } from "@/components/ui/RollingNumber";

// Provenance of the efficiency denominator lives in the hover title — the
// visible line just says "efficiency" (the " · sched" badge read as noise).
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
        title={eff !== null ? SOURCE_TITLE[source ?? "clocked"] : undefined}
      >
        {eff !== null
          ? `${fmtPct(eff)} efficiency`
          : `${fmtHours(stats.clockedHours)}h clocked`}
      </div>
    </div>
  );
}
