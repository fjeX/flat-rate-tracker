"use client";

// The one block at the top of the Pay Period page that answers the question the
// period is actually posing right now.
//
//   in_progress  → "Am I on pace?"        flagged so far + projection
//   awaiting_pay → "Did the check come?"  the paid-hours entry point
//   settled      → "Was it right?"        paid vs logged, and the gap
//
// The awaiting_pay variant is the reason this component exists rather than the
// hero being one more stat tile: it carries an input, and it is the only route
// from awaiting_pay into settled. Hiding that behind a card further down the
// page is what made the old layout feel like a pile of parts.
import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { fmtHours, fmtPct } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import { parseHours } from "@/lib/discrepancy";
import { setPaidPeriodHoursAction } from "@/app/actions/paid-periods";
import type { ProjectionLabel } from "@/lib/period-mode";

function InProgressHero({
  flagHours,
  efficiency,
  projection,
}: {
  flagHours: number;
  efficiency: number | null;
  projection: ProjectionLabel;
}) {
  return (
    <section className="period-hero" aria-label="Period progress">
      <p className="period-hero-eyebrow">Flagged so far</p>
      <p className="period-hero-figure tabular">
        {fmtHours(flagHours)}
        <span className="unit">h</span>
      </p>
      <p className="period-hero-support">
        {efficiency !== null && <>{fmtPct(efficiency)} efficiency</>}
        {efficiency !== null && projection.kind !== "none" && " · "}
        {projection.kind === "projected" && (
          <>
            on this pace you land at{" "}
            <strong>{fmtHours(projection.projected)}h</strong> of your{" "}
            <strong>{fmtHours(projection.goal)}h</strong> goal
          </>
        )}
        {projection.kind === "no_history" && (
          <>not enough history yet to project where this period lands</>
        )}
        {projection.kind === "implausible" && (
          <>
            {projection.state === "behind"
              ? "tracking behind your goal"
              : "well ahead of your goal so far"}{" "}
            — too early in the period for a reliable projection
          </>
        )}
      </p>
    </section>
  );
}

function AwaitingPayHero({
  periodKey,
  flagHours,
  roCount,
  onSaved,
}: {
  periodKey: string;
  flagHours: number;
  roCount: number;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const parsed = parseHours(text);

  function submit() {
    if (parsed === null) {
      setError("Enter the flag hours from your stub, e.g. 74.2");
      return;
    }
    setError(null);
    startSaving(async () => {
      try {
        await setPaidPeriodHoursAction(periodKey, parsed);
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  }

  return (
    <section className="period-hero" aria-label="Log what you were paid">
      <p className="period-hero-eyebrow">This period is done — got your stub?</p>
      <p className="period-hero-figure tabular">
        {fmtHours(flagHours)}
        <span className="unit">h flagged</span>
      </p>
      <p className="period-hero-support">
        Enter what you were actually paid and FRT checks it line by line against
        these <strong>{roCount}</strong> {roCount === 1 ? "RO" : "ROs"}.
      </p>

      <form
        className="period-hero-action"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="hero-paid-hours">
            Paid flag hours
          </label>
          <input
            id="hero-paid-hours"
            className="input mono"
            type="number"
            min={0}
            step={0.1}
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. 74.2"
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Checking…" : "Check my pay"}
          {!saving && <ArrowRight className="h-4 w-4" />}
        </button>
      </form>

      {error && <p className="period-hero-error">{error}</p>}
    </section>
  );
}

function SettledHero({
  paidFlagHours,
  flagHours,
  shortDollars,
}: {
  paidFlagHours: number;
  flagHours: number;
  // Dollar value of the shortfall, or null when no customer-pay rate is priced.
  shortDollars: number | null;
}) {
  const diff = paidFlagHours - flagHours;
  // Same tolerance the period-level discrepancy check uses, so the hero and the
  // card below can never disagree about whether this period came up short.
  const isShort = diff < -0.1;
  const isOver = diff > 0.1;

  return (
    <section
      className={`period-hero${isShort ? " is-short" : isOver ? " is-over" : " is-match"}`}
      aria-label="Pay result for this period"
    >
      <p className="period-hero-eyebrow">
        {isShort ? "Short on this period" : isOver ? "Paid over" : "Paid in full"}
      </p>
      <p className="period-hero-figure tabular">
        {isShort || isOver ? (
          <>
            {fmtHours(Math.abs(diff))}
            <span className="unit">h</span>
          </>
        ) : (
          <>
            {fmtHours(paidFlagHours)}
            <span className="unit">h</span>
          </>
        )}
      </p>
      <p className="period-hero-support">
        Paid <strong>{fmtHours(paidFlagHours)}h</strong> against{" "}
        <strong>{fmtHours(flagHours)}h</strong> logged
        {isShort && shortDollars !== null && (
          <> — about <strong>{fmtMoney(shortDollars)}</strong> at your customer-pay rate</>
        )}
        {!isShort && !isOver && " — no discrepancy to chase"}
        .
      </p>
    </section>
  );
}

export const PeriodHero = {
  InProgress: InProgressHero,
  AwaitingPay: AwaitingPayHero,
  Settled: SettledHero,
};
