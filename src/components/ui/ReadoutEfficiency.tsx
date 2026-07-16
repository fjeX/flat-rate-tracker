// Small "· 96% efficiency" suffix for chart readout rows. Renders only for
// day-level bars where a denominator is known (clocked hours, or scheduled
// hours on completed days) — same rules the dashboard stat tiles follow.
import { efficiencyTier, fmtPct, type DayDenom } from "@/lib/stats";

const TIER_COLOR = {
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
} as const;

export function ReadoutEfficiency({
  flagHours,
  denom,
}: {
  flagHours: number;
  denom: DayDenom | undefined;
}) {
  if (!denom || flagHours <= 0) return null;
  const eff = (flagHours / denom.hours) * 100;
  const tier = efficiencyTier(eff);
  return (
    <span
      className="r-readout-eff"
      style={{ color: tier ? TIER_COLOR[tier] : "var(--fg-3)" }}
      title={
        denom.source === "scheduled"
          ? "Efficiency measured against scheduled hours"
          : "Efficiency measured against clocked hours"
      }
    >
      {fmtPct(eff)} efficiency
    </span>
  );
}
