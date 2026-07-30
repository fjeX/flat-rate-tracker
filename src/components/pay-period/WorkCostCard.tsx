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
import { InfoBubble } from "@/components/ui/InfoBubble";
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

  const gap = clockFlagGap(result.denomHours, result.flagHours);
  const comparison = floorComparison(result.hourly, referenceRate);
  const missingCount = result.missingClockDays.length;
  const hasUnpaid = unpaid.totalHours > 0 || unpaid.lines.length > 0;

  return (
    <section className="card padded space-y-3">
      <div className="card-head-row">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] flex-1 items-center justify-between gap-2 text-left"
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

      <InfoBubble title="What did the work cost me?">
        <p>
          Flag hours tell you what you were paid for. This card is about
          everything else — the hours you were at the shop that flagged nothing,
          and what your pay works out to once those hours are counted.
        </p>
        <h3>Effective hourly</h3>
        <p>
          Your total pay for the period — flag pay plus spiffs — divided by the
          hours you were actually at the shop. It answers a question flag pay
          alone cannot: for every hour of your life the shop had, how much did
          you earn? A 130% efficiency week can still be a bad week if you sat
          around for six hours waiting on parts.
        </p>
        <h3>Where the hours come from</h3>
        <p>
          Clocked hours if you logged them. If you did not, FRT falls back to
          your normal shift from the Schedule page, because a day with flagged
          work on it was obviously a day you worked. You can correct any single
          day with a shift override on the dashboard or schedule page.
        </p>
        <h3>The gap, and what is in it</h3>
        <p>
          The difference between hours at the shop and hours flagged. Rework you
          were not paid for, waiting on parts or approval, and shop time all get
          listed separately so the gap is not just a mystery number.
        </p>
        <p>
          These hours are shown <strong>beside</strong> your efficiency and are
          never subtracted from it. Hiding unpaid time inside efficiency would
          defeat the point of tracking it.
        </p>
        <h3>Why flat rate makes this matter</h3>
        <p>
          Flat-rate (piece-rate) pay rewards flagged jobs, but a workday also
          includes time that flags nothing. Under California&apos;s piece-rate
          rules that non-productive time and rest periods are their own category
          of paid time, rather than something flag pay can average over.
        </p>
        <h3>The reference comparison</h3>
        <p>
          If you enter a reference hourly rate in Settings — your local minimum
          wage, or a rate you would take elsewhere — this shows whether you came
          in above or below it. FRT never fills in a wage figure for you:
          minimum wage changes every year and differs by city and county, so the
          number you compare against is always one you chose.
        </p>
        <p>
          California&apos;s Department of Industrial Relations publishes a
          plain-language explanation of piece-rate pay:{" "}
          <a
            href="https://www.dir.ca.gov/pieceratebackpayelection/AB_1513_FAQs.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            DIR piece-rate FAQ
          </a>
          .
        </p>
        <p className="card-inset px-3 py-2">
          This shows numbers from your own records for your information. It does
          not provide legal advice or reach any legal conclusion. For your
          specific situation, consult a qualified attorney or the California
          Labor Commissioner&apos;s Office.
        </p>
      </InfoBubble>
      </div>

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
                {fmtHours(result.denomHours)}{" "}
                {result.denomSource === "scheduled"
                  ? "scheduled hours"
                  : result.denomSource === "mixed"
                    ? "hours at the shop"
                    : "clocked hours"}
                .
              </p>
              {/* Say plainly when a figure leans on the schedule rather than a
                  real clock entry — the number is a good default, not a
                  measurement, and the tech can override any day. */}
              {result.scheduledDays.length > 0 && (
                <p className="mt-1 text-xs text-[var(--fg-3)]">
                  {result.scheduledDays.length === 1
                    ? "1 day had flagged work but no clock entry"
                    : `${result.scheduledDays.length} days had flagged work but no clock entry`}
                  , so your normal scheduled shift was used for{" "}
                  {result.scheduledDays.length === 1 ? "it" : "them"}. Set a
                  shift override on any day that wasn&apos;t normal.
                </p>
              )}
            </div>
          ) : (
            <div className="card-inset px-3 py-2 text-sm text-[var(--fg-2)]">
              {/* These only fire for days with NEITHER a clock entry NOR a
                  schedule to fall back on. Once a work schedule exists, a
                  normal shift fills the day automatically — so the fix being
                  offered is the schedule, not 10 days of manual clock entry. */}
              {result.status === "no_clock" &&
                (missingCount > 0 ? (
                  <>
                    {missingCount === 1
                      ? "1 day this period has flagged work but no hours on it"
                      : `${missingCount} days this period have flagged work but no hours on them`}
                    , so there&apos;s no effective hourly yet. Set your normal
                    shift on the schedule page and days like these fill in
                    automatically — or add clock hours for{" "}
                    {result.missingClockDays.map(formatDateShort).join(", ")} on
                    the dashboard.
                  </>
                ) : (
                  <>
                    No hours logged for this period yet. Effective hourly needs
                    the time you spent at the shop — set your normal shift on the
                    schedule page, or add clock hours on the dashboard.
                  </>
                ))}
              {result.status === "incomplete_clock" && (
                <>
                  {missingCount === 1
                    ? "1 day this period has flagged work but no hours on it"
                    : `${missingCount} days this period have flagged work but no hours on them`}
                  , so the effective hourly isn&apos;t shown — it would average
                  over an incomplete number of hours.{" "}
                  {result.missingClockDays.map(formatDateShort).join(", ")}{" "}
                  {missingCount === 1 ? "falls" : "fall"} outside your scheduled
                  shifts, so add clock hours or a shift override for{" "}
                  {missingCount === 1 ? "it" : "them"}.
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

          {/* Hours at the shop vs flagged — always available, hours-only, no
              rates needed. Uses the resolved denominator so a scheduled day
              counts, matching how efficiency has always been computed. */}
          <div className="grid grid-cols-3 gap-2">
            <Cell
              label={
                result.denomSource === "scheduled" ? "Scheduled" : "At the shop"
              }
              value={`${fmtHours(result.denomHours)}h`}
            />
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

          {/* Breadcrumb for days that couldn't be resolved at all, even when a
              figure IS shown. Scheduled days are deliberately absent here —
              they're accounted for, and listing them would read as a problem. */}
          {missingCount > 0 && result.status !== "incomplete_clock" && (
            <p className="text-xs text-[var(--fg-3)]">
              Days with flagged work but no hours and no scheduled shift:{" "}
              {result.missingClockDays.map(formatDateShort).join(", ")}.
            </p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] pt-2">
            <span className="text-xs text-[var(--fg-3)]">
              Informational only — not legal advice.
            </span>
          </div>
        </div>
      )}

    </section>
  );
}
