"use client";

// The two halves of "how long does the work actually take", split by the only
// line that matters for measurement: job size.
//
//   BigJobsSection          — 2h+ jobs, measured one at a time, from a clock or
//                             a tapped estimate. Small n, high value each.
//   MaintenanceTimesSection — everything else, never timed by anybody, solved
//                             for in aggregate. No n at all, by design.
//
// They are deliberately adjacent so the page reads as one idea with two methods,
// rather than as a feature and an apology for a missing feature.
import { Zone } from "@/components/ui/Zone";
import { Table, Td, Th } from "@/components/ui/Table";
import { withPt } from "@/components/ui/Figure";
import { fmtHours } from "@/lib/format";
import {
  formatRatio,
  ratioTier,
  type BigJobCoverage,
  type BigJobRow,
} from "@/lib/insights";
import { OriginTag } from "@/components/insights/OriginTag";
import { HEAVY_FLAG_HOURS } from "@/lib/mix";
import type { Inference } from "@/lib/time-inference";

export function BigJobsSection({
  rows,
  coverage,
}: {
  rows: BigJobRow[];
  coverage: BigJobCoverage;
}) {
  if (coverage.lines === 0) return null;

  const measured = rows.filter((r) => r.timedUses > 0);
  const implausible = rows.reduce((sum, r) => sum + r.implausibleUses, 0);

  return (
    <Zone name="Big jobs">
      <p className="ins-sub">
        Jobs flagging {HEAVY_FLAG_HOURS}h or more — the ones worth timing one at
        a time. They&rsquo;re {coverage.lines} of your lines and where most of
        your money is.
      </p>

      {/* Coverage, stated plainly and never buried. A scorecard built on a
          handful of readings must say so, or it gets read as a record. */}
      <div className="ins-coverage">
        <span className="ins-meter" aria-hidden="true">
          <i style={{ width: `${Math.min(100, coverage.pct)}%`, background: "var(--bar)" }} />
        </span>
        <span className="num">
          {coverage.measured}/{coverage.lines} timed
        </span>
      </div>

      {measured.length === 0 ? (
        <p className="ins-fine">
          None of them have a time on them yet. Next time you log one, the app
          will ask you once — roughly is fine.
        </p>
      ) : (
        <div className="ins-subhead">
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th num>Flag</Th>
                <Th num>Actual</Th>
                <Th num>vs book</Th>
              </tr>
            </thead>
            <tbody>
              {measured.map((row) => {
                const tier = ratioTier(row.ratio);
                // A provisional row is stated in muted ink rather than a
                // verdict colour. Green on one reading is a claim the data
                // cannot support. A "warn" tier is ink too: colour is state,
                // and the only states are beat the book / cost you.
                const tone = !row.confident
                  ? "ins-dim"
                  : tier === "good"
                    ? "ins-good"
                    : tier === "bad"
                      ? "ins-bad"
                      : "";
                return (
                  <tr key={row.key}>
                    <Td>
                      <span className="ins-row-code">{row.code}</span>
                      <OriginTag row={row} />
                      <span className="ins-cell-sub">
                        {row.timedUses} timed
                        {row.hasEstimate && " · includes an estimate"}
                        {!row.confident && ` · ${row.needsMore} more to call it`}
                      </span>
                    </Td>
                    <Td num dim>{fmtHours(row.flagTotal)}h</Td>
                    <Td num dim>{fmtHours(row.actualTotal)}h</Td>
                    <Td num className={tone || undefined}>
                      {row.ratio === null ? "—" : `${formatRatio(row.ratio)}×`}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      <p className="ins-fine">Lower than 1.00× means you beat the book.</p>
      {implausible > 0 && (
        <p className="ins-fine">
          {implausible} reading{implausible === 1 ? "" : "s"} can&rsquo;t be
          right (a few minutes against a multi-hour job) and{" "}
          {implausible === 1 ? "was" : "were"} left out. Worth fixing on the RO
          if you spot {implausible === 1 ? "it" : "them"}.
        </p>
      )}
    </Zone>
  );
}

export function MaintenanceTimesSection({ inference }: { inference: Inference }) {
  return (
    <Zone name="The quick stuff">
      <p className="ins-sub">
        Nobody is going to run a stopwatch on an oil change eight times a day,
        so the app doesn&rsquo;t ask. Instead it works these out from how long
        your days run and what was on them.
      </p>

      {inference.ok ? (
        <>
          {inference.dailyOverheadHours !== null && (
            <div className="ins-plate">
              <div className="ins-k">Before any job is touched</div>
              <span className="num">
                {withPt(fmtHours(inference.dailyOverheadHours))}
                <span className="unit">h a day</span>
              </span>
              <p>
                Cleanup, waiting, dispatch limbo — time that never lands on a
                ticket
                {inference.foldedIntoOverhead.length > 0 &&
                  `, plus ${inference.foldedIntoOverhead.length} code${
                    inference.foldedIntoOverhead.length === 1 ? "" : "s"
                  } there wasn't enough history to separate out (${inference.foldedIntoOverhead
                    .slice(0, 4)
                    .join(", ")}${
                    inference.foldedIntoOverhead.length > 4 ? "…" : ""
                  })`}
              </p>
            </div>
          )}

          <ul className="ins-kv">
            {inference.durations.map((d) => (
              <li key={d.key}>
                <span className="ins-row-name">
                  {/* Same collision, same fix as Big jobs above: lib/time-inference
                      keys these rows `lib:`/`custom:` exactly as lib/insights
                      does, so a typed "ALIGN" and the library one are two rows
                      with one label unless the origin is stated. */}
                  <span className="ins-row-code">
                    {d.code}
                    <OriginTag row={d} />
                  </span>
                  <span className="ins-dim" style={{ fontSize: "var(--fs-label)" }}>
                    {d.uses} logged
                    {d.unreliableReason === "tangled" &&
                      ` · almost always run alongside ${d.tangledWith}, so these two can't be told apart`}
                    {d.unreliableReason === "no-signal" &&
                      " · not enough independent variation to pin down"}
                  </span>
                </span>
                <span className={`ins-row-fig num${d.reliable ? "" : " is-dim"}`}>
                  {/* Minutes, not hours — an inferred per-op job time is read
                      against a clock, and "0.8h" is worse than "~48 min" here.
                      Not a private hours formatter (2026-08-20 sweep): the unit
                      is different, and `reliable` already gates out the values
                      small enough for fmtHours' floor to matter. */}
                  {d.reliable ? `~${(d.hours * 60).toFixed(0)} min` : "—"}
                </span>
              </li>
            ))}
          </ul>

          <p className="ins-fine">
            Worked out from {inference.days} days, explaining{" "}
            {(inference.rSquared * 100).toFixed(0)}% of why your days run the
            length they do. These are averages for the code, never a reading of
            one particular job.
          </p>
        </>
      ) : (
        <p className="ins-sub">{refusalCopy(inference)}</p>
      )}
    </Zone>
  );
}

/**
 * Why the solve did not run, in the tech's terms.
 *
 * Every branch names something real about their data rather than saying "not
 * enough data" four different ways — the uniform-days case in particular is a
 * genuine finding about how flat rate works, not a shortfall to apologise for.
 */
function refusalCopy(inference: Extract<Inference, { ok: false }>): string {
  switch (inference.reason) {
    case "not-enough-days":
      return `Needs ${inference.needed} days where the app knows how long you were there — you have ${inference.days}. Clock your hours in and this fills itself in.`;
    case "not-enough-codes":
      return "No job code shows up often enough yet to work out a time for it.";
    case "too-few-days-per-code":
      return `Needs more days than job codes to separate them — you have ${inference.days} days. It gets better every week you log.`;
    case "days-too-uniform":
      return "Your clocked days are all about the same length, so there's nothing here to solve against — a day with fourteen jobs and a day with four both come out at eight hours. That's flat rate working as intended; it just means the day length can't reveal how long each job took.";
    case "poor-fit":
      return `Tried it, and the answer didn't hold up — it only explained ${(inference.rSquared * 100).toFixed(0)}% of why your days run the length they do, well short of the ${(inference.needed * 100).toFixed(0)}% needed to be worth printing. Rather than show you numbers we'd have to tell you to ignore, they're withheld.`;
    case "unsolvable":
      return "The numbers didn't resolve to a single answer this time.";
  }
}
