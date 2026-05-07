import type { Stats } from "@/lib/stats";
import { fmtHours, fmtPct } from "@/lib/stats";

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
  const effGood = eff !== null && eff >= 1.0;
  const effBad  = eff !== null && eff < 0.85;

  return (
    <div className={`stat${highlighted ? " featured" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular">
        {fmtHours(stats.flagHours)}<span className="unit">h</span>
      </div>
      <div className={`stat-delta${effGood ? " good" : effBad ? " bad" : " neutral"}`}>
        {eff !== null ? `${fmtPct(eff)} eff` : `${fmtHours(stats.clockedHours)}h clocked`}
      </div>
    </div>
  );
}
