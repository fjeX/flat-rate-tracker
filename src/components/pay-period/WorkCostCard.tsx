"use client";

// "What did the work cost me?" — the merge of what used to be two sibling cards,
// Pay Check-Up and Unpaid Time.
//
// They were always one thought split across two boxes: PayPeriodView already fed
// the unpaid summary INTO the wage check (gapComposition) so the Pay Check-Up
// could explain its own clock-vs-flag gap. Presenting them as peers meant the
// gap figure lived in one card and the records explaining it lived in another.
//
// Now: the gap is the claim, the unpaid records are the evidence, and the
// evidence is a drill-down under the claim.
//
// The hard constraint carried over from wage-check.ts is unchanged — NUMBERS
// ONLY. No verdicts, no legal framing, no hardcoded wage figure. The only
// reference rate is one the user typed into Settings.
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { fmtHours } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import { formatDateShort } from "@/lib/periods";
import { UNPAID_TIME_KIND_LABELS } from "@/lib/types";
import {
  clockFlagGap,
  floorComparison,
  type EffectiveHourly,
  type GapComposition,
} from "@/lib/wage-check";
import type { UnpaidSummary } from "@/lib/unpaid-summary";

// Two-decimal currency for an hourly figure ("$27.40/hr") — whole dollars are
// too coarse for a rate, unlike the period totals fmtMoney handles elsewhere.
function fmtRate(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
      <div className="field-label">{label}</div>
      <div className="mono mt-1 text-base font-semibold tabular-nums text-[var(--fg-1)]">
        {value}
      </div>
    </div>
  );
}

export function WorkCostCard({
  result,
  referenceRate,
  gapParts = null,
  unpaid,
  defaultOpen = false,
}: {
  result: EffectiveHourly;
  referenceRate: number | null;
  gapParts?: GapComposition | null;
  unpaid: UnpaidSummary;
  // The page's mode decides whether this starts open — it is the primary card
  // mid-period and reference material once a period is settled.
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);

  const gap = clockFlagGap(result.clockedHours, result.flagHours);
  const comparison = floorComparison(result.hourly, referenceRate);
  const missingCount = result.missingClockDays.length;
  const hasUnpaid = unpaid.totalHours > 0 || unpaid.lines.length > 0;

  return (
    <section className="card padded space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
      >
        <div>
          <h2 className="text-sm font-medium text-[var(--fg-1)]">
            What did the work cost me?
          </h2>
          <p className="text-xs text-[var(--fg-3)]">
            Effective hourly, and the time this period that flagged nothing.
          </p>
        </div>
        <span className="flex items-center gap-2 text-[var(--fg-3)]">
          {!open && hasUnpaid && (
            <span className="mono text-sm font-semibold tabular-nums text-[var(--warn)]">
              {fmtHours(unpaid.totalHours)}h unpaid
            </span>
          )}
          {!open && !hasUnpaid && result.hourly !== null && (
            <span className="text-sm font-semibold tabular-nums text-[var(--fg-1)]">
              {fmtRate(result.hourly)}/hr
            </span>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-[var(--line)] pt-3">
          {/* Effective hourly — the headline, or an honest reason it's absent.
              Never a silent blank: every branch names what's missing and where
              to fix it. */}
          {result.hourly !== null ? (
            <div>
              <div className="field-label">Effective hourly this period</div>
              <div className="mono mt-0.5 text-xl font-semibold tabular-nums text-[var(--fg-0)]">
                {fmtRate(result.hourly)}
                <span className="text-base font-normal text-[var(--fg-3)]">
                  /hr
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--fg-3)]">
                Total pay{" "}
                {result.totalPay !== null ? fmtMoney(result.totalPay) : "—"} ÷{" "}
                {fmtHours(result.clockedHours)} clocked hours.
              </p>
            </div>
          ) : (
            <div className="card-inset px-3 py-2 text-sm text-[var(--fg-2)]">
              {result.status === "no_clock" &&
                (missingCount > 0 ? (
                  <>
                    {missingCount === 1
                      ? "1 day this period has flagged work but no clock entry"
                      : `${missingCount} days this period have flagged work but no clock entry`}
                    , so there&apos;s no effective hourly yet. Add clock hours for{" "}
                    {result.missingClockDays.map(formatDateShort).join(", ")} on
                    the dashboard to see it.
                  </>
                ) : (
                  <>
                    No clocked hours logged for this period yet. Effective hourly
                    needs the time you spent at the shop — add your clock hours on
                    the dashboard to see it.
                  </>
                ))}
              {result.status === "incomplete_clock" && (
                <>
                  {missingCount === 1
                    ? "1 day this period has flagged work but no clock entry"
                    : `${missingCount} days this period have flagged work but no clock entry`}
                  , so the effective hourly isn&apos;t shown — it would average
                  over an incomplete number of hours. Add clock hours for{" "}
                  {result.missingClockDays.map(formatDateShort).join(", ")} to see
                  it.
                </>
              )}
              {result.status === "no_rates" && (
                <>
                  Set a pay rate in Settings to see your effective hourly in
                  dollars. Your clocked-vs-flagged hours are below in the
                  meantime.
                </>
              )}
            </div>
          )}

          {/* Reference comparison — ONLY when a reference rate is set AND there
              is a figure to compare. Never invents a wage number. */}
          {comparison !== null && (
            <p className="card-inset px-3 py-2 text-sm text-[var(--fg-2)]">
              Your effective rate this period was{" "}
              <span className="font-semibold text-[var(--fg-1)]">
                {fmtRate(comparison.effective)}/hr
              </span>{" "}
              against your reference of{" "}
              <span className="font-semibold text-[var(--fg-1)]">
                {fmtRate(comparison.reference)}/hr
              </span>
              {" — "}
              <span className="font-medium">
                {fmtRate(Math.abs(comparison.delta))}/hr{" "}
                {comparison.atOrAbove ? "above" : "below"} your reference
              </span>
              .
            </p>
          )}

          {/* Degrade out loud: a figure exists but there's nothing to measure it
              against. Says so rather than silently omitting the comparison. */}
          {comparison === null && result.hourly !== null && (
            <p className="card-inset px-3 py-2 text-xs text-[var(--fg-3)]">
              No reference rate set, so there&apos;s nothing to compare this
              against. You can add one in Settings.
            </p>
          )}

          {/* Clocked vs flagged — always available, hours-only, no rates needed. */}
          <div className="grid grid-cols-3 gap-2">
            <Cell label="Clocked" value={`${fmtHours(result.clockedHours)}h`} />
            <Cell label="Flagged" value={`${fmtHours(result.flagHours)}h`} />
            <Cell
              label="Gap"
              value={`${gap >= 0 ? "" : "−"}${fmtHours(Math.abs(gap))}h`}
            />
          </div>

          {/* What that gap is MADE OF. Purely explanatory — the gap figure above
              is unchanged and nothing here re-derives the effective hourly. */}
          {gapParts !== null && (
            <div className="card-inset space-y-1 px-3 py-2 text-sm text-[var(--fg-2)]">
              <p className="text-[var(--fg-1)]">
                What&apos;s in that {fmtHours(gapParts.gapHours)}h gap
              </p>
              <ul className="m-0 list-none space-y-0.5 p-0 text-xs">
                {gapParts.comebackHours > 0 && (
                  <li className="flex justify-between gap-3">
                    <span>Unpaid rework</span>
                    <span className="mono tabular-nums">
                      {fmtHours(gapParts.comebackHours)}h
                    </span>
                  </li>
                )}
                {gapParts.waitingHours > 0 && (
                  <li className="flex justify-between gap-3">
                    <span>Waiting on parts or approval</span>
                    <span className="mono tabular-nums">
                      {fmtHours(gapParts.waitingHours)}h
                    </span>
                  </li>
                )}
                {gapParts.shopHours > 0 && (
                  <li className="flex justify-between gap-3">
                    <span>Shop time</span>
                    <span className="mono tabular-nums">
                      {fmtHours(gapParts.shopHours)}h
                    </span>
                  </li>
                )}
                {!gapParts.overTracked && (
                  <li className="flex justify-between gap-3 text-[var(--fg-3)]">
                    <span>Not accounted for yet</span>
                    <span className="mono tabular-nums">
                      {fmtHours(gapParts.unaccountedHours)}h
                    </span>
                  </li>
                )}
              </ul>
              {gapParts.overTracked && (
                // Recorded unpaid time can legitimately exceed the gap — comeback
                // hours run alongside flagged work on the same day. Say that
                // rather than printing a negative remainder.
                <p className="text-xs text-[var(--fg-3)]">
                  Your recorded unpaid time ({fmtHours(gapParts.trackedHours)}h)
                  covers the whole gap — some of it overlapped days you also
                  flagged work.
                </p>
              )}
            </div>
          )}

          {/* The evidence behind the gap: every unpaid record, one row each.
              A drill-down rather than a peer card — this is detail you open
              when you want to check the claim above. */}
          {hasUnpaid && (
            <div>
              <button
                type="button"
                onClick={() => setRecordsOpen((v) => !v)}
                aria-expanded={recordsOpen}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-2)] px-3 py-2 text-left text-sm text-[var(--fg-1)] hover:bg-[var(--bg-3)]"
              >
                <span>Every unpaid record</span>
                <span className="flex-1" />
                <span className="mono text-sm font-semibold tabular-nums text-[var(--warn)]">
                  {fmtHours(unpaid.totalHours)}h
                </span>
                {recordsOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-[var(--fg-3)]" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-[var(--fg-3)]" />
                )}
              </button>

              {recordsOpen && (
                <div className="space-y-3 pt-3">
                  <ul className="m-0 list-none p-0">
                    {unpaid.lines.map((l, i) => (
                      <li
                        key={`${l.source}-${l.entryId ?? "x"}-${i}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-dashed border-[var(--line-soft)] py-2 text-sm first:border-t-0"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-[var(--fg-1)]">
                            {UNPAID_TIME_KIND_LABELS[l.kind]}
                          </span>
                          {l.roNumber && (
                            <span className="text-[var(--fg-3)]">
                              {" "}
                              · RO #{l.roNumber}
                            </span>
                          )}
                          {l.code && (
                            <span className="text-[var(--fg-3)]"> · {l.code}</span>
                          )}
                          <span className="block truncate text-xs text-[var(--fg-3)]">
                            {formatDateShort(l.date)}
                            {l.description ? ` — ${l.description}` : ""}
                          </span>
                        </span>
                        <span className="mono shrink-0 tabular-nums text-[var(--fg-1)]">
                          {fmtHours(l.hours)}h
                          {l.dollars !== null && (
                            <span className="text-[var(--fg-3)]">
                              {" "}
                              · {fmtMoney(l.dollars)}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--line)] pt-2">
                    <span className="text-sm font-medium text-[var(--fg-1)]">
                      Total unpaid
                    </span>
                    <span className="mono text-sm font-semibold tabular-nums text-[var(--warn)]">
                      {fmtHours(unpaid.totalHours)}h
                      {unpaid.totalDollars !== null && (
                        <span className="text-[var(--fg-2)]">
                          {" "}
                          · {fmtMoney(unpaid.totalDollars)}
                        </span>
                      )}
                    </span>
                  </div>

                  {unpaid.totalDollars !== null && unpaid.unpricedHours > 0 && (
                    // Never let the dollar figure read as if it covered every
                    // hour above.
                    <p className="text-xs text-[var(--fg-3)]">
                      {fmtHours(unpaid.unpricedHours)}h of this has no rate on
                      file and is counted in hours only.
                    </p>
                  )}

                  <p className="text-xs text-[var(--fg-3)]">
                    These hours are reported beside your efficiency, never
                    subtracted from it — your flagged-hours figure is unchanged.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Missing-day breadcrumb even when a figure IS shown. */}
          {missingCount > 0 && result.status !== "incomplete_clock" && (
            <p className="text-xs text-[var(--fg-3)]">
              Days with flagged work but no clock entry:{" "}
              {result.missingClockDays.map(formatDateShort).join(", ")}.
            </p>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] pt-2">
            <button
              type="button"
              onClick={() => setExplainerOpen(true)}
              className="text-xs text-[var(--brand)] underline"
            >
              What does this mean?
            </button>
            <span className="text-xs text-[var(--fg-3)]">
              Informational only — not legal advice.
            </span>
          </div>
        </div>
      )}

      {explainerOpen && (
        <Modal
          open
          onClose={() => setExplainerOpen(false)}
          title="About these numbers"
        >
          <div className="space-y-4 text-sm leading-relaxed text-[var(--fg-2)]">
            <div>
              <h3 className="mb-1 font-semibold text-[var(--fg-1)]">
                What effective hourly means
              </h3>
              <p>
                Your effective hourly rate is your total pay for a period — flag
                pay plus any spiffs or bonuses — divided by the number of hours
                you were actually clocked in at the shop. It answers a simple
                question: for every hour you were on the clock, how much did you
                earn?
              </p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-[var(--fg-1)]">
                Why clocked hours matter
              </h3>
              <p>
                Flat-rate (piece-rate) pay rewards flagged jobs, but a workday
                also includes time that flags nothing — waiting for parts,
                cleaning up, or slow periods. Under California&apos;s piece-rate
                rules, that non-productive time and rest periods are treated as
                their own category of paid time rather than something flag pay
                can average over. Comparing your flagged hours to your clocked
                hours shows how much of your day fell outside flagged work.
              </p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-[var(--fg-1)]">
                Unpaid time is shown beside efficiency, never inside it
              </h3>
              <p>
                Rework, waiting and shop time are recorded as their own hours.
                They are never subtracted from your flagged hours and never
                change your efficiency figure — hiding them inside efficiency
                would defeat the point of tracking them at all.
              </p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-[var(--fg-1)]">
                The reference comparison
              </h3>
              <p>
                If you enter a reference hourly rate in Settings — for example,
                your local minimum wage — this view shows whether your effective
                hourly came in above or below it. The app never fills in a wage
                figure for you: minimum wage changes each year and differs by
                city, county, and state, so the number you compare against is
                always one you choose.
              </p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-[var(--fg-1)]">Learn more</h3>
              <p>
                California&apos;s Department of Industrial Relations publishes a
                plain-language explanation of piece-rate pay and how
                non-productive time is compensated:{" "}
                <a
                  href="https://www.dir.ca.gov/pieceratebackpayelection/AB_1513_FAQs.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: "var(--brand)" }}
                >
                  DIR piece-rate FAQ
                </a>
                .
              </p>
            </div>
            <p className="card-inset px-3 py-2 text-sm text-[var(--fg-2)]">
              This tool presents numbers from your own records for your
              information. It does not provide legal advice or reach any legal
              conclusion. For guidance on your specific situation, consult a
              qualified attorney or the California Labor Commissioner&apos;s
              Office.
            </p>
          </div>
        </Modal>
      )}
    </section>
  );
}
