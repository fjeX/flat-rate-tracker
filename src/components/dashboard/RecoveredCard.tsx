import Link from "next/link";
import { fmtHours } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import {
  daysWaiting,
  isClosed,
  lifetimeRecovery,
  type LifetimeRecovery,
} from "@/lib/disputes";
import type { Dispute } from "@/lib/types";
import { withPt } from "@/components/ui/Figure";
import { DashIcon } from "./DashIcon";
import { StatusField } from "@/components/ui/StatusField";
import { FiguresInText } from "./Figures";

// Days a submitted claim can sit before the card nudges. A shop needs a payroll
// cycle to react; nagging on day 2 would train the tech to ignore this.
const NUDGE_AFTER_DAYS = 7;

// The headline figure: dollars when the claims were priced, hours otherwise.
// Never "$0" for an unpriced claim — that reads as "you recovered nothing".
function headline(l: LifetimeRecovery): string {
  return l.recoveredDollars !== null
    ? fmtMoney(l.recoveredDollars)
    : `${fmtHours(l.recoveredHours)}h`;
}

/**
 * Lifetime dispute recovery — the "this app paid for itself" line. It sits in
 * the Flagged to date zone as a row of its own, under the period earnings.
 *
 * Deliberately a SEPARATE ledger from every other dashboard number: recovered
 * money is not added into flag pay or period earnings (when a short gets paid,
 * the line's paid hours go up and that flows through normally). It is the only
 * number in the app that says what FRT itself got back for the tech.
 *
 * SCOPE (2026-08-02): this card used to also carry the closed count, the win
 * rate and a breakdown — the same three figures /insights now reports. Two
 * components deriving one figure is how they end up disagreeing, so the
 * analysis moved to /insights wholesale and what's left here is the headline
 * and a way through to it.
 *
 * The nudges stay. They are not lifetime figures, they are a to-do — "you have
 * a response waiting to be recorded" is time-sensitive and belongs where the
 * tech looks daily, not on a page they visit when curious. They are Note
 * fields: something to know and act on, not something broken.
 *
 * Renders nothing when there is neither a figure nor a nudge, so a new user
 * never sees an empty "recovered $0" row.
 */
export function RecoveredCard({
  disputes,
}: {
  // Null = the dispute-ledger migration hasn't landed. Distinct from [] and
  // handled the same way here (render nothing), but kept in the type so the
  // caller isn't tempted to coerce and lose the distinction the pay-period
  // card genuinely depends on.
  disputes: Dispute[] | null;
}) {
  if (disputes === null) return null;
  const lifetime = lifetimeRecovery(disputes);

  // Claims handed in and gone quiet past the nudge window.
  const stale = disputes.filter((d) => {
    const days = daysWaiting(d);
    return days !== null && days >= NUDGE_AFTER_DAYS;
  });
  // Answered but never closed out — the tech knows the outcome, FRT doesn't.
  const needsOutcome = disputes.filter(
    (d) => d.status === "answered" && !isClosed(d.status),
  );

  const nothingRecovered = lifetime.recoveredHours <= 0;
  if (nothingRecovered && stale.length === 0 && needsOutcome.length === 0) {
    return null;
  }

  return (
    <div data-testid="recovered-card">
      <div className="rows after-head">
        <div>
          <span className="k">Recovered with FRT</span>
          {!nothingRecovered && <span className="v num is-good">{withPt(headline(lifetime))}</span>}
        </div>
      </div>
      <div className="rows-link">
        <Link href="/insights" className="zone-link">
          Insights
          <DashIcon name="chev" />
        </Link>
      </div>

      {needsOutcome.length > 0 && (
        <StatusField tag="Note" inset>
          <p>
            <FiguresInText
              text={`${needsOutcome.length} claim${needsOutcome.length === 1 ? " has" : "s have"} a response waiting to be recorded.`}
            />
          </p>
        </StatusField>
      )}

      {stale.length > 0 && (
        <StatusField tag="Note" inset>
          <p>
            <FiguresInText
              text={
                stale.length === 1
                  ? `1 claim has been out for ${daysWaiting(stale[0])} days with no answer.`
                  : `${stale.length} claims have been out over a week with no answer.`
              }
            />
          </p>
        </StatusField>
      )}
    </div>
  );
}
