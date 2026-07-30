"use client";

// The Pay Period page.
//
// This page grew card-by-card until it was nine peers of identical visual
// weight stacked in source order, with no answer to "what am I looking at".
// The redesign is an information-architecture pass, not a maths rewrite —
// every figure below comes from the same pure functions it always did.
//
// Three ideas do the work:
//
//  1. THREE MODES. A period asks a different question depending on where it
//     sits in the pay cycle (lib/period-mode). The hero answers that question.
//
//  2. SOFT MODES. The mode changes emphasis, ORDER, and what starts expanded —
//     never what exists. Everything renders in every mode; demoted cards move
//     to the rail under a "Reference" divider. A tech looking for a card the
//     mode de-prioritised still finds it in a predictable place.
//
//  3. TWO FAMILIES. Five pay-correctness cards were really two questions:
//     "was I paid what I flagged?" (PaidCheckCard) and "was flagging even the
//     right measure of my work?" (WorkCostCard).
//
// Scope rule for anything added later: if a number needs data from OUTSIDE the
// viewed period, it does not belong on this page. Trends go to /insights,
// in-the-moment prompts go to the timer.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  Bonus,
  DailyClock,
  Dispute,
  Entry,
  OpCode,
  UnpaidTime,
} from "@/lib/types";
import type { PeriodRange } from "@/lib/periods";
import type { Stats } from "@/lib/stats";
import type { Forecast } from "@/lib/forecast";
import {
  hasAnyRate,
  periodEarnings,
  warrantyLoss as computeWarrantyLoss,
  type RateMap,
} from "@/lib/earnings";
import {
  clockFlagGap,
  effectiveHourly,
  gapComposition,
  unflaggedTimeValue,
} from "@/lib/wage-check";
import { buildUnpaidSummary } from "@/lib/unpaid-summary";
import { formatPeriodLabel } from "@/lib/periods";
import { periodMode, projectionLabel, type PeriodMode } from "@/lib/period-mode";
import { clearPeriodOverrideAction } from "@/app/actions/settings";
import { RoList } from "@/components/ro/RoList";
import { reconcileEntries } from "@/lib/reconcile";
import { PaidCheckCard } from "./PaidCheckCard";
import { PeriodHero } from "./PeriodHero";
import { PeriodOverrideModal } from "./PeriodOverrideModal";
import { PeriodStats } from "./PeriodStats";
import { PeriodTitleBar } from "./PeriodTitleBar";
import { SpiffsCard } from "./SpiffsCard";
import { WorkCostCard } from "./WorkCostCard";

type CardKey = "paidCheck" | "workCost" | "spiffs" | "roList";

// Which cards lead, which sit in the reference rail, what starts expanded, and
// whether the RO list is capped. Nothing here decides VISIBILITY — every key
// appears in exactly one of `main` or `rail` for every mode.
const LAYOUT: Record<
  PeriodMode,
  {
    main: CardKey[];
    rail: CardKey[];
    open: Partial<Record<CardKey, boolean>>;
    // undefined = show every RO.
    roCap?: number;
  }
> = {
  // Mid-period the page is a work log: what have I produced, what is it costing
  // me. There is no stub to check yet, so the pay-correctness family demotes.
  in_progress: {
    main: ["workCost", "roList"],
    rail: ["spiffs", "paidCheck"],
    open: { workCost: true },
  },
  // The period is closed and the hero IS the call to action. The RO list is the
  // evidence you're about to check the stub against, so it leads — capped,
  // because you check it against a number, not by reading 58 rows.
  awaiting_pay: {
    main: ["roList", "workCost"],
    rail: ["spiffs", "paidCheck"],
    open: { workCost: true },
    roCap: 10,
  },
  // Paid. Now the whole page is an audit, and reconciliation — not the raw list
  // — is the real drill-down.
  settled: {
    main: ["paidCheck", "workCost"],
    rail: ["spiffs", "roList"],
    open: { paidCheck: true, workCost: true },
    roCap: 10,
  },
};

export function PayPeriodView({
  availablePeriods,
  currentKey,
  selected,
  hasOverride,
  stats,
  paidFlagHours,
  entries,
  library,
  rates = {},
  techName = null,
  entryIdsWithPhotos,
  bonuses = [],
  bonusDefaultDate,
  clocks = [],
  referenceRate = null,
  unpaid = [],
  disputes = null,
  openDispute = null,
  today,
  goalHours = 0,
  forecast = null,
}: {
  availablePeriods: PeriodRange[];
  currentKey: string;
  selected: PeriodRange;
  hasOverride: boolean;
  stats: Stats;
  paidFlagHours: number | null;
  entries: Entry[];
  library: OpCode[];
  rates?: RateMap;
  techName?: string | null;
  entryIdsWithPhotos?: Set<string>;
  bonuses?: Bonus[];
  bonusDefaultDate?: string;
  clocks?: DailyClock[];
  referenceRate?: number | null;
  // Ledger rows for the selected period. Empty until the Phase 2 migration
  // lands, which just means every unpaid-time surface reports zero.
  unpaid?: UnpaidTime[];
  // Every dispute ever raised, plus the live claim for the viewed period.
  //
  // NULL means the dispute-ledger migration hasn't been applied yet — distinct
  // from [] meaning "migrated, nothing disputed". The dispute section MUST stay
  // hidden on null: otherwise it would offer a "Track this dispute" button whose
  // action throws on the missing table. Same null-vs-empty contract as
  // listWorkSchedulesSafe.
  disputes?: Dispute[] | null;
  openDispute?: Dispute | null;
  // Timezone-corrected "today" from the page, so mode selection can't disagree
  // with the rest of the app about which day it is.
  today: string;
  goalHours?: number;
  // Null when the period isn't the current one — projecting a closed period is
  // meaningless, so the page doesn't compute it.
  forecast?: Forecast | null;
}) {
  const router = useRouter();
  // Dollars are additive: null when no rates are priced, so PeriodStats/RoList
  // render exactly as before.
  const showMoney = hasAnyRate(rates);
  const earnings = showMoney ? periodEarnings(entries, rates) : null;
  const warrantyLoss = showMoney ? computeWarrantyLoss(entries, rates) : null;

  // Pay Check-Up math. effectiveHourly re-filters to the range defensively, so
  // passing period-scoped entries/bonuses plus the full clock list is fine.
  const wageCheck = effectiveHourly(entries, clocks, bonuses, rates, {
    start: selected.start,
    end: selected.end,
  });
  // Efficiency cross-link: reframe a low-efficiency period as unflagged time
  // with a dollar value. Only when clocked > flagged AND customer-pay is priced.
  const gapHours = clockFlagGap(wageCheck.clockedHours, wageCheck.flagHours);
  const unflaggedDollars = unflaggedTimeValue(gapHours, rates);
  const unflaggedTime =
    unflaggedDollars !== null ? { gapHours, dollars: unflaggedDollars } : null;
  // Unpaid time for the period, built once and shared: the records list reads
  // it, and the wage check uses the same totals to say what the clock-vs-flag
  // gap is made of. One source so the two can't disagree.
  const unpaidSummary = buildUnpaidSummary({
    entries,
    unpaid,
    library,
    rates,
    range: { start: selected.start, end: selected.end },
  });
  const gapParts = gapComposition(gapHours, unpaidSummary);
  const reconciled = reconcileEntries(entries);

  const mode = periodMode({
    end: selected.end,
    today,
    paidFlagHours,
  });
  const layout = LAYOUT[mode];

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [resetting, startResetting] = useTransition();
  const [resetError, setResetError] = useState<string | null>(null);

  function pickPeriod(key: string) {
    const params = new URLSearchParams();
    params.set("period", key);
    router.push(`/pay-period?${params.toString()}`);
  }

  function resetOverride() {
    setResetError(null);
    startResetting(async () => {
      try {
        await clearPeriodOverrideAction(selected.key);
        router.refresh();
      } catch (err) {
        setResetError(err instanceof Error ? err.message : "Failed to reset.");
      }
    });
  }

  // Dollar value of a period-level shortfall for the settled hero.
  //
  // Priced at the CUSTOMER-PAY rate specifically, not a blended average: a
  // period-level short is a claim about hours the stub didn't pay, and the
  // honest question is what those hours are worth at your normal rate. Null
  // when customer pay isn't priced — the hero then states hours only rather
  // than inventing a figure. The line-level Reconciliation card still prices
  // each shorted line at ITS own applicable rate.
  const shortDollars = (() => {
    if (paidFlagHours === null) return null;
    const diff = paidFlagHours - stats.flagHours;
    if (diff >= -0.1) return null;
    const rate = rates.customer_pay ?? null;
    return rate === null ? null : Math.abs(diff) * rate;
  })();

  const cards: Record<CardKey, React.ReactNode> = {
    paidCheck: (
      <PaidCheckCard
        key="paidCheck"
        periodKey={selected.key}
        periodLabel={formatPeriodLabel(selected)}
        mode={mode}
        stats={stats}
        paidFlagHours={paidFlagHours}
        entries={entries}
        library={library}
        rates={rates}
        techName={techName}
        entryIdsWithPhotos={entryIdsWithPhotos}
        disputes={disputes}
        openDispute={openDispute}
        shortedHours={reconciled.shortedHours}
        defaultOpen={layout.open.paidCheck ?? false}
      />
    ),
    workCost: (
      <WorkCostCard
        key="workCost"
        result={wageCheck}
        referenceRate={referenceRate}
        gapParts={gapParts}
        unpaid={unpaidSummary}
        defaultOpen={layout.open.workCost ?? false}
      />
    ),
    spiffs: (
      <SpiffsCard
        key={`spiffs-${selected.key}`}
        bonuses={bonuses}
        flagPay={earnings}
        defaultDate={bonusDefaultDate}
      />
    ),
    roList: (
      <section key="roList">
        <h2 className="section-title">ROs in this period</h2>
        <RoList
          entries={entries}
          library={library}
          rates={rates}
          maxRows={layout.roCap}
          emptyState={
            <div className="card p-6 text-center">
              <p className="text-sm text-[var(--fg-2)]">
                No ROs in this period.
              </p>
            </div>
          }
        />
      </section>
    ),
  };

  return (
    <main className="pay-period-page">
      <PeriodTitleBar
        availablePeriods={availablePeriods}
        selected={selected}
        currentKey={currentKey}
        hasOverride={hasOverride}
        mode={mode}
        onPick={pickPeriod}
        onEditDates={() => setOverrideOpen(true)}
        onResetDates={resetOverride}
        resetting={resetting}
      />

      {resetError && (
        <p className="pp-error">{resetError}</p>
      )}

      <div className="pay-period-body">
        {/* Header band — spans both columns on desktop. The hero answers the
            mode's question; the stat row is the supporting context. */}
        <div className="pp-band">
          {mode === "in_progress" && (
            <PeriodHero.InProgress
              flagHours={stats.flagHours}
              efficiency={stats.efficiency}
              projection={
                forecast
                  ? projectionLabel(forecast, goalHours)
                  : { kind: "none" }
              }
            />
          )}
          {mode === "awaiting_pay" && (
            <PeriodHero.AwaitingPay
              periodKey={selected.key}
              flagHours={stats.flagHours}
              roCount={stats.roCount}
              onSaved={() => router.refresh()}
            />
          )}
          {mode === "settled" && paidFlagHours !== null && (
            <PeriodHero.Settled
              paidFlagHours={paidFlagHours}
              flagHours={stats.flagHours}
              shortDollars={shortDollars}
            />
          )}

          <PeriodStats
            stats={stats}
            earnings={earnings}
            warrantyLoss={warrantyLoss}
            unflaggedTime={unflaggedTime}
            hideFlagHours={mode !== "settled"}
          />
        </div>

        <div className="pp-main">{layout.main.map((k) => cards[k])}</div>

        <div className="pp-rail">
          <p className="pp-rail-divider">Reference</p>
          {layout.rail.map((k) => cards[k])}
        </div>
      </div>

      {overrideOpen && (
        <PeriodOverrideModal
          open={overrideOpen}
          periodKey={selected.key}
          initialRange={selected}
          onClose={() => setOverrideOpen(false)}
        />
      )}
    </main>
  );
}
