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

// Days a submitted claim can sit before the card nudges. A shop needs a payroll
// cycle to react; nagging on day 2 would train the tech to ignore this.
const NUDGE_AFTER_DAYS = 7;

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// The headline figure: dollars when the claims were priced, hours otherwise.
// Never "$0" for an unpriced claim — that reads as "you recovered nothing".
function headline(l: LifetimeRecovery): string {
  return l.recoveredDollars !== null
    ? fmtMoney(l.recoveredDollars)
    : `${fmtHours(l.recoveredHours)}h`;
}

/**
 * Lifetime dispute recovery — the "this app paid for itself" surface.
 *
 * Deliberately a SEPARATE ledger from every other dashboard number: recovered
 * money is not added into flag pay or period earnings (when a short gets paid,
 * the line's paid hours go up and that flows through normally). Showing it here
 * as its own figure is the whole point — it is the only number in the app that
 * says what FRT itself got back for the tech.
 *
 * Renders nothing until there is something true to say, so a new user never sees
 * an empty "recovered $0" tile.
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
    // Own top margin rather than a wrapper div in the page: the card decides
    // whether it renders at all, and an empty wrapper would leave a stray gap.
    <section className="card padded-lg mt-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Recovered with FRT</h2>
        <Link href="/pay-period" className="link text-xs">
          Dispute tracking →
        </Link>
      </div>

      {!nothingRecovered && (
        <>
          <div className="mono text-2xl font-semibold tabular-nums text-[var(--good)]">
            {headline(lifetime)}
          </div>
          <p className="text-xs text-[var(--fg-3)]">
            {fmtHours(lifetime.recoveredHours)}h back across{" "}
            {lifetime.closedCount} closed claim
            {lifetime.closedCount === 1 ? "" : "s"}
            {lifetime.winRate !== null && ` · ${pct(lifetime.winRate)} got paid`}
          </p>
        </>
      )}

      {needsOutcome.length > 0 && (
        <p className="rounded-[var(--radius-sm)] bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn)]">
          {needsOutcome.length} claim
          {needsOutcome.length === 1 ? " has" : "s have"} a response waiting to
          be recorded.
        </p>
      )}

      {stale.length > 0 && (
        <p className="rounded-[var(--radius-sm)] bg-[var(--bg-1)] px-3 py-2 text-xs text-[var(--fg-2)]">
          {stale.length === 1
            ? `1 claim has been out for ${daysWaiting(stale[0])} days with no answer.`
            : `${stale.length} claims have been out over a week with no answer.`}
        </p>
      )}
    </section>
  );
}
