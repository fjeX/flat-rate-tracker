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
import { Card } from "@/components/ui/Card";
import { Table, Td, Th } from "@/components/ui/Table";
import {
  formatRatio,
  ratioTier,
  type BigJobCoverage,
  type BigJobRow,
} from "@/lib/insights";
import { HEAVY_FLAG_HOURS } from "@/lib/mix";
import type { Inference } from "@/lib/time-inference";

function one(n: number): string {
  return n.toFixed(1);
}

const TIER_COLOR: Record<string, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
};

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
    <section>
      <div className="section-title">Big jobs</div>

      <Card flush>
        <div className="px-4 pt-4">
          <p className="text-sm" style={{ color: "var(--fg-2)" }}>
            Jobs flagging {HEAVY_FLAG_HOURS}h or more — the ones worth timing
            one at a time. They&rsquo;re {coverage.lines} of your lines and where
            most of your money is.
          </p>

          {/* Coverage, stated plainly and never buried. A scorecard built on a
              handful of readings must say so, or it gets read as a record. */}
          <div className="mt-3 flex items-center gap-3">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full"
              style={{ background: "var(--bg-3)" }}
            >
              <div
                style={{
                  width: `${Math.min(100, coverage.pct)}%`,
                  height: "100%",
                  background: "var(--brand)",
                  borderRadius: 999,
                }}
              />
            </div>
            <span
              className="mono shrink-0 text-xs tabular-nums"
              style={{ color: "var(--fg-2)" }}
            >
              {coverage.measured}/{coverage.lines} timed
            </span>
          </div>
        </div>

        {measured.length === 0 ? (
          <p className="px-4 py-4 text-sm" style={{ color: "var(--fg-2)" }}>
            None of them have a time on them yet. Next time you log one, the app
            will ask you once — roughly is fine.
          </p>
        ) : (
          <div className="mt-3">
            <Table>
              <thead>
                <tr>
                  <Th>Job</Th>
                  <Th align="right">Flag</Th>
                  <Th align="right">Actual</Th>
                  <Th align="right">vs book</Th>
                </tr>
              </thead>
              <tbody>
                {measured.map((row) => {
                  const tier = ratioTier(row.ratio);
                  return (
                    <tr key={row.key}>
                      <Td>
                        <div className="mono text-sm" style={{ color: "var(--fg-0)" }}>
                          {row.code}
                        </div>
                        <div className="text-[11px]" style={{ color: "var(--fg-3)" }}>
                          {row.timedUses} timed
                          {row.hasEstimate && " · includes an estimate"}
                          {!row.confident &&
                            ` · ${row.needsMore} more to call it`}
                        </div>
                      </Td>
                      <Td align="right">
                        <span className="mono tabular-nums">
                          {one(row.flagTotal)}h
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="mono tabular-nums">
                          {one(row.actualTotal)}h
                        </span>
                      </Td>
                      <Td align="right">
                        <span
                          className="mono font-semibold tabular-nums"
                          style={{
                            // A provisional row is stated in muted ink rather
                            // than a verdict colour. Green on one reading is a
                            // claim the data cannot support.
                            color: row.confident
                              ? (tier && TIER_COLOR[tier]) || "var(--fg-1)"
                              : "var(--fg-2)",
                          }}
                        >
                          {row.ratio === null ? "—" : `${formatRatio(row.ratio)}×`}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}

        <div className="px-4 pb-4 pt-3">
          <p className="text-xs" style={{ color: "var(--fg-3)" }}>
            Lower than 1.00× means you beat the book.
          </p>
          {implausible > 0 && (
            <p className="mt-1 text-xs" style={{ color: "var(--warn)" }}>
              {implausible} reading{implausible === 1 ? "" : "s"} can&rsquo;t be
              right (a few minutes against a multi-hour job) and{" "}
              {implausible === 1 ? "was" : "were"} left out. Worth fixing on the
              RO if you spot {implausible === 1 ? "it" : "them"}.
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}

export function MaintenanceTimesSection({ inference }: { inference: Inference }) {
  return (
    <section>
      <div className="section-title">The quick stuff</div>
      <Card className="space-y-3">
        <p className="text-sm" style={{ color: "var(--fg-2)" }}>
          Nobody is going to run a stopwatch on an oil change eight times a day,
          so the app doesn&rsquo;t ask. Instead it works these out from how long
          your days run and what was on them.
        </p>

        {inference.ok ? (
          <>
            {inference.dailyOverheadHours !== null && (
              <div className="card-inset px-3 py-2">
                <div className="field-label">Before any job is touched</div>
                <div
                  className="mono mt-0.5 text-base font-semibold tabular-nums"
                  style={{ color: "var(--fg-0)" }}
                >
                  {one(inference.dailyOverheadHours)}h a day
                </div>
                <div className="text-[11px]" style={{ color: "var(--fg-3)" }}>
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
                </div>
              </div>
            )}

            <div>
              {inference.durations.map((d) => (
                <div
                  key={d.key}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <div className="min-w-0">
                    <span className="mono text-sm" style={{ color: "var(--fg-0)" }}>
                      {d.code}
                    </span>
                    <span
                      className="ml-2 text-[11px]"
                      style={{ color: "var(--fg-3)" }}
                    >
                      {d.uses} logged
                      {d.unreliableReason === "tangled" &&
                        ` · almost always run alongside ${d.tangledWith}, so these two can't be told apart`}
                      {d.unreliableReason === "no-signal" &&
                        " · not enough independent variation to pin down"}
                    </span>
                  </div>
                  <span
                    className="mono shrink-0 text-sm tabular-nums"
                    style={{
                      color: d.reliable ? "var(--fg-1)" : "var(--fg-3)",
                    }}
                  >
                    {d.reliable ? `~${(d.hours * 60).toFixed(0)} min` : "—"}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-xs" style={{ color: "var(--fg-3)" }}>
              Worked out from {inference.days} days, explaining{" "}
              {(inference.rSquared * 100).toFixed(0)}% of why your days run the
              length they do. These are averages for the code, never a reading of
              one particular job.
            </p>
          </>
        ) : (
          <p className="text-sm" style={{ color: "var(--fg-2)" }}>
            {refusalCopy(inference)}
          </p>
        )}
      </Card>
    </section>
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
