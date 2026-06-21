import type { Stats } from "@/lib/stats";
import { fmtHours, fmtPct, efficiencyTier } from "@/lib/stats";
import { CountUp } from "./CountUp";

export function StatCard({
  label,
  stats,
  highlighted = false,
}: {
  label: string;
  stats: Stats;
  highlighted?: boolean;
}) {
  const eff = stats.efficiency;
  const tier = efficiencyTier(eff);

  return (
    <div className={`stat${highlighted ? " featured" : ""}${tier ? ` eff-${tier}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular">
        <CountUp value={stats.flagHours} /><span className="unit">h</span>
      </div>
      <div className={`stat-delta ${tier ?? "neutral"}`}>
        {eff !== null ? `${fmtPct(eff)} eff` : `${fmtHours(stats.clockedHours)}h clocked`}
      </div>
    </div>
  );
}
