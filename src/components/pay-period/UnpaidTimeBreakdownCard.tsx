"use client";

// "Unpaid Time" — the pay-period surface for the Unpaid Time Engine (Phase 3).
//
// The dashboard card answers "how much?"; this one answers "where did it go?"
// Every row is a real record: an RO line marked as a comeback, or a ledger row
// from a timer hold, a resolved empty day, or a manual entry.
//
// Collapsed by default, matching every other card on this page. Renders nothing
// at all when the period has no unpaid time — an empty card would just be noise
// on the majority of periods.
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { fmtHours } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import { formatDateShort } from "@/lib/periods";
import { UNPAID_TIME_KIND_LABELS } from "@/lib/types";
import type { UnpaidSummary } from "@/lib/unpaid-summary";

function Part({ label, hours }: { label: string; hours: number }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
      <div className="field-label">{label}</div>
      <div className="mono mt-1 text-base font-semibold tabular-nums text-[var(--fg-1)]">
        {fmtHours(hours)}h
      </div>
    </div>
  );
}

export function UnpaidTimeBreakdownCard({
  summary,
}: {
  summary: UnpaidSummary;
}) {
  const [open, setOpen] = useState(false);

  if (summary.totalHours <= 0 && summary.lines.length === 0) return null;

  return (
    <section className="card padded space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
      >
        <div>
          <h2 className="text-sm font-medium text-[var(--fg-1)]">Unpaid Time</h2>
          <p className="text-xs text-[var(--fg-3)]">
            Hours worked or waited this period that flagged nothing.
          </p>
        </div>
        <span className="flex items-center gap-2 text-[var(--fg-3)]">
          {!open && (
            <span className="mono text-sm font-semibold tabular-nums text-[var(--warn)]">
              {fmtHours(summary.totalHours)}h
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
          <div className="grid grid-cols-3 gap-2">
            <Part label="Rework" hours={summary.comebackHours} />
            <Part label="Waiting" hours={summary.waitingHours} />
            <Part label="Shop time" hours={summary.shopHours} />
          </div>

          <ul className="m-0 list-none p-0">
            {summary.lines.map((l, i) => (
              <li
                key={`${l.source}-${l.entryId ?? "x"}-${i}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-dashed border-[var(--line-soft)] py-2 text-sm first:border-t-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-[var(--fg-1)]">
                    {UNPAID_TIME_KIND_LABELS[l.kind]}
                  </span>
                  {l.roNumber && (
                    <span className="text-[var(--fg-3)]"> · RO #{l.roNumber}</span>
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
              {fmtHours(summary.totalHours)}h
              {summary.totalDollars !== null && (
                <span className="text-[var(--fg-2)]">
                  {" "}
                  · {fmtMoney(summary.totalDollars)}
                </span>
              )}
            </span>
          </div>

          {summary.totalDollars !== null && summary.unpricedHours > 0 && (
            // Never let the dollar figure read as if it covered every hour above.
            <p className="text-xs text-[var(--fg-3)]">
              {fmtHours(summary.unpricedHours)}h of this has no rate on file and
              is counted in hours only.
            </p>
          )}

          <p className="text-xs text-[var(--fg-3)]">
            These hours are reported beside your efficiency, never subtracted
            from it — your flagged-hours figure is unchanged.
          </p>
        </div>
      )}
    </section>
  );
}
