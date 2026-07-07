import type { Stats } from "@/lib/stats";
import { fmtHours, fmtPct } from "@/lib/stats";
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

export function PeriodStats({ stats }: { stats: Stats }) {
  return (
    <EntranceGrid className="stat-grid">
      <Cell label="ROs" value={String(stats.roCount)} />
      <Cell
        label="Flag hrs"
        value={`${fmtHours(stats.flagHours)}h`}
        highlighted
      />
      <Cell label="Clocked hrs" value={`${fmtHours(stats.clockedHours)}h`} />
      <Cell label="Efficiency" value={fmtPct(stats.efficiency)} />
    </EntranceGrid>
  );
}
