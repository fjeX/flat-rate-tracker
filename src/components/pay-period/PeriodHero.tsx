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

  // What has actually LANDED. `savedRef` is a claim — it goes up before the
  // write is issued, precisely so the blur and the click that follows it can't
  // both write. That makes it the wrong thing to ask "is this figure recorded?",
  // because on the ordinary click path the answer is already "yes" a line before
  // the write leaves the browser. Keeping the two apart is what lets an explicit
  // press be answered without ever answering it early.
  const writtenRef = useRef<number | null>(null);

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
    if (parsed === savedRef.current) {
      // The figure is already claimed, so it must not be WRITTEN again. But an
      // explicit press — the button, or Enter — can never be a silent no-op:
      // this hero lives entirely inside the window between the save and the
      // refresh that replaces it, so "already saved" is the state the primary
      // call to action is pressed in most often, and returning here left it
      // dead on screen with no write, no message and no disabled state.
      //
      // Answered only once the write has LANDED. During the in-flight window
      // the button is disabled and reads "Checking…", which is the honest
      // answer, and firing onSaved() there would advance the page for a write
      // that may still fail — and would fire twice on every ordinary click,
      // since the blur claims the value one line before the submit sees it.
      if (explicit && writtenRef.current === parsed) onSaved();
      return;
    }
    const value = parsed;
    const previous = savedRef.current;
    // Claimed SYNCHRONOUSLY, before the transition starts: clicking "Check my
    // pay" fires the input's blur first and the form's submit second, and this
    // assignment is what makes that second call a no-op. State would be too
    // late — both handlers run against the same render.
    savedRef.current = value;
    setError(null);
    startSaving(async () => {
      let res: { error?: string };
      try {
        // Validation answers with { error } — a thrown one would be redacted in
        // production. Only DB failures reach the catch.
        res = await setPaidPeriodHoursAction(periodKey, value);
      } catch (e) {
        fail(e instanceof Error ? e.message : "Failed to save.");
        return;
      }
      if (res.error) {
        fail(res.error);
        return;
      }

      // STALE SUCCESS. A newer figure has been claimed since this call left, so
      // this one no longer describes what is on screen. The newer save owns
      // both `writtenRef` and the refresh.
      if (savedRef.current !== value) return;
      writtenRef.current = value;

      // onSaved() IS OUTSIDE THE TRY, and that is the whole point of the shape
      // above. It is router.refresh() — a repaint of the page, not part of the
      // write. Inside the try, a refresh that threw un-claimed a value that is
      // sitting in the database and printed "Failed to save" over it, which
      // sends the tech to re-enter a figure that is already recorded and lets
      // the next blur write a duplicate. A failed refresh is a stale screen,
      // and the claim above is what keeps it from also becoming a second row.
      try {
        onSaved();
      } catch (e) {
        console.error("[PeriodHero] paid hours saved, refresh failed:", e);
      }

      function fail(message: string) {
        // Only un-claim what this call actually claimed. `previous` is captured
        // per call, so an OLDER save failing LATE used to restore ITS previous
        // value straight over a newer successful claim — and the next blur then
        // rewrote the newer figure. Reachable because the input is never
        // disabled during a save, only the button is.
        //
        // The same check silences the message: a figure the tech has already
        // typed past is not something to interrupt him about, and the newer
        // save reports its own outcome.
        if (savedRef.current !== value) return;
        savedRef.current = previous;
        setError(message);
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
            // `step="any"`, NOT 0.1. A flag-hours total off a real stub is
            // routinely two decimals — 74.25, 8.75 — and step={0.1} made every
            // one of those `stepMismatch: true`, so the browser refused to
            // submit the form: the button and Enter were dead for exactly the
            // figures this field exists to take. Blur has no constraint gate,
            // which is how the two routes came to disagree about 74.25.
            //
            // Widened to the precision the COLUMN holds and no further:
            // paid_period_hours.paid_flag_hours is numeric(6,2), and
            // `paidPeriodSchema` already bounds it at 0 … MAX_NUMERIC_6_2 with
            // a sentence the tech can read. `min={0}` stays because it is the
            // same floor the schema states. No `max` attribute is added on
            // purpose — the server owns that message, and a native tooltip on
            // the button path plus a server sentence on the blur path would
            // rebuild the same split this replaced.
            step="any"
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
