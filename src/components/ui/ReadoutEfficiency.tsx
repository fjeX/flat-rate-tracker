// Small "· 96% efficiency" suffix for chart readout rows. Renders for any bar
// (day, week, pay period, month) where a denominator is known (clocked hours,
// or scheduled hours on completed days) — same rules the dashboard stat tiles
// follow; a multi-day bar's inputs come from spanEfficiency.
import { efficiencyTier, fmtHours, fmtPct, type SpanDenom } from "@/lib/stats";
import { efficiencyDisplay } from "@/lib/efficiency-display";

const SOURCE_TITLE = {
  clocked: "Efficiency measured against clocked hours",
  scheduled: "Efficiency measured against scheduled hours",
  mixed: "Efficiency measured against clocked hours, and scheduled hours on days with no clock",
} as const;

const TIER_COLOR = {
  good: "var(--good)",
  warn: "var(--ink-2)",
  bad: "var(--bad)",
} as const;

export function ReadoutEfficiency({
  flagHours,
  denom,
  unpairedFlagHours = 0,
  unpairedDays = 0,
}: {
  /** Flag hours on the counted days (the numerator). */
  flagHours: number;
  denom: SpanDenom | undefined;
  /** Flag hours / days inside the bar that had no hours to measure them
   * against. Passed for multi-day bars; the same gate /pay-period uses
   * (efficiencyDisplay) decides whether the percentage prints. */
  unpairedFlagHours?: number;
  unpairedDays?: number;
}) {
  if (!denom) return null;
  if (flagHours <= 0 && unpairedFlagHours <= 0) return null;
  const eff = (flagHours / denom.hours) * 100;
  const display = efficiencyDisplay({
    flagHours: flagHours + unpairedFlagHours,
    efficiency: eff,
    unpairedFlagHours,
    unpairedDays,
  });
  if (display.kind === "all_excluded" || display.kind === "mostly_excluded") {
    // No percentage — and, because a chart readout has no neighbouring card to
    // explain the gap, one short line saying what was left out.
    const days = display.days === 1 ? "a day" : `${display.days} days`;
    return (
      <span
        className="r-readout-eff r-readout-eff-withheld"
        style={{ color: "var(--ink-3)" }}
        title="Efficiency isn't shown: most of this bar's flagged work landed on days with no hours to measure it against"
      >
        Not counted: {fmtHours(display.excludedHours)}h on {days} with no hours to measure
      </span>
    );
  }
  if (display.kind !== "shown") return null;
  const tier = efficiencyTier(eff);
  return (
    <span
      className="r-readout-eff"
      style={{ color: tier ? TIER_COLOR[tier] : "var(--ink-3)" }}
      title={SOURCE_TITLE[denom.source]}
    >
      {fmtPct(eff)} efficiency
    </span>
  );
}
