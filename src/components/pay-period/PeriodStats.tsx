import type { Stats } from "@/lib/stats";
import { fmtHours, fmtPct } from "@/lib/stats";

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
    <div
      className={`rounded-xl border p-3 ${
        highlighted
          ? "border-orange-900/60 bg-gradient-to-br from-orange-950/60 to-red-950/40"
          : "border-zinc-800 bg-zinc-900"
      }`}
    >
      <div
        className={`text-[10px] uppercase tracking-wide ${
          highlighted ? "text-orange-300/80" : "text-zinc-500"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-semibold ${
          highlighted ? "text-orange-300" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export function PeriodStats({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Cell label="ROs" value={String(stats.roCount)} />
      <Cell
        label="Flag hrs"
        value={`${fmtHours(stats.flagHours)}h`}
        highlighted
      />
      <Cell label="Clocked hrs" value={`${fmtHours(stats.clockedHours)}h`} />
      <Cell label="Efficiency" value={fmtPct(stats.efficiency)} />
    </div>
  );
}
