import type { CSSProperties, ReactNode } from "react";
import type { Stats, UnpairedByReason } from "@/lib/stats";
import {
  fmtHours,
  fmtPct,
  unpairedNoteClause,
  unpairedNotes,
} from "@/lib/stats";
import { efficiencyDisplay } from "@/lib/efficiency-display";
import type { DenomSource } from "@/lib/types";
import { fmtMoney } from "@/lib/earnings";
import { withPt } from "@/components/ui/Figure";
import {N} from "./PpParts";
import { StatusField } from "@/components/ui/StatusField";

// One cell of the spec row (mock `.spec`): a label over a figure, with an
// optional small line under the figure. `unit` is a word, so it stays on the UI
// font; the figure itself is set in the figure font.
function Cell({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  /** Small line under the figure — context that would otherwise need a tile. */
  sub?: ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="num">
        {withPt(value)}
        {unit && <span className="unit">{unit}</span>}
        {sub && <small className="sub">{sub}</small>}
      </dd>
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
    // WHY those hours weren't counted, split four ways by the pairing rule.
    // Without it the caption below said "no clocked hours and no schedule" for
    // a shift that was simply still running — sending the tech to fix a day
    // that isn't broken. Optional for the same reason the pair above is: the
    // no-schedule path passes a plain Stats, and a snapshot's frozen blob has
    // the flat numbers only. Both fall back to the original single sentence.
    unpairedByReason?: UnpairedByReason;
  };
  // The in-progress and awaiting-pay heroes already carry flagged hours as
  // their headline figure, so repeating it directly underneath is noise. The
  // settled hero shows the shortfall instead, and there the line still earns
  // its place.
  hideFlagHours?: boolean;
  // Both null unless the user has priced rates — when null, nothing dollar-based
  // renders.
  earnings?: number | null;
  warrantyLoss?: number | null;
  // Dollar translation of the clock-vs-flag gap on a low-efficiency period. null
  // unless efficiency is below 100% AND the customer-pay rate is priced — reframes
  // the efficiency number as unflagged time with a dollar value (see wage-check).
  unflaggedTime?: { gapHours: number; dollars: number } | null;
}) {
  /**
   * Same classifier as the hero directly above this block.
   *
   * PayPeriodView renders PeriodHero and PeriodStats as siblings in one zone,
   * so before this gate the zone said both of these at once, one element apart
   * (2026-08-19, the escalated case):
   *
   *     No efficiency yet — all 42.0h flagged so far landed on 2 days
   *     with no hours to measure them against.
   *     ROs 2   Hours · sched 8.0h   Efficiency · sched 0%
   *
   * The hero withholding a figure the tile beside it prints is worse than
   * neither withholding it — it reads as the app disagreeing with itself. One
   * classifier, both surfaces, no drift
   * (memory/feedback_duplicate_derivations_drift.md).
   */
  const eff = efficiencyDisplay(stats);

  // The spec row is ROs, hours, efficiency and (once an upsell is marked)
  // upsold. Flag hours and earnings are dollars-and-hours headlines, so they
  // stand above it as rows, the way the mock puts Earnings.
  //
  // Upsold: self-hiding. A tech who has never marked an upsell sees the row
  // exactly as it was. Once one is marked it stays visible even at 0.0h,
  // because a period where you sold nothing is the comparison.
  const showUpsold = stats.upsellHours > 0;
  const cols = 3 + (showUpsold ? 1 : 0);
  const notes = unpairedNotes(stats.unpairedByReason, {
    flagHours: stats.unpairedFlagHours ?? 0,
    days: stats.unpairedDays ?? 0,
  });
  const hasRemarks =
    notes.length > 0 ||
    unflaggedTime !== null ||
    (warrantyLoss !== null && warrantyLoss > 0);

  return (
    <div className="pp-stats">
      {(!hideFlagHours || earnings !== null) && (
        <dl className="pp-rows pp-after-head">
          {!hideFlagHours && (
            <div>
              <dt className="k">Flag hrs</dt>
              <dd className="v is-fig num">
                {withPt(fmtHours(stats.flagHours))}
                <span className="pp-unit">h</span>
              </dd>
            </div>
          )}
          {earnings !== null && (
            <div>
              <dt className="k">Earnings</dt>
              <dd className="v is-fig num">{withPt(fmtMoney(earnings))}</dd>
            </div>
          )}
        </dl>
      )}

      <dl className="spec" style={{ "--spec-cols": cols } as CSSProperties}>
        <Cell label="ROs" value={String(stats.roCount)} />
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
          value={fmtHours(stats.denomHours ?? stats.clockedHours)}
          unit="h"
        />
        <Cell
          label={
            stats.denomSource === "scheduled"
              ? "Efficiency · sched"
              : stats.denomSource === "mixed"
                ? "Efficiency · mixed"
                : "Efficiency"
          }
          /* Withheld reuses the em dash `fmtPct(null)` already prints for an
             absent figure — no new state to learn, and no second copy of the
             explanation. The "Not counted above" note below renders for a
             strict superset of this state (it fires on any unpaired hours at
             all), so the reason is always on screen with the dash. */
          value={eff.kind === "shown" ? fmtPct(eff.pct) : fmtPct(null)}
        />
        {showUpsold && (
          <Cell
            label="Upsold"
            value={fmtHours(stats.upsellHours)}
            unit="h"
            // The share, not a second total. Upsold hours are already inside
            // Flag hrs, and printing them as a peer invites adding the two.
            sub={
              stats.flagHours > 0
                ? `${Math.round((stats.upsellHours / stats.flagHours) * 100)}% of flagged`
                : undefined
            }
          />
        )}
      </dl>

      {hasRemarks && (
        <div className="pp-remarks">
          {/* One note per REASON, not one note for all of them. A period can
              hold both kinds at once — a Saturday nobody clocked and a shift
              still running — and collapsing them into a single sentence is what
              made this line tell the tech to schedule a day that was simply not
              over yet. The clause comes from lib/stats so /insights prints the
              identical wording; the sentence used to be duplicated byte-for-byte
              in two files, which is how one of them could have been fixed
              alone. */}
          {notes.map((note) => (
            <StatusField tag="Note" key={note.kind}><p>
              Not counted above: <N v={`${fmtHours(note.flagHours)}h`} /> flagged
              across {note.days} {note.days === 1 ? "day" : "days"}{" "}
              {/* The {" "} above is load-bearing. Text that follows an
                  expression container loses its leading space in the JSX
                  transform, which shipped this caption reading "1 daywith no
                  clocked hours". InsightsView's copy of this caption uses
                  explicit separators for the same reason — match it, don't rely
                  on the source newline. */}
              {unpairedNoteClause(note, "period")}
            </p></StatusField>
          ))}
          {unflaggedTime !== null && (
            <StatusField tag="Note"><p>
              <N v={fmtHours(unflaggedTime.gapHours)} />
              {" "}clocked hours had no flagged work — at your customer-pay rate
              that window represents <N v={fmtMoney(unflaggedTime.dollars)} /> of
              unflagged time.
            </p></StatusField>
          )}
          {warrantyLoss !== null && warrantyLoss > 0 && (
            <StatusField tag="Cost"><p>
              Warranty work cost you <N v={fmtMoney(warrantyLoss)} className="m" />{" "}
              this period versus customer-pay rates.
            </p></StatusField>
          )}
        </div>
      )}
    </div>
  );
}
