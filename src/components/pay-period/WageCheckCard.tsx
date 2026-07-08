"use client";

// "Pay Check-Up" — a quiet, gauge-like view of the numbers California flat-rate
// pay math cares about, built entirely from data FRT already has. It presents
// NUMBERS ONLY: effective hourly, the clock-vs-flag gap, days missing a clock
// entry, and — only when the user set a reference rate — an above/below line.
// No verdicts, no warnings, no legal framing. Collapsed by default.
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { fmtHours } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import {
  clockFlagGap,
  floorComparison,
  type EffectiveHourly,
} from "@/lib/wage-check";
import { formatDateShort } from "@/lib/periods";

// Two-decimal currency for an hourly figure ("$27.40/hr") — whole dollars are too
// coarse for a rate, unlike the period totals fmtMoney handles elsewhere.
function fmtRate(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
      <div className="field-label">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--fg-1)]">
        {value}
      </div>
    </div>
  );
}

export function WageCheckCard({
  result,
  referenceRate,
}: {
  result: EffectiveHourly;
  referenceRate: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);

  const gap = clockFlagGap(result.clockedHours, result.flagHours);
  const comparison = floorComparison(result.hourly, referenceRate);

  const missingCount = result.missingClockDays.length;

  return (
    <section className="card padded space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div>
          <h2 className="text-sm font-medium text-[var(--fg-1)]">
            Pay Check-Up
          </h2>
          <p className="text-[11px] text-[var(--fg-3)]">
            Your effective hourly pay and clock-vs-flag time this period.
          </p>
        </div>
        <span className="flex items-center gap-2 text-[var(--fg-3)]">
          {!open && result.hourly !== null && (
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
          {/* Effective hourly — the headline number, or the reason it's not shown. */}
          {result.hourly !== null ? (
            <div>
              <div className="field-label">Effective hourly this period</div>
              <div className="mt-0.5 text-2xl font-semibold tabular-nums text-[var(--fg-0)]">
                {fmtRate(result.hourly)}
                <span className="text-base font-normal text-[var(--fg-3)]">
                  /hr
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--fg-3)]">
                Total pay {result.totalPay !== null ? fmtMoney(result.totalPay) : "—"}{" "}
                ÷ {fmtHours(result.clockedHours)} clocked hours.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-sm text-[var(--fg-2)]">
              {result.status === "no_clock" && (
                <>
                  No clocked hours logged for this period yet. Effective hourly
                  needs the time you spent at the shop — add your clock hours on
                  the dashboard to see it.
                </>
              )}
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

          {/* Reference comparison — ONLY when a reference rate is set and we have a figure. */}
          {comparison !== null && (
            <p className="rounded-md border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-sm text-[var(--fg-2)]">
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

          {/* Clocked vs flagged — always available (hours-only, no rates needed). */}
          <div className="grid grid-cols-3 gap-2">
            <StatCell label="Clocked" value={`${fmtHours(result.clockedHours)}h`} />
            <StatCell label="Flagged" value={`${fmtHours(result.flagHours)}h`} />
            <StatCell
              label="Gap"
              value={`${gap >= 0 ? "" : "−"}${fmtHours(Math.abs(gap))}h`}
            />
          </div>

          {/* Missing-day breadcrumb even when a figure IS shown (partial context). */}
          {missingCount > 0 && result.status !== "incomplete_clock" && (
            <p className="text-[11px] text-[var(--fg-3)]">
              Days with flagged work but no clock entry:{" "}
              {result.missingClockDays.map(formatDateShort).join(", ")}.
            </p>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] pt-2">
            <button
              type="button"
              onClick={() => setExplainerOpen(true)}
              className="text-[11px] text-[var(--brand)] underline"
            >
              What does this mean?
            </button>
            <span className="text-[11px] text-[var(--fg-3)]">
              Informational only — not legal advice.
            </span>
          </div>
        </div>
      )}

      {explainerOpen && (
        <Modal
          open
          onClose={() => setExplainerOpen(false)}
          title="About the Pay Check-Up"
        >
          <div className="space-y-4 text-sm leading-relaxed text-[var(--fg-2)]">
            <div>
              <h3 className="mb-1 font-semibold text-[var(--fg-1)]">
                What effective hourly means
              </h3>
              <p>
                Your effective hourly rate is your total pay for a period — flag
                pay plus any spiffs or bonuses — divided by the number of hours you
                were actually clocked in at the shop. It answers a simple question:
                for every hour you were on the clock, how much did you earn?
              </p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-[var(--fg-1)]">
                Why clocked hours matter
              </h3>
              <p>
                Flat-rate (piece-rate) pay rewards flagged jobs, but a workday also
                includes time that flags nothing — waiting for parts, cleaning up,
                or slow periods. Under California&apos;s piece-rate rules, that
                non-productive time and rest periods are treated as their own
                category of paid time rather than something flag pay can average
                over. Comparing your flagged hours to your clocked hours shows how
                much of your day fell outside flagged work.
              </p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-[var(--fg-1)]">
                The reference comparison
              </h3>
              <p>
                If you enter a reference hourly rate in Settings — for example, your
                local minimum wage — this view shows whether your effective hourly
                came in above or below it. The app never fills in a wage figure for
                you: minimum wage changes each year and differs by city, county, and
                state, so the number you compare against is always one you choose.
              </p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-[var(--fg-1)]">
                Learn more
              </h3>
              <p>
                California&apos;s Department of Industrial Relations publishes a
                plain-language explanation of piece-rate pay and how non-productive
                time is compensated:{" "}
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
            <p className="rounded-md border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-[13px] text-[var(--fg-3)]">
              This tool presents numbers from your own records for your
              information. It does not provide legal advice or reach any legal
              conclusion. For guidance on your specific situation, consult a
              qualified attorney or the California Labor Commissioner&apos;s Office.
            </p>
          </div>
        </Modal>
      )}
    </section>
  );
}
