import type { Stats } from "@/lib/stats";
import { fmtHours, fmtPct, efficiencyTier } from "@/lib/stats";
import { efficiencyDisplay } from "@/lib/efficiency-display";
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
  stats: Stats & {
    denomSource?: DenomSource | null;
    unpairedFlagHours?: number;
    unpairedDays?: number;
  };
  highlighted?: boolean;
}) {
  /**
   * The percentage and the flag-hours figure above it are two views of the same
   * period, so a tile that prints "36.0h" over "0% efficiency" contradicts
   * itself in the space of one card — the sharpest form of the bug fixed in the
   * hero next door (`zero-efficiency-hero-copy`). Same classifier, so the two
   * surfaces cannot drift apart.
   *
   * The dashboard stays a glance: when the figure is withheld this reuses the
   * clocked-hours line the tile ALREADY falls back to when efficiency is null,
   * rather than growing an explanation. The "why" belongs on /pay-period, which
   * owns the period — see memory/feedback_dashboard_stays_lean.md.
   */
  const display = efficiencyDisplay(stats);
  const eff = display.kind === "shown" ? display.pct : null;
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
