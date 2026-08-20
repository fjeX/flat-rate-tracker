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

// What to call the hours the fallback line prints. Same vocabulary the
// PeriodStats tile uses for the identical figure, so the dashboard and
// /pay-period name the denominator the same way.
const DENOM_WORD: Record<DenomSource, string> = {
  clocked: "clocked",
  scheduled: "scheduled",
  mixed: "clocked + scheduled",
};

export function StatCard({
  label,
  stats,
  highlighted = false,
}: {
  label: string;
  stats: Stats & {
    denomSource?: DenomSource | null;
    denomHours?: number;
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
   * hours line the tile ALREADY falls back to when efficiency is null, rather
   * than growing an explanation. The "why" belongs on /pay-period, which owns
   * the period — see memory/feedback_dashboard_stays_lean.md.
   */
  const display = efficiencyDisplay(stats);
  const eff = display.kind === "shown" ? display.pct : null;
  const tier = efficiencyTier(eff);
  const source = stats.denomSource ?? null;

  // THE DENOMINATOR, not the raw clock rows — the exact bug PeriodStats.tsx
  // documents fixing for its own Hours tile. `clockedHours` only sums
  // daily_clock_hours entries, so on a schedule-driven period the fallback
  // line read "0.0h clocked" underneath a headline of 36.0h flagged: a tile
  // that withheld one contradiction and printed another. A scheduled workday
  // is time you were at the shop whether or not you typed a clock figure, and
  // it is the figure the withheld percentage would have divided by.
  // Falls back to clockedHours when there is no schedule at all.
  const denomHours = stats.denomHours ?? stats.clockedHours;

  return (
    <div className={`stat${highlighted ? " featured" : ""}${tier ? ` eff-${tier}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular">
        <RollingNumber value={fmtHours(stats.flagHours)} /><span className="unit">h</span>
      </div>
      <div
        className={`stat-delta ${tier ?? "neutral"}`}
        title={eff !== null ? SOURCE_TITLE[source ?? "clocked"] : undefined}
      >
        {eff !== null
          ? `${fmtPct(eff)} efficiency`
          : `${fmtHours(denomHours)}h ${DENOM_WORD[source ?? "clocked"]}`}
      </div>
    </div>
  );
}
