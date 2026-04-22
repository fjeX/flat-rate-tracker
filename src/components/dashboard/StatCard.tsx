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
  return (
    <div
      className={`rounded-xl border p-3 ${
        highlighted
          ? "border-orange-900/60 bg-gradient-to-br from-orange-950/60 to-red-950/40"
          : "border-zinc-800 bg-zinc-900"
      }`}
    >
      <div
        className={`text-xs uppercase tracking-wide ${
          highlighted ? "text-orange-300/80" : "text-zinc-500"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-2 text-2xl font-semibold ${
          highlighted ? "text-orange-300" : "text-zinc-100"
        }`}
      >
        {fmtHours(stats.flagHours)}h
      </div>
      <div className="mt-1 text-xs text-zinc-400">
        {fmtHours(stats.clockedHours)}h clocked · {fmtPct(stats.efficiency)} eff
      </div>
    </div>
  );
}
