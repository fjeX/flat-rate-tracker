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

  // TWO REFS, TWO DIFFERENT QUESTIONS. Getting them confused is what left the
  // primary call to action dead on screen (2026-08-20), so each one states the
  // exact question it answers and nothing else touches it:
  //
  //   savedRef   — "what has the LATEST ISSUED call claimed?"  (issue order)
  //   writtenRef — "what does the DATABASE now hold?"          (arrival order)
  //
  // They are allowed to disagree, and the disagreement is the useful signal: a
  // claim with nothing landed under it is a figure still owed a write.

  // THE CLAIM. The figure the newest call has taken responsibility for — set
  // SYNCHRONOUSLY, before the write is issued.
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

  // WHAT LANDED. The value of the last write that came back SUCCESSFUL, in the
  // order the answers ARRIVED — recorded unconditionally, even when a newer
  // figure has been claimed since it left. That is the whole correction: this
  // ref describes the database, and the database does not care which call was
  // issued first. Suppressing it for a "stale" success threw away the one fact
  // the hero needs — 74.2 IS recorded — and the explicit press then had nothing
  // to answer with.
  //
  // `savedRef` is the wrong thing to ask "is this figure recorded?", because on
  // the ordinary click path the answer is already "yes" a line before the write
  // leaves the browser. Keeping the two apart is what lets an explicit press be
  // answered without ever answering it early.
  const writtenRef = useRef<number | null>(null);

  // WHICH CALL OWNS THE SHARED UI. Bumped once per issued write, so a callback
  // can ask "am I still the newest?" without inspecting savedRef — which the
  // failure path MUTATES, and which therefore cannot also be the thing that
  // identifies who is allowed to mutate it. The error line and onSaved() belong
  // to the latest ISSUED call and to nothing else.
  const seqRef = useRef(0);

  // How many writes are in the air. An explicit press is never answered with
  // silence, but "the answer is already on its way" is a real answer — the
  // button is disabled and reads "Checking…" for exactly this window. Without
  // this counter, re-issuing a claimed-but-unlanded figure would double-write on
  // every ordinary click, since the blur claims the value one line before the
  // submit sees it.
  const inFlightRef = useRef(0);

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
      // The error line, if one is up, was raised for a figure the tech has
      // since typed past — it belonged to the rejected value, not to this one.
      // This assignment used to sit BELOW this return, so correcting a rejected
      // figure back to the one already in the database left the rejection on
      // screen describing nothing.
      setError(null);

      // Clicking away is allowed to be a no-op. An explicit press is not: this
      // hero lives entirely inside the window between the save and the refresh
      // that replaces it, so "already claimed" is the state the primary call to
      // action is pressed in most often, and returning here left it dead on
      // screen with no write, no message and no disabled state.
      if (!explicit) return;

      // ALREADY IN THE DATABASE → answer the press with the refresh it asked
      // for. Note this asks `writtenRef`, never `savedRef`: on the ordinary
      // click path the value is claimed one line before the write leaves the
      // browser, and answering the claim would fire onSaved() twice on every
      // single click (mutation-proven).
      if (writtenRef.current === parsed) {
        onSaved();
        return;
      }

      // CLAIMED, NOT LANDED, AND STILL IN THE AIR → the answer is already on
      // its way. The button is disabled and reads "Checking…" for exactly this
      // window; firing onSaved() here would advance the page for a write that
      // may still fail.
      if (inFlightRef.current > 0) return;

      // CLAIMED, NOT LANDED, NOTHING IN FLIGHT. The claim is a promise nothing
      // kept — an older call arrived last and the database holds a different
      // figure (D5), or the call that claimed this value failed while a newer
      // one owned the error line. Falling through re-issues the write, so an
      // explicit press has exactly three possible answers — written, refreshed,
      // or "Checking…" — and silence is not one of them.
    }
    const value = parsed;
    const previous = savedRef.current;
    // Claimed SYNCHRONOUSLY, before the transition starts: clicking "Check my
    // pay" fires the input's blur first and the form's submit second, and this
    // assignment is what makes that second call a no-op. State would be too
    // late — both handlers run against the same render.
    savedRef.current = value;
    const seq = ++seqRef.current;
    inFlightRef.current += 1;
    setError(null);
    startSaving(async () => {
      try {
        let res: { error?: string };
        try {
          // Validation answers with { error } — a thrown one would be redacted
          // in production. Only DB failures reach the catch.
          res = await setPaidPeriodHoursAction(periodKey, value);
        } catch (e) {
          fail(e instanceof Error ? e.message : "Failed to save.");
          return;
        }
        if (res.error) {
          fail(res.error);
          return;
        }

        // IT LANDED. Recorded unconditionally, before any staleness question is
        // asked, because this ref describes the DATABASE and the database took
        // this row whether or not a newer figure has been claimed since. The
        // old code returned here when a newer call had been issued, and that
        // discarded the only proof that 74.2 was recorded — after which the
        // newer call's failure restored the claim to 74.2 and the explicit
        // press found a claim with nothing under it, forever.
        writtenRef.current = value;

        // The REFRESH, though, belongs to the newest issued call only. Advancing
        // the page from an older call repaints it as settled on a figure the
        // tech has already typed past — and does it while the newer figure's
        // rejection is on screen, so the page and the error line contradict
        // each other out loud.
        if (seq !== seqRef.current) return;

        // onSaved() IS OUTSIDE THE INNER TRY, and that is the whole point of the
        // shape above. It is router.refresh() — a repaint of the page, not part
        // of the write. Inside the try, a refresh that threw un-claimed a value
        // that is sitting in the database and printed "Failed to save" over it,
        // which sends the tech to re-enter a figure that is already recorded and
        // lets the next blur write a duplicate. A failed refresh is a stale
        // screen, and the claim above is what keeps it from also becoming a
        // second row.
        try {
          onSaved();
        } catch (e) {
          console.error("[PeriodHero] paid hours saved, refresh failed:", e);
        }
      } finally {
        // Every exit from this callback passes through here — including the two
        // `fail()` returns. An undercounted decrement would leave the hero
        // believing a write is forever in the air, which is the one state that
        // makes the press-with-nothing-landed branch above go silent again.
        inFlightRef.current -= 1;
      }

      function fail(message: string) {
        // Only the newest ISSUED call owns the claim and the error line.
        // `previous` is captured per call, so an OLDER save failing LATE used to
        // restore ITS previous value straight over a newer successful claim —
        // and the next blur then rewrote the newer figure. Reachable because the
        // input is never disabled during a save, only the button is.
        //
        // Keyed on the sequence number rather than on `savedRef`, because
        // `savedRef` is the thing this function MUTATES: after a stale success
        // restored it, an older call could match it again and un-claim a figure
        // it had no business touching.
        //
        // The same check silences the message: a figure the tech has already
        // typed past is not something to interrupt him about, and the newer
        // save reports its own outcome.
        if (seq !== seqRef.current) return;
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
            // `step="any"`, NOT 0.1. A flag-hours total off a real stub is
            // routinely two decimals — 74.25, 8.75 — and step={0.1} made every
            // one of those `stepMismatch: true`, so the browser refused to
            // submit the form: the button and Enter were dead for exactly the
            // figures this field exists to take. Blur has no constraint gate,
            // which is how the two routes came to disagree about 74.25.
            //
            // NO NATIVE BOUNDS AT ALL — no `step`, no `min`, no `max` — and that
            // is one decision, not three. Constraint validation runs on the
            // button and on Enter and does NOT run on blur, so every native rule
            // added here is a rule that stops one route and lets the other one
            // through in silence. `min={0}` was exactly that: "-5" is
            // `rangeUnderflow`, so the button answered with a browser tooltip
            // while clicking away answered with nothing at all. Now both routes
            // reach the same code — parseHours() rejects it, and an explicit
            // press says so in the app's own sentence.
            //
            // The real bounds live where the data does: paid_flag_hours is
            // numeric(6,2) and `paidPeriodSchema` enforces 0 … MAX_NUMERIC_6_2
            // with a sentence the tech can read, on whichever route he took.
            //
            // What `step="any"` does NOT do is police precision. 74.256 is a
            // valid entry here and Postgres rounds it to 74.26 on the way in —
            // the input is wider than the column, not equal to it. Narrowing it
            // to `step="0.01"` would trade a rounded figure for a dead button on
            // the blur path, which is the split above all over again.
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
