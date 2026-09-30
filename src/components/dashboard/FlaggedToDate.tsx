import type { ReactNode } from "react";
import type { Stats } from "@/lib/stats";
import { fmtHours, fmtPct, efficiencyTier } from "@/lib/stats";
import { efficiencyDisplay } from "@/lib/efficiency-display";
import type { DenomSource } from "@/lib/types";
import { Head } from "@/components/ui/Card";
import { withPt } from "@/components/ui/Figure";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { Zone } from "@/components/ui/Zone";

// Provenance of the efficiency denominator lives in the hover title — the
// visible cell just says the percentage.
const SOURCE_TITLE: Record<DenomSource, string> = {
  clocked: "Efficiency measured against clocked hours",
  scheduled: "Efficiency measured against scheduled hours",
  mixed: "Clocked hours where entered, scheduled hours elsewhere",
};

// What to call the hours the fallback prints. Same vocabulary the PeriodStats
// tile uses for the identical figure, so the dashboard and /pay-period name the
// denominator the same way.
const DENOM_WORD: Record<DenomSource, string> = {
  clocked: "clocked",
  scheduled: "scheduled",
  mixed: "clocked + scheduled",
};

export type SpanStats = Stats & {
  denomSource?: DenomSource | null;
  denomHours?: number;
  unpairedFlagHours?: number;
  unpairedDays?: number;
};

/**
 * One row of the Flagged to date table.
 *
 * The percentage and the flag-hours figure beside it are two views of the same
 * span, so a row that prints "36.0h" next to "0%" contradicts itself in the
 * space of one line (`zero-efficiency-hero-copy`). Same classifier as the
 * Pay Period page, so the two surfaces cannot drift apart. When the figure is
 * withheld, the cell falls back to the hours the percentage would have been
 * divided by. That is the DENOMINATOR (`denomHours`), not the raw clock rows:
 * on a schedule-driven period `clockedHours` is 0.0 and the row would say
 * "36.0h" next to "0.0h clocked", swapping one contradiction for another.
 * The "why" belongs on /pay-period, which owns the period detail.
 */
function SpanRow({ label, stats }: { label: string; stats: SpanStats }) {
  const display = efficiencyDisplay(stats);
  const eff = display.kind === "shown" ? display.pct : null;
  const tier = efficiencyTier(eff);
  const source = stats.denomSource ?? null;
  const denomHours = stats.denomHours ?? stats.clockedHours;
  const tierClass = tier === "good" ? "is-good" : tier === "bad" ? "is-bad" : undefined;
  return (
    <>
      <tr>
        <th scope="row">{label}</th>
        <td className="num">
          <RollingNumber value={fmtHours(stats.flagHours)}>
            <span className="unit">h</span>
          </RollingNumber>
        </td>
        <td
          className={`num${tierClass ? ` ${tierClass}` : ""}`}
          title={eff !== null ? SOURCE_TITLE[source ?? "clocked"] : undefined}
        >
          {eff !== null ? (
            withPt(fmtPct(eff))
          ) : (
            <span className="tbl-alt">
              <span className="num">{withPt(fmtHours(denomHours))}h</span> {DENOM_WORD[source ?? "clocked"]}
            </span>
          )}
        </td>
      </tr>
      {/* Attribution BESIDE the flag figure, never in it (Open Tickets,
          decision 7): hours worked on tickets whose flag hasn't landed yet.
          Absent when zero — a quiet row stays quiet. */}
      {stats.openTicketHours > 0 && (
        <tr className="tbl-sub">
          <td colSpan={3} data-testid="open-ticket-line">
            <span className="num">{withPt(fmtHours(stats.openTicketHours))}h</span> on{" "}
            <span className="num">{stats.openTicketCount}</span> open ticket
            {stats.openTicketCount === 1 ? "" : "s"}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Flagged to date: this week, this pay period and this month on one plate,
 * with the dollar line under it when the tech has priced a rate. `children`
 * are extra rows and notes that belong to the same money story (the lifetime
 * dispute recovery).
 */
export function FlaggedToDate({
  week,
  period,
  month,
  earnings,
  children,
}: {
  week: SpanStats;
  period: SpanStats;
  month: SpanStats;
  /** Formatted period earnings, or null when no rate is priced. */
  earnings: string | null;
  children?: ReactNode;
}) {
  return (
    <Zone id="z-tot" name="Flagged to date">
      <Head>
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Span</th>
              <th scope="col">Flagged</th>
              <th scope="col">Efficiency</th>
            </tr>
          </thead>
          <tbody>
            <SpanRow label="This Week" stats={week} />
            <SpanRow label="Pay Period" stats={period} />
            <SpanRow label="This Month" stats={month} />
          </tbody>
        </table>
      </Head>
      {earnings !== null && (
        <div className="rows after-head">
          <div>
            <span className="k">Period earnings</span>
            <span className="v num">{withPt(earnings)}</span>
          </div>
        </div>
      )}
      {children}
    </Zone>
  );
}
