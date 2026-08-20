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
import { useRef, useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { fmtHours, fmtPct } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import { parseHours } from "@/lib/discrepancy";
import { setPaidPeriodHoursAction } from "@/app/actions/paid-periods";
import { efficiencyDisplay } from "@/lib/efficiency-display";
import type { ProjectionLabel } from "@/lib/period-mode";

function InProgressHero({
  flagHours,
  efficiency,
  // Flag hours the app could not pair with a day length, and how many days they
  // came from. Optional so the no-schedule shape (plain `aggregateStats`, which
  // has no excluded-day concept) still compiles and behaves exactly as before.
  unpairedFlagHours = 0,
  unpairedDays = 0,
  projection,
}: {
  flagHours: number;
  efficiency: number | null;
  unpairedFlagHours?: number;
  unpairedDays?: number;
  projection: ProjectionLabel;
}) {
  // Two independent pipelines meet in this one sentence — a per-day-gated
  // efficiency and a forecast built from the RAW flagged total — and until this
  // classification existed they could contradict each other out loud
  // ("0% efficiency · well ahead of your goal so far", 2026-08-18). See
  // lib/efficiency-display for the mechanism.
  const eff = efficiencyDisplay({
    flagHours,
    efficiency,
    unpairedFlagHours,
    unpairedDays,
  });

  return (
    <section className="period-hero" aria-label="Period progress">
      <p className="period-hero-eyebrow">Flagged so far</p>
      <p className="period-hero-figure tabular">
        {fmtHours(flagHours)}
        <span className="unit">h</span>
      </p>
      <p className="period-hero-support">
        {/* The projection is NOT suppressed alongside a withheld percentage,
            and it is not qualified either. It answers a different question —
            flagged hours against the goal — and that question does not need a
            measurable day length, so the forecast's raw total is the right
            input and its claim is true. What was wrong was welding the two
            clauses into one sentence with a middot: a withheld efficiency and
            "well ahead of your goal" read as a contradiction sitting side by
            side, and read as two separate facts once they are two separate
            lines. So the efficiency clause LEAVES this line when it can't be
            stated, rather than the projection being censored to protect it. */}
        {eff.kind === "shown" && <>{fmtPct(eff.pct)} efficiency</>}
        {eff.kind === "shown" && projection.kind !== "none" && " · "}
        {projection.kind === "projected" && (
          // Each figure keeps its unit — and "goal" keeps its number — on one
          // line. Without this the sentence orphans "goal" onto its own row.
          <>
            on this pace you land at{" "}
            <strong className="whitespace-nowrap">
              {fmtHours(projection.projected)}h
            </strong>{" "}
            of your{" "}
            <strong className="whitespace-nowrap">
              {fmtHours(projection.goal)}h goal
            </strong>
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

      {/* Never a silent blank — the same rule WorkCostCard states for its
          effective-hourly headline, in the same voice: every branch names what
          is missing.

          It stops at NAMING it. The fix ("clock them or add them to your
          schedule") lives in PeriodStats' "Not counted above" caption, which
          renders in this same header band whenever these hours exist — a
          strict superset of this state, so it is always on screen with this.
          Repeating the instruction two elements apart is the pile-of-parts
          noise the redesign removed; a figure gets one home. */}
      {eff.kind === "all_excluded" && (
        <p className="card-inset mt-3 px-3 py-2 text-xs text-[var(--fg-2)]">
          No efficiency yet — all{" "}
          <span className="font-medium text-[var(--fg-1)]">
            {fmtHours(eff.excludedHours)}h
          </span>{" "}
          flagged so far landed on {eff.days === 1 ? "a day" : `${eff.days} days`}{" "}
          {/* The {" "} above is load-bearing: text following an expression
              container loses its leading space in the JSX transform. Same trap
              that shipped "1 daywith" in PeriodStats. */}
          with no hours to measure {eff.days === 1 ? "it" : "them"} against.
        </p>
      )}
      {eff.kind === "mostly_excluded" && (
        <p className="card-inset mt-3 px-3 py-2 text-xs text-[var(--fg-2)]">
          Efficiency isn&apos;t shown —{" "}
          <span className="font-medium text-[var(--fg-1)]">
            {fmtHours(eff.excludedHours)}h
          </span>{" "}
          of the {fmtHours(eff.totalHours)}h flagged so far landed on{" "}
          {eff.days === 1 ? "a day" : `${eff.days} days`} with no hours to
          measure {eff.days === 1 ? "it" : "them"} against, so the percentage
          would leave out most of your work.
        </p>
      )}
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

  // The figure this hero has already written, or has in the air right now.
  // A mode is only `awaiting_pay` while paid_period_hours has NO row for the
  // period (see lib/period-mode), so this starts null by construction — there
  // is no initial value to seed it with.
  //
  // It is what stops the two routes to the same value from both writing it.
  // Focus bookkeeping can't do that job here: `relatedTarget` is null for a
  // clicked button in Safari and Firefox/macOS, and `onMouseDown` preventDefault
  // (DiscrepancyCard's second guard) suppresses the focus move but NOT the click
  // that follows it — so on a submit button, unlike a reset button, neither
  // trick actually collapses blur+click into one write. Comparing the VALUE does,
  // in every browser and every input modality.
  const savedRef = useRef<number | null>(null);

  const parsed = parseHours(text);

  // `explicit` is true when the tech asked for this — the "Check my pay" button
  // or Enter — and false when the field merely lost focus. The difference is
  // only whether an empty/unparseable field is worth an error message: clicking
  // away from a blank box is not a failed attempt at anything.
  function commit(explicit: boolean) {
    if (parsed === null) {
      if (explicit) setError("Enter the flag hours from your stub, e.g. 74.2");
      return;
    }
    // `parsed` is non-null HERE — the early return above guarantees it — so
    // this can never be the `null === null` comparison that swallowed the first
    // figure a tech typed into DiscrepancyCard. Ordering is the guard.
    if (parsed === savedRef.current) return;
    const value = parsed;
    const previous = savedRef.current;
    // Claimed SYNCHRONOUSLY, before the transition starts: clicking "Check my
    // pay" fires the input's blur first and the form's submit second, and this
    // assignment is what makes that second call a no-op. State would be too
    // late — both handlers run against the same render.
    savedRef.current = value;
    setError(null);
    startSaving(async () => {
      try {
        // Validation answers with { error } — a thrown one would be redacted in
        // production. Only DB failures reach the catch.
        const res = await setPaidPeriodHoursAction(periodKey, value);
        if (res.error) {
          // Nothing landed, so un-claim it — otherwise the retry the error
          // message is asking for would dedupe against a write that failed.
          savedRef.current = previous;
          setError(res.error);
          return;
        }
        onSaved();
      } catch (e) {
        savedRef.current = previous;
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
          commit(true);
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
            // Same "type it, click away, it's saved" contract as the paid-hours
            // field in DiscrepancyCard, which writes this exact column. Two
            // fields that look the same and take the same figure must not
            // disagree about what clicking away means.
            //
            // No relatedTarget guard, and deliberately so: this form's only
            // other focusable element is the submit button, and blurring INTO
            // it means the same write, not a different one (DiscrepancyCard
            // needs its guard because the neighbour there is a DELETE). The
            // value check in commit() collapses the pair into one write.
            onBlur={() => commit(false)}
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
