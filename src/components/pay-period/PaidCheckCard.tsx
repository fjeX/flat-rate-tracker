"use client";

// "Did I get paid?" — one card for what used to be three competing siblings:
// Pay Discrepancy Check, Pay Reconciliation, and Dispute Tracking.
//
// They were never three questions. They are one question at three zoom levels,
// plus what happened next:
//
//   1. period level — you were paid N hours against M flagged   (Discrepancy)
//   2. line level   — these 13 specific lines came up short     (Reconciliation)
//   3. outcome      — you claimed it; did the money arrive?     (Dispute)
//
// Presenting them as peers meant a tech had to already understand the model to
// know which box to open. Now step 1 is always visible, and 2 and 3 are
// drill-downs you reach only when there is something to drill into.
//
// This component owns layout and sequencing ONLY. Every figure still comes from
// the same three components, unchanged, rendered with `embedded` — so none of
// the reconciliation math, dispute lifecycle, or their tests move.
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { InfoBubble } from "@/components/ui/InfoBubble";
import type { Dispute, Entry, OpCode } from "@/lib/types";
import type { Stats } from "@/lib/stats";
import { fmtHours } from "@/lib/stats";
import type { RateMap } from "@/lib/earnings";
import type { PeriodMode } from "@/lib/period-mode";
import { DiscrepancyCard } from "./DiscrepancyCard";
import { ReconciliationCard } from "./ReconciliationCard";
import { DisputeOutcomeCard } from "./DisputeOutcomeCard";

export function PaidCheckCard({
  periodKey,
  periodLabel,
  mode,
  stats,
  paidFlagHours,
  entries,
  library,
  rates,
  techName,
  entryIdsWithPhotos,
  disputes,
  openDispute,
  shortedHours,
  defaultOpen = false,
}: {
  periodKey: string;
  periodLabel: string;
  mode: PeriodMode;
  stats: Stats;
  paidFlagHours: number | null;
  entries: Entry[];
  library: OpCode[];
  rates: RateMap;
  techName: string | null;
  entryIdsWithPhotos?: Set<string>;
  // NULL means the dispute-ledger migration hasn't been applied yet — distinct
  // from [] meaning "migrated, nothing disputed". The dispute section must stay
  // hidden on null: otherwise it offers a button whose action throws against a
  // missing table. Same null-vs-empty contract as listWorkSchedulesSafe.
  disputes: Dispute[] | null;
  openDispute: Dispute | null;
  shortedHours: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const diff = paidFlagHours === null ? null : paidFlagHours - stats.flagHours;
  // Matches lib/discrepancy's period-level TOLERANCE. Deliberately looser than
  // reconcile.ts's per-line PAY_EPS (0.05) — this is a judgment about a whole
  // period's stub, not about one rounded line.
  const isShort = diff !== null && diff < -0.1;

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
            Did I get paid?
          </h2>
          <p className="text-xs text-[var(--fg-3)]">
            What your stub says against what you logged.
          </p>
        </div>
        <span className="flex items-center gap-2 text-[var(--fg-3)]">
          {!open && (
            <span
              className={
                isShort
                  ? "mono text-sm font-semibold tabular-nums text-[var(--bad)]"
                  : paidFlagHours !== null
                    ? "mono text-sm font-semibold tabular-nums text-[var(--good)]"
                    : "text-sm text-[var(--fg-3)]"
              }
            >
              {isShort
                ? `${fmtHours(Math.abs(diff!))}h short`
                : paidFlagHours !== null
                  ? "Paid in full"
                  : "Not logged yet"}
            </span>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>

      <InfoBubble title="Did I get paid?">
        <p>
          Your shop tells you what it paid you. This card checks that against
          what you actually logged, so you find out from your own records rather
          than from memory.
        </p>
        <h3>It works at three levels</h3>
        <p>
          <strong>The period total</strong> — you enter the flag hours from your
          stub and it compares them to everything you logged. That catches a
          whole job going missing.
        </p>
        <p>
          <strong>Line by line</strong> — mark what each RO actually paid, and
          shorted lines are listed individually. That catches a job paid at
          fewer hours than it flagged, which the period total can hide when
          another job happens to be paid over.
        </p>
        <p>
          <strong>The outcome</strong> — when you raise a claim, this tracks
          whether the money actually arrived. Most tools stop at &ldquo;here is
          what you are owed&rdquo;; whether you got it is the part that matters.
        </p>
        <h3>Why it matters</h3>
        <p>
          A couple of hours short in a pay period is easy to miss and adds up to
          real money over a year. Logging as you go means that when you do go
          and ask, you are holding dated records of specific ROs instead of a
          feeling that something was off.
        </p>
      </InfoBubble>
      </div>

      {open && (
        <div className="space-y-3 border-t border-[var(--line)] pt-3">
          {/* Step 1 — the period-level check. Always present: it is both the
              answer and the place to correct a mistyped stub figure. */}
          <DiscrepancyCard
            key={periodKey}
            periodKey={periodKey}
            stats={stats}
            initialPaid={paidFlagHours}
            embedded
          />

          {/* Degrade out loud: say why the drill-downs are empty rather than
              rendering a card with nothing in it. */}
          {mode === "in_progress" && paidFlagHours === null && (
            <p className="card-inset px-3 py-2 text-xs text-[var(--fg-3)]">
              This period is still running. Once it closes and your stub arrives,
              log the paid hours above and the line-by-line check opens up here.
            </p>
          )}

          {/* Step 2 — line level. */}
          <ReconciliationCard
            key={`recon-${periodKey}`}
            entries={entries}
            library={library}
            rates={rates}
            periodKey={periodKey}
            periodLabel={periodLabel}
            techName={techName}
            entryIdsWithPhotos={entryIdsWithPhotos}
            embedded
            title="Which lines came up short?"
          />

          {/* Step 3 — outcome. Hidden entirely pre-migration (null), and the
              component self-hides when there's nothing claimed and nothing
              claimable. */}
          {disputes !== null && (
            <DisputeOutcomeCard
              key={`dispute-${periodKey}`}
              periodKey={periodKey}
              periodLabel={periodLabel}
              openDispute={openDispute}
              allDisputes={disputes}
              shortedHours={shortedHours}
              embedded
              title="Did the claim get paid?"
            />
          )}
        </div>
      )}
    </section>
  );
}
