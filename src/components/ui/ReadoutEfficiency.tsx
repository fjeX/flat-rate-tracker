// Small "· 96% efficiency" suffix for chart readout rows. Renders for any bar
// (day, week, pay period, month) where a denominator is known (clocked hours,
// or scheduled hours on completed days) — same rules the dashboard stat tiles
// follow; a multi-day bar's inputs come from spanEfficiency.
import { efficiencyTier, fmtPct, type SpanDenom } from "@/lib/stats";

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
}: {
  flagHours: number;
  denom: SpanDenom | undefined;
}) {
  if (!denom || flagHours <= 0) return null;
  const eff = (flagHours / denom.hours) * 100;
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
