import type { Stats } from "@/lib/stats";
import { fmtHours, fmtPct } from "@/lib/stats";
import type { DenomSource } from "@/lib/types";
import { fmtMoney } from "@/lib/earnings";
import { EntranceGrid } from "@/components/ui/EntranceGrid";

function Cell({
  label,
  value,
  highlighted = false,
  sub,
}: {
  label: string;
  value: string;
  highlighted?: boolean;
  /** Small line under the figure — context that would otherwise need a tile. */
  sub?: string;
}) {
  return (
    <div className={`stat${highlighted ? " featured" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular">{value}</div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-[var(--fg-3)]">{sub}</div>
      )}
    </div>
  );
}

export function PeriodStats({
  stats,
  earnings = null,
  warrantyLoss = null,
  unflaggedTime = null,
  hideFlagHours = false,
}: {
  stats: Stats & {
    denomSource?: DenomSource | null;
    denomHours?: number;
    // Flag hours on days with no denominator. Without these the hero prints
    // Flag hrs, Hours and Efficiency side by side and the division visibly
    // doesn't work — 430.1 / 72.0 is 597%, not the 397% next to it. /insights
    // has explained this since 7cbbdda; this tile went on showing the bare
    // numbers, which reads as a bug rather than as excluded days.
    unpairedFlagHours?: number;
    unpairedDays?: number;
  };
  // The in-progress and awaiting-pay heroes already carry flagged hours as
  // their headline figure, so repeating it as a tile directly underneath is
  // noise. The settled hero shows the shortfall instead, and there the tile
  // still earns its place.
  hideFlagHours?: boolean;
  // Both null unless the user has priced rates — when null, nothing dollar-based
  // renders and the grid looks exactly as it did before this feature.
  earnings?: number | null;
  warrantyLoss?: number | null;
  // Dollar translation of the clock-vs-flag gap on a low-efficiency period. null
  // unless efficiency is below 100% AND the customer-pay rate is priced — reframes
  // the efficiency number as unflagged time with a dollar value (see wage-check).
  unflaggedTime?: { gapHours: number; dollars: number } | null;
}) {
  return (
    <div className="space-y-2">
      <EntranceGrid className="stat-grid">
        <Cell label="ROs" value={String(stats.roCount)} />
        {!hideFlagHours && (
          <Cell
            label="Flag hrs"
            value={`${fmtHours(stats.flagHours)}h`}
            highlighted={earnings === null}
          />
        )}
        {/* The DENOMINATOR, not the raw clock rows.
            `stats.clockedHours` only sums daily_clock_hours entries, so on a
            schedule-driven period this tile read "0.0h" directly beside
            "Efficiency · sched 112%" — the same contradiction WorkCostCard had
            before it moved to denomHours. A scheduled workday is time you were
            at the shop whether or not you typed a clock figure, and it is
            already the denominator the efficiency beside it divides by.
            Falls back to clockedHours when there's no schedule at all. */}
        <Cell
          label={
            stats.denomSource === "scheduled"
              ? "Hours · sched"
              : stats.denomSource === "mixed"
                ? "Hours · mixed"
                : "Clocked hrs"
          }
          value={`${fmtHours(stats.denomHours ?? stats.clockedHours)}h`}
        />
        <Cell
          label={
            stats.denomSource === "scheduled"
              ? "Efficiency · sched"
              : stats.denomSource === "mixed"
                ? "Efficiency · mixed"
                : "Efficiency"
          }
          value={fmtPct(stats.efficiency)}
        />
        {/* A tile, not a card. The page was rebuilt because it had grown to nine
            cards of equal weight, and "what did I sell" is one number in the
            supporting row — not a family alongside "did I get paid" and "what
            did the work cost me".

            Self-hiding: a tech who has never marked an upsell sees the row
            exactly as it was. Once one is marked it stays visible even at 0.0h,
            because a period where you sold nothing is the comparison. */}
        {stats.upsellHours > 0 && (
          <Cell
            label="Upsold"
            value={`${fmtHours(stats.upsellHours)}h`}
            // The share, not a second total. Upsold hours are already inside
            // Flag hrs, and printing them as a peer invites adding the two.
            sub={
              stats.flagHours > 0
                ? `${Math.round((stats.upsellHours / stats.flagHours) * 100)}% of flagged`
                : undefined
            }
          />
        )}
        {earnings !== null && (
          <Cell label="Earnings" value={fmtMoney(earnings)} highlighted />
        )}
      </EntranceGrid>
      {(stats.unpairedFlagHours ?? 0) > 0 && (
        <p className="card-inset px-3 py-2 text-xs text-[var(--fg-2)]">
          Not counted above:{" "}
          <span className="font-medium text-[var(--fg-1)]">
            {fmtHours(stats.unpairedFlagHours!)}h
          </span>{" "}
          flagged across {stats.unpairedDays}{" "}
          {stats.unpairedDays === 1 ? "day" : "days"}{" "}
          {/* The {" "} above is load-bearing. Text that follows an expression
              container loses its leading space in the JSX transform, which
              shipped this caption reading "1 daywith no clocked hours".
              InsightsView's copy of this sentence uses explicit separators for
              the same reason — match it, don't rely on the source newline. */}
          with no clocked hours and no schedule — the app can&apos;t tell how
          long those days were, so they&apos;re in your flagged total but in
          neither side of the percentage. Clock them or add them to your
          schedule to include them.
        </p>
      )}
      {unflaggedTime !== null && (
        <p className="card-inset px-3 py-2 text-xs text-[var(--fg-2)]">
          {fmtHours(unflaggedTime.gapHours)} clocked hours had no flagged work —
          at your customer-pay rate that window represents{" "}
          <span className="font-medium text-[var(--fg-1)]">
            {fmtMoney(unflaggedTime.dollars)}
          </span>{" "}
          of unflagged time.
        </p>
      )}
      {warrantyLoss !== null && warrantyLoss > 0 && (
        <p className="rounded-[var(--radius-sm)] bg-[var(--bad-bg)] px-3 py-2 text-xs text-[var(--fg-2)]">
          Warranty work cost you{" "}
          <span className="font-medium text-[var(--bad)]">{fmtMoney(warrantyLoss)}</span>{" "}
          this period versus customer-pay rates.
        </p>
      )}
    </div>
  );
}
