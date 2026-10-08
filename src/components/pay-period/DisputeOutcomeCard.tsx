"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtHours } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import {
  daysWaiting,
  disputeOutcome,
  isClosed,
  lifetimeRecovery,
  nextStatus,
  periodRecoveryPlan,
  type RecoveryApplication,
} from "@/lib/disputes";
import {
  DISPUTE_SCOPE_LABELS,
  DISPUTE_STATUS_LABELS,
  type Dispute,
  type Entry,
  type OpCode,
} from "@/lib/types";
import {
  applyDisputeRecoveryAction,
  openDisputeAction,
  recordDisputeOutcomeAction,
  setDisputeStatusAction,
} from "@/app/actions/disputes";
import { actionErrorMessage } from "@/lib/action-error";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { withPt } from "@/components/ui/Figure";
import { StatusField } from "@/components/ui/StatusField";

// Tone per lifecycle state. Only a resolved claim is the good state. 'answered'
// stays a plain tag: they replied, but the claim isn't settled until the tech
// records what actually came back.
const STATUS_TONE: Record<Dispute["status"], "neutral" | "good"> = {
  generated: "neutral",
  submitted: "neutral",
  answered: "neutral",
  resolved: "good",
  withdrawn: "neutral",
};

// "A closed claim round on this period." The ONE definition of the predicate:
// the card reads it for the latest round, the sum over every round, the round
// count, and the per-round recovery plan. A second copy is exactly how the sum
// and the round under it once stopped describing the same thing.
const closedIn = (periodKey: string) => (d: Dispute) =>
  d.periodKey === periodKey && isClosed(d.status);

const EMPTY_PLAN: RecoveryApplication = {
  rows: [],
  applyHours: 0,
  unmappedHours: 0,
  needsLineBreakdown: false,
  moved: [],
  enteredLines: [],
};

function OutcomeForm({
  dispute,
  onDone,
}: {
  dispute: Dispute;
  onDone: () => void;
}) {
  const router = useRouter();
  // Both fields start EMPTY. Seeding them with the claim recorded the ASK as
  // the PAYMENT on a single tap — prod had 4 of 5 priced claims storing
  // recovered == claimed to the cent, and in three of those the tech had
  // edited the hours while the dollar figure sat untouched at the prefill.
  // Filling from the claim is now an explicit tap (fillFromClaim below).
  //
  // Re-opening an already-closed claim seeds from what was stored. That checks
  // resolvedAt, not truthiness: recoveredHours 0 is a real answer ("they denied
  // it"), and `recoveredHours || claimedHours` silently replaced it with the ask.
  const closed = dispute.resolvedAt !== null;
  const [hoursText, setHoursText] = useState(
    closed ? String(dispute.recoveredHours) : "",
  );
  const [dollarsText, setDollarsText] = useState(
    closed && dispute.recoveredDollars !== null
      ? String(dispute.recoveredDollars)
      : "",
  );
  const [note, setNote] = useState(dispute.note);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function fillFromClaim() {
    setError(null);
    setHoursText(String(dispute.claimedHours));
    setDollarsText(
      dispute.claimedDollars !== null ? String(dispute.claimedDollars) : "",
    );
  }

  function save() {
    const hoursTrimmed = hoursText.trim();
    // Blank is not zero. Number("") is 0, so without this an untouched form
    // would close the claim at "recovered nothing" — the mirror of the bug
    // that made it record the full ask.
    if (hoursTrimmed === "") {
      setError("Enter recovered hours, or tap Same as claimed.");
      return;
    }
    const hours = Number(hoursTrimmed);
    if (!Number.isFinite(hours) || hours < 0) {
      setError("Recovered hours must be 0 or more.");
      return;
    }
    const trimmed = dollarsText.trim();
    // Empty stays null — "we don't know what that was worth" is a real answer
    // and must not be recorded as $0.
    const dollars = trimmed === "" ? null : Number(trimmed);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
      setError("Recovered dollars must be $0 or more.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await recordDisputeOutcomeAction(dispute.id, {
          recoveredHours: hours,
          recoveredDollars: dollars,
          note,
          status: "resolved",
        });
        // A refusal comes back as data (a thrown one would be masked in prod).
        if ("error" in res) {
          setError(res.error);
          return;
        }
        // Deliberately NO onDone() here. router.refresh() is not awaitable —
        // it schedules a refresh, so closing the form from this callback (in
        // either order) unmounts it before the resolved data arrives, and the
        // tech sees "Waiting on a response / Recovered 0.0h" right after saving
        // and concludes it failed. Verified against prod: reordering did not fix
        // it, because ordering was never the problem.
        //
        // Instead the form is data-driven: it stays mounted (with the button on
        // "Saving…", since refresh() inside a transition holds isPending until
        // the new payload lands) and the parent unmounts it once the dispute
        // actually reads as closed. The UI can then never show a state the
        // server hasn't confirmed.
        router.refresh();
      } catch (e) {
        setError(actionErrorMessage(e, "Failed to save."));
      }
    });
  }

  return (
    <div className="pp-well pp-stack">
      <div className="pp-tool-head">
        <p className="pp-sub">
          What did they actually pay back? Leave dollars blank if you only know
          the hours.
        </p>
        <Button variant="quiet" onClick={fillFromClaim}>
          Same as claimed
        </Button>
      </div>
      <div className="pp-pair">
        <label className="field">
          <span className="field-label">Recovered hrs</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={hoursText}
            onChange={(e) => setHoursText(e.target.value)}
            placeholder="—"
            aria-label="Recovered hours"
            className="input mono"
          />
        </label>
        <label className="field">
          <span className="field-label">Recovered $</span>
          <input
            type="number"
            min={0}
            step={1}
            value={dollarsText}
            onChange={(e) => setDollarsText(e.target.value)}
            placeholder="—"
            aria-label="Recovered dollars"
            className="input mono"
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">What happened</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Ray adjusted 3 of the 4 lines…"
          aria-label="Outcome note"
          className="input"
        />
      </label>
      {error && (
        <StatusField tag="Fix" role="alert" inset><p>
          {error}
        </p></StatusField>
      )}
      <div className="pp-btnrow is-end">
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="go" onClick={save} disabled={isPending} busy={isPending}>
          {isPending ? "Saving…" : "Close out claim"}
        </Button>
      </div>
    </div>
  );
}

export function DisputeOutcomeCard({
  periodKey,
  periodLabel,
  openDispute,
  allDisputes,
  entries,
  library,
  shortedHours,
  pendingCount,
  pendingHours,
  periodEnded,
  embedded = false,
  title = "Dispute Tracking",
}: {
  periodKey: string;
  periodLabel: string;
  // The live claim for the viewed period, if one exists.
  openDispute: Dispute | null;
  // Every dispute the user has ever raised — drives the lifetime figure.
  allDisputes: Dispute[];
  // The period's live ROs and the code library, used ONLY to work out which
  // lines a closed claim's recovery lands on. Same two inputs the dispute pack
  // was built from, so the rows offered here are the rows that were claimed.
  entries: Entry[];
  library: OpCode[];
  // Outstanding hours for the viewed period, so the card knows whether there is
  // anything worth claiming yet. This is Reconciliation's shortfall — lines paid
  // LESS than flagged — and it is exactly what the claim freezes by default.
  shortedHours: number;
  // Lines with no paid hours recorded at all, and what they flagged. Offered as
  // an explicit opt-in below rather than folded into the claim, because an
  // unmarked line usually means "not reconciled yet", not "not paid".
  pendingCount: number;
  pendingHours: number;
  // Whether the period is actually over. Pending lines are only claimable then —
  // matches the gate in buildDisputePack, so the checkbox can never promise
  // hours the server would drop. Deliberately not derived from PeriodMode:
  // entering paid hours early makes a still-running period read as `settled`.
  periodEnded: boolean;
  // Rendered as a section INSIDE PaidCheckCard rather than as its own card on
  // the page. Drops the card chrome only — behaviour is identical.
  embedded?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // null = not recording. Otherwise it records WHICH kind of recording session
  // is open, because the two unmount on different signals:
  //   reopen:false — a live claim being closed out. Unmounts when the dispute
  //     reads as closed (the original, data-driven rule; see OutcomeForm.save).
  //   reopen:true  — an already-closed claim being corrected. "Closed" is the
  //     starting state here, so that rule would unmount the form instantly.
  //     `at` freezes the dispute's updatedAt when the form opened; updateDispute
  //     always re-stamps updated_at, so the form drops the moment — and only the
  //     moment — the corrected row actually comes back from the server.
  const [recording, setRecording] = useState<
    { reopen: false } | { reopen: true; at: string } | null
  >(null);
  // Opt-in, never the default: see the doc comment on openDisputeAction.
  const [claimPending, setClaimPending] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);

  const canOfferPending = periodEnded && pendingCount > 0;
  // What the claim will actually freeze. Shown on the button so the figure the
  // tech sees and the figure the ledger records are the same number.
  const claimTotal = shortedHours + (claimPending ? pendingHours : 0);

  const lifetime = lifetimeRecovery(allDisputes);
  // "A closed claim round on THIS period." Written once and read three ways
  // below — the latest round, the sum over every round, and how many rounds
  // that sum covers. A second copy of the predicate is exactly how the sum and
  // the round under it stopped describing the same thing.
  const isClosedHere = closedIn(periodKey);
  // The closed claim for this period, if the live one is already gone. Lets a
  // finished period still show its outcome. Deliberately still a find over the
  // prop rather than the head of the filtered array below: indexing a locally
  // built array makes the React Compiler treat this useMemo dep as mutable and
  // bail out of optimizing the whole component.
  const closedForPeriod = allDisputes.find(isClosedHere);
  // Drives the OUTCOME section only. It used to gate the offer too, which meant
  // one closed claim hid the offer for the rest of the period's life — money
  // found after the claim went out stayed unclaimed with no way to ask for it.
  // The DB never agreed with that: disputes_one_open_per_period_idx excludes
  // terminal states precisely so a second-round claim is possible once the
  // first closes (20260729000000_dispute_ledger.sql:107-112).
  const dispute = openDispute ?? closedForPeriod ?? null;

  // What EVERY closed round's recovery would do to the live lines. It used to
  // be the newest closed round only (closedForPeriod), so closing a second
  // round hid the first round's still-unapplied Apply forever — its money was
  // never offered again and nothing said so. See periodRecoveryPlan.
  const periodRecovery = useMemo(
    () =>
      periodRecoveryPlan(
        allDisputes.filter(closedIn(periodKey)),
        entries,
        library,
        // Open rounds only gate breakdownEntered: a round the shop has paid
        // but the app hasn't closed may be what raised the claimed lines.
        allDisputes.filter(
          (d) => d.periodKey === periodKey && !isClosed(d.status),
        ),
      ),
    [allDisputes, periodKey, entries, library],
  );
  // The one round whose Apply is on screen — never two at once (see
  // PeriodRecovery.applyRound for why a second button is a double write).
  const applyRound = periodRecovery.applyRound;
  // The NEWEST closed round's plan, which the explanation paragraphs below
  // describe exactly as they always did. `rows` is empty unless there is real,
  // unapplied money to move — but the object itself is NOT empty in that case:
  // a closed claim that recovered hours nothing can be applied to still
  // reports them in unmappedHours, and that is precisely the state the tech
  // needs a sentence for. See pendingRecoveryApplication.
  const recovery = periodRecovery.rounds[0]?.plan ?? EMPTY_PLAN;
  // The rows panel's own plan. The same object as `recovery` whenever the
  // newest round is the one with something to apply.
  const applyPlan = applyRound?.plan ?? EMPTY_PLAN;
  // Hours already back from closed claims on THIS period. The re-offer used to
  // state the shortfall and nothing else, so a period that had recovered 34.0h
  // against a 31.4h short read as though nothing had ever been paid.
  const closedHere = allDisputes.filter(isClosedHere);
  const recoveredHere = closedHere.reduce((sum, d) => sum + d.recoveredHours, 0);
  // How many rounds that sum covers, and the number the whole re-offer sentence
  // agrees with. The copy said "on a closed claim" whatever the count was, so a
  // period claimed twice showed 71.1h beside a claim card reading 19.7h — the
  // sum of every round next to the latest round, with nothing in the words to
  // say they were different scopes. Note this counts CLOSED rounds, not rounds
  // that recovered something: a denied round is still a closed claim, and the
  // leading clause below renders in that state (recoveredHere === 0) while the
  // trailing one does not.
  const closedRounds = closedHere.length;

  // Nothing to claim, nothing ever claimed — the card has nothing to say.
  if (
    !dispute &&
    shortedHours <= 0 &&
    !canOfferPending &&
    lifetime.disputeCount === 0
  ) {
    return null;
  }

  function advance(to: Dispute["status"]) {
    if (!dispute) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await setDisputeStatusAction(dispute.id, to);
        if ("error" in res) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (e) {
        setError(actionErrorMessage(e, "Failed to update."));
      }
    });
  }

  function open() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await openDisputeAction(periodKey, {
          includePending: claimPending,
        });
        // "Nothing to dispute in this period." lands here, as a sentence.
        if ("error" in res) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (e) {
        setError(actionErrorMessage(e, "Failed to start tracking."));
      }
    });
  }

  function applyRecovery() {
    // The round the panel is showing, which is not necessarily the newest. The
    // action recomputes that one dispute server-side from its own id.
    const round = applyRound?.dispute;
    if (!round) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await applyDisputeRecoveryAction(round.id);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setApplied(result.appliedLines);
        router.refresh();
      } catch (e) {
        setError(actionErrorMessage(e, "Failed to apply recovery."));
      }
    });
  }

  const outcome = dispute ? disputeOutcome(dispute) : null;
  const waiting = dispute ? daysWaiting(dispute) : null;
  const next = dispute && !isClosed(dispute.status) ? nextStatus(dispute.status) : null;

  // WHICH PARAGRAPH EXPLAINS THE UNMAPPED HOURS — and why it cannot be one
  // paragraph.
  //
  // `recovery.unmappedHours > 0` is reached by three different roads, and they
  // do not mean the same thing to the tech:
  //
  //  - ROWS PLUS LEFTOVERS — some of the money landed on live lines and the
  //    rest didn't. The footnote under the rows.
  //  - NO ROWS, THE CLAIM HAD LINES — every line it named failed to find a live
  //    one (the RO was deleted: dispute_lines' FKs are ON DELETE SET NULL; or
  //    the op code's string was renamed, since the join is by CURRENT code
  //    string), or the settlement ran above the ask. Same explanation, nothing
  //    to apply underneath it.
  //  - NO ROWS, THE CLAIM HAD NO LINES — a period-total claim. This is the
  //    NORMAL shape of a non-itemized claim, not an edge case: disputeFromPack
  //    stores scope "period" with zero lines whenever the tech only had the
  //    stub's period totals. `claimed` is 0 for it, so fullSettlement can never
  //    fire — even a 100% payback lands here with the WHOLE recovery unmapped.
  //
  // All three rendered nothing at all unless rows existed, because the footnote
  // lived inside the rows panel. The last two left the tech looking at a
  // Recovered tile, a re-offer sentence still calling the period short, and not
  // one sentence saying why or what to do about it.
  //
  // The goodwill/deleted-RO wording is FALSE on the third road — a routine
  // payback of a period-total claim is neither of those things — so that road
  // gets its own paragraph.
  //
  // The split is `lines.length`, read off closedForPeriod: the dispute `recovery`
  // was actually computed from, NOT `dispute`, which may be a newer live round
  // whose line count has nothing to do with these hours. It is exact rather than
  // a heuristic, because every road into the loop tail needs at least one claim
  // line (usePerLine needs a recorded per-line recovery, fullSettlement needs
  // claimed > 0, singleLineRecovery needs exactly one line). So "no rows, no
  // lines, needsLineBreakdown false" is only ever the period-total early return.
  //
  // Deliberately NOT gated on `unmappedHours > 0` alone: the needsLineBreakdown
  // early return sets unmappedHours too, and that state already has its own
  // paragraph below. A bare unmapped check would print two contradictory
  // explanations of the same hours.
  const claimLineCount = closedForPeriod?.lines.length ?? 0;
  const unmappedIsUnplaceable =
    recovery.unmappedHours > 0 && !recovery.needsLineBreakdown;
  const showGoodwillNote = unmappedIsUnplaceable && claimLineCount > 0;
  // Only while the period still READS short. The period-total note's whole ask
  // is "go type the paid hours in yourself", so once that's done — shortedHours
  // back to 0 — the note has to stop. A note that keeps asking for something
  // already done is one the tech learns to scroll past, including the times it
  // matters.
  const showPeriodTotalNote =
    unmappedIsUnplaceable && claimLineCount === 0 && shortedHours > 0;
  // The rows panel's footnote qualifies the rows ABOVE it, so it is judged on
  // the round those rows came from. When that is the newest round this is
  // exactly showGoodwillNote; when an older round is on the lift, it is that
  // round's leftovers, and the newest round's (if any) render standalone below.
  const applyLineCount = applyRound?.dispute.lines.length ?? 0;
  const showApplyFootnote =
    applyPlan.unmappedHours > 0 &&
    !applyPlan.needsLineBreakdown &&
    applyLineCount > 0;
  // Hours one round's write may have stranded in another (see
  // PeriodRecovery.disarmedHours). Per-LINE meaningful by construction: each
  // line's figure is already capped at what that line is still short (less
  // any recovery still armed on it), so a line paid to flag contributes 0 and
  // cannot raise the note on the strength of some OTHER line's shortfall.
  // shortedHours > 0 stays as a belt: the note is about a short period.
  const disarmed = periodRecovery.disarmedLines;
  const showDisarmedNote =
    periodRecovery.disarmedHours > 0 && disarmed.length > 0 && shortedHours > 0;

  // OLDER ROUNDS WHOSE RECOVERY FOUND NO LINE. Every paragraph above explains
  // exactly two rounds: the newest (`recovery` — goodwill, period-total and
  // missing-breakdown notes) and the one on the Apply panel (its footnote). A
  // third round with unmappedHours > 0 has no rows, so it is never applyRound,
  // and it isn't rounds[0] — its hours were rendered nowhere. Prod had two such
  // rounds on one period (2.3h and 3.6h) with the card silent about both.
  //
  // Distinct from the disarmed note: disarmed hours are `moved` rows (they DID
  // find a line), unmappedHours is recovery minus every matched hour, so the
  // two never describe the same hour.
  //
  // CHECK, NEVER ADD — same reasoning as the disarmed note, and stronger here:
  // a newer round usually re-asks for the shortage an older round left, so an
  // older round's "Xh came back" is often money the tech already entered (or
  // the same payment the newer claim restated). A per-round "enter these
  // hours" is a double-pay prompt. The note names the claims and sends the
  // tech to the pay stub; it deliberately states no total to type in.
  //
  // Claims are named by order and ask ("your 1st claim (asked 3.0h)"). The
  // card has no date label for a claim, and a date built here would be a UTC
  // slice or a server/client-timezone hydration mismatch — the ordinal agrees
  // with the "across N closed claims" count above and the ask with the pack.
  const olderUnplaced = periodRecovery.rounds
    .map((r, i) => ({ r, i, nth: periodRecovery.rounds.length - i }))
    .filter(
      ({ r, i }) => i > 0 && r !== applyRound && r.plan.unmappedHours > 0,
    );
  const showOlderUnplacedNote = olderUnplaced.length > 0 && shortedHours > 0;
  // The missing-breakdown note asks the tech to enter paid hours per line —
  // the same ask as the period-total note, so it stops on the same condition:
  // once the period no longer reads short, the hours are already entered.
  // Only the RENDER is gated; unmappedIsUnplaceable and showApplyFootnote read
  // needsLineBreakdown raw, for mutual exclusion, and must keep doing so.
  //
  // shortedHours alone cannot see a PARTIAL settlement entered by hand: the
  // claimed lines still read short by the part the shop didn't pay, so the
  // note kept asking for "Xh … enter it" after the tech had — an add-it-again
  // prompt. breakdownEntered is the claimed lines' paid hours having risen by
  // the recovery since the claim froze them (see PeriodRecovery).
  const showBreakdownNote =
    recovery.needsLineBreakdown &&
    shortedHours > 0 &&
    !periodRecovery.breakdownEntered;
  const ordinal = (n: number) => {
    const t = n % 100;
    if (t >= 11 && t <= 13) return `${n}th`;
    return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
  };
  // Same three roads as the newest round's paragraphs, in their own words so
  // the existing paragraphs' phrases stay unique to them.
  //
  // The third road (the loop tail in pendingRecoveryApplication) is NOT only
  // "no live line": a claim line's write is capped at what it asked for, so
  // recovery ABOVE the ask lands here too — on a line that is still on the
  // period. "It didn't match any line still here" was false for that case
  // (asked 0.5h, got 1.0h, line alive). The plan cannot tell the two apart:
  // it carries unmappedHours as one figure, and splitting it would mean
  // re-deriving pendingRecoveryApplication's per-line write rule (hoursFor) in
  // the card — a second copy of a money rule, which is how the two drift. So
  // it names both, exactly as goodwillNote does for the newest round.
  const unplacedReason = (r: (typeof olderUnplaced)[number]["r"]) =>
    r.plan.needsLineBreakdown
      ? "because no per-line split was recorded"
      : r.dispute.lines.length === 0
        ? "because it was a period-total claim"
        : "which may be goodwill above what it asked for, or belong to a line that's since been deleted or changed";
  // Each claim shows what came back AND how much of that is unplaced. The
  // unplaced figure alone ("asked 0.5h — 0.5h") read as the whole recovery
  // when the claim actually got 1.0h and half of it was placed or is goodwill.
  // Compared at display precision, so "all of it" is exactly when the two
  // printed figures would be the same number.
  const unplacedPart = (r: (typeof olderUnplaced)[number]["r"]) =>
    fmtHours(r.plan.unmappedHours) === fmtHours(r.dispute.recoveredHours)
      ? "all of it"
      : `${fmtHours(r.plan.unmappedHours)}h of it`;

  // TWO OR MORE CLOSED CLAIMS: the newest round's notes stop saying "enter".
  //
  // Same count as the offer sentence's "across N closed claims". The
  // newest-round paragraphs (missing breakdown, period total, goodwill) each
  // ended in an instruction to type the hours in. With a single claim that is
  // right. With several, a newer claim usually re-asks for the shortage an
  // older one left, so "Xh came back — enter it" can be the same payment the
  // tech already entered from the other round, and the card was printing that
  // beside the older-claims note's "may be one payment counted twice… check
  // your pay stub". The paragraphs keep their own REASON (see the comment on
  // the period-total note — they must not borrow each other's words); only
  // the instruction at the end changes, from enter to check-then-maybe-enter.
  const multiClaim = closedRounds >= 2;
  const multiClaimCheck = (
    <>
      You have {closedRounds} closed claims on {periodLabel}, and another one
      may have asked for the same shortage, so these hours may already be on
      your lines. Check your pay stub first, and only enter paid hours in
      &ldquo;Which lines came up short?&rdquo; if your stub shows hours not
      already on a line.
    </>
  );

  // ONE copy, two homes, never both: inside the rows panel it is a footnote
  // under the rows it qualifies; with no rows there is no panel, so it renders
  // as its own inset alongside the other explanation paragraphs. The two sites
  // are mutually exclusive on rows.length, so the same hours are explained
  // exactly once.
  //
  // It must never read as "nothing is owed here". Unmapped hours are goodwill
  // only SOMETIMES: they are also a claimed line or RO deleted since, and hours
  // owed to a line that is still on the period but that the matcher refused to
  // guess at (a claim with no stored line id whose line's flag was edited — see
  // PASS 2 in resolveLiveLines). So the copy names all three and points at the
  // same control the sibling paragraphs do, quoted exactly as PaidCheckCard
  // renders it.
  const goodwillNote = (hours: number) => (
    <>
      {fmtHours(hours)}h of the recovery couldn&apos;t be matched to a line
      automatically — goodwill above what you asked for, or a line or RO
      that&apos;s since been deleted or changed.{" "}
      {multiClaim ? (
        <>
          FRT won&apos;t write those hours anywhere. Another claim on{" "}
          {periodLabel} may have asked for the same hours, so check your pay
          stub first, and only enter them in &ldquo;Which lines came up
          short?&rdquo; if they belong on a line that&apos;s still here and your
          stub shows hours not already on a line.
        </>
      ) : (
        <>
          FRT won&apos;t write those hours anywhere, so if they belong on a line
          that&apos;s still here, enter them in &ldquo;Which lines came up
          short?&rdquo; yourself.
        </>
      )}
    </>
  );

  const Root = embedded ? "div" : "section";

  return (
    <Root className={embedded ? "pp-stack" : "card padded-lg pp-stack"}>
      <div className="pp-sub-head">
        <h4 className="pp-sub-title">{title}</h4>
        {/* The lifetime "recovered all-time" figure used to sit here. It is
            cross-period data, so under the page's scope rule it belongs on a
            surface that owns lifetime numbers — and the dashboard's
            RecoveredCard already showed the identical figure. Removed rather
            than mirrored. */}
      </div>

      {/* Recovery lands here first. Above the second-round offer on purpose:
          the money that already came back is the thing to record before asking
          for more, and the offer's shortfall figure is the one this fixes. */}
      {applyPlan.rows.length > 0 && (
        <div className="pp-well pp-stack">
          <p className="pp-sub">
            <span className="pp-strong">
              {fmtHours(applyPlan.applyHours)}h came back and isn&apos;t on your
              lines yet.
            </span>{" "}
            <span>
              Until it is, {periodLabel} still reads{" "}
              {fmtHours(shortedHours)}h short and FRT will keep offering to
              claim it again.
            </span>
          </p>

          <ul className="pp-plain">
            {applyPlan.rows.slice(0, 5).map((row) => (
              <li key={row.lineId}>
                <span className="pp-strong">
                  RO <span className="num">{row.roNumber}</span>
                </span>
                <span>&middot; {row.code}</span>
                <span>
                  &middot; paid {row.paidNow === null ? "—" : `${fmtHours(row.paidNow)}h`}{" "}
                  &rarr;{" "}
                  <span className="pp-strong">
                    {fmtHours(row.paidAfter)}h
                  </span>
                </span>
              </li>
            ))}
            {applyPlan.rows.length > 5 && (
              <li>+ {applyPlan.rows.length - 5} more lines</li>
            )}
          </ul>

          {showApplyFootnote && (
            <p className="pp-fine">
              {goodwillNote(applyPlan.unmappedHours)}
            </p>
          )}

          {error && (
            <StatusField tag="Fix" role="alert" inset><p>
              {error}
            </p></StatusField>
          )}

          <div className="pp-btnrow">
            <Button
              variant="go"
              onClick={applyRecovery}
              disabled={isPending}
              busy={isPending}
            >
              {isPending
                ? "Applying…"
                : `Apply ${fmtHours(applyPlan.applyHours)}h to ${applyPlan.rows.length} line${applyPlan.rows.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}

      {/* The same footnote, standing on its own because there is no rows panel
          to sit under. Every hour of this recovery failed to find a live line,
          so there is nothing to apply and no button below it — the paragraph IS
          the whole story, which is why it gets card chrome here and none above. */}
      {showGoodwillNote && recovery.rows.length === 0 && (
        <StatusField tag="Note"><p>{goodwillNote(recovery.unmappedHours)}</p></StatusField>
      )}

      {/* Two or more closed rounds named the same line, and its paid hours
          have moved since — so the other round's hours on that line no longer
          match what that claim froze and can never be applied by FRT. Not
          goodwill (these hours DID map to a line) and not a missing breakdown
          (the lines are recorded), so it borrows neither paragraph's words.

          It asks the tech to CHECK, never to ADD. Rounds that froze a line at
          the same figure asked for the same shortage twice, and whether the
          shop's answers are two payments or one restated is on the pay stub,
          not in the data. "Enter the paid hours yourself" read as "add this"
          and, where the second round re-asked for the first round's money,
          walked the tech into paying the line twice. */}
      {showDisarmedNote && (
        <StatusField tag="Note"><p>
          Up to {fmtHours(periodRecovery.disarmedHours)}h recovered on your
          claims for {periodLabel} can&apos;t be applied automatically and may
          not be on your lines yet:{" "}
          {disarmed
            .slice(0, 3)
            .map((l) => `RO ${l.roNumber} ${l.code} (${fmtHours(l.hours)}h)`)
            .join(", ")}
          {disarmed.length > 3 ? `, and ${disarmed.length - 3} more` : ""}.
          More than one claim asked for the same line and its paid hours have
          changed since, so FRT can&apos;t tell whether those hours came on top
          of the other claim&apos;s or were the same shortage asked for twice.
          Check each line against your pay stub, and only enter more paid hours
          in &ldquo;Which lines came up short?&rdquo; if the shop paid them
          separately.
        </p></StatusField>
      )}

      {/* Older closed rounds whose recovery found no line — see
          olderUnplaced. One combined note, capped like the disarmed note: N
          paragraphs each reading "Xh came back" is N add-this prompts for what
          may be one shortage. */}
      {showOlderUnplacedNote && (
        <StatusField tag="Note"><p>
          {olderUnplaced.length === 1
            ? `An older claim for ${periodLabel} also`
            : `${olderUnplaced.length} older claims for ${periodLabel} also`}{" "}
          got hours back that FRT can&apos;t place on a line:{" "}
          {olderUnplaced
            .slice(0, 3)
            .map(
              ({ r, nth }) =>
                `your ${ordinal(nth)} claim (asked ${fmtHours(r.dispute.claimedHours)}h, got ${fmtHours(r.dispute.recoveredHours)}h back) — ${unplacedPart(r)}, ${unplacedReason(r)}`,
            )
            .join("; ")}
          {olderUnplaced.length > 3
            ? `; and ${olderUnplaced.length - 3} more`
            : ""}
          . A later claim may have asked for the same shortage again, so these
          hours may already be on your lines, or be one payment counted twice.
          FRT won&apos;t write them anywhere. Before changing any line, check
          your pay stub.
        </p></StatusField>
      )}

      {/* No per-line breakdown and a partial settlement: which lines the shop
          paid is a fact the app does not have, and splitting the money evenly
          would be the app inventing the answer. Ask for it instead. */}
      {showBreakdownNote && (
        <StatusField tag="Note"><p>
          {multiClaim ? (
            <>
              {fmtHours(recovery.unmappedHours)}h came back on your latest
              closed claim, but it isn&apos;t recorded against individual lines
              — so FRT can&apos;t tell which ROs to mark paid.{" "}
              {multiClaimCheck}
            </>
          ) : (
            <>
              {fmtHours(recovery.unmappedHours)}h came back on the closed claim,
              but it isn&apos;t recorded against individual lines — so FRT
              can&apos;t tell which ROs to mark paid. Open &ldquo;Which lines
              came up short?&rdquo; and enter the paid hours on each line
              yourself.
            </>
          )}
        </p></StatusField>
      )}

      {/* The period-total claim. Same dead end as the paragraph above — FRT
          cannot name the ROs — but a DIFFERENT reason, so it must not borrow
          that one's words: nothing here is missing or unrecorded. The claim was
          raised on the stub's period totals because that is all the tech had,
          the shop paid some of it back, and a claim with no lines has nothing
          for the money to land on. Calling that goodwill or a deleted RO would
          be flatly false for the most ordinary close there is. The control name
          is quoted exactly as PaidCheckCard renders it (title="Which lines came
          up short?") — a paraphrase sends the tech looking for a heading that
          isn't on the page. */}
      {showPeriodTotalNote && (
        <StatusField tag="Note"><p>
          {multiClaim ? (
            <>
              {fmtHours(recovery.unmappedHours)}h came back on your latest
              closed claim, but it was raised for the period total rather than
              individual lines — so FRT can&apos;t tell which ROs to mark
              paid. {multiClaimCheck}
            </>
          ) : (
            <>
              {fmtHours(recovery.unmappedHours)}h came back on the closed claim,
              but it was raised for the period total rather than individual
              lines — so FRT can&apos;t tell which ROs to mark paid. Open
              &ldquo;Which lines came up short?&rdquo; and enter the paid hours
              on each line yourself.
            </>
          )}
        </p></StatusField>
      )}

      {applied !== null && applyPlan.rows.length === 0 && (
        <StatusField tag="Saved"><p>
          Recovery applied to {applied} line{applied === 1 ? "" : "s"}.
        </p></StatusField>
      )}

      {/* Gated on the LIVE claim, not on any claim. A closed one still renders
          its outcome above; it no longer silences the offer. openDisputeAction
          hands back an existing open dispute rather than tripping the unique
          index, so this can never create a second live claim. */}
      {!openDispute && (shortedHours > 0 || canOfferPending) && (
        <div className="pp-stack">
          <p className="pp-sub">
            {shortedHours > 0 ? (
              closedForPeriod ? (
                <>
                  {/* Singular and plural about the same set of claims, eleven
                      words apart, is how this read: "Your earlier claim … is
                      closed … 71.1h already recovered across 2 closed claims."
                      Same count drives both halves of the sentence. */}
                  {closedRounds === 1
                    ? `Your earlier claim for ${periodLabel} is`
                    : `Your earlier claims for ${periodLabel} are`}{" "}
                  closed and you&apos;re still short {fmtHours(shortedHours)}h
                  {recoveredHere > 0 && (
                    <>
                      {" "}
                      &middot;{" "}
                      <span className="pp-strong">
                        {fmtHours(recoveredHere)}h already recovered
                      </span>{" "}
                      {/* The figure is a sum over every closed round on this
                          period, so the words have to say so. "on a closed
                          claim" read as the one claim shown below it, which
                          reports a single round — 71.1h beside a card saying
                          19.7h looked like an arithmetic bug and wasn't. */}
                      {closedRounds === 1
                        ? "on that closed claim"
                        : `across ${closedRounds} closed claims`}
                    </>
                  )}
                  . You can raise a second-round claim for what&apos;s left.
                </>
              ) : (
                <>
                  You&apos;re short {fmtHours(shortedHours)}h in {periodLabel}.
                  Track the claim and FRT will remember what you asked for and
                  what actually came back.
                </>
              )
            ) : (
              <>
                Nothing in {periodLabel} was paid short, but {pendingCount} line
                {pendingCount === 1 ? " has" : "s have"} no paid hours recorded
                at all.
              </>
            )}
          </p>

          {canOfferPending && (
            <label className="pp-check">
              <input
                type="checkbox"
                checked={claimPending}
                onChange={(e) => setClaimPending(e.target.checked)}
                className="pp-check-box"
              />
              <span>
                <span className="pp-strong">
                  Also claim {pendingCount} line
                  {pendingCount === 1 ? "" : "s"} you never marked paid (+
                  {fmtHours(pendingHours)}h)
                </span>
                <span className="pp-fine pp-block">
                  Only if your stub really left them out. An unmarked line
                  usually just means you haven&apos;t reconciled it yet — and a
                  claim for hours you were paid is the one that costs you
                  credibility.
                </span>
              </span>
            </label>
          )}

          {/* The only place this error could surface. It used to render solely
              inside the `dispute` branch below, so a failed "Track this
              dispute" was completely silent — the button just did nothing. */}
          {error && (
            <StatusField tag="Fix" role="alert"><p>
              {error}
            </p></StatusField>
          )}

          <div className="pp-btnrow">
          <Button
            variant="go"
            onClick={open}
            disabled={isPending || claimTotal <= 0}
            busy={isPending}
          >
            {/* No figure until there IS one. When the period has no shortfall
                and the only route is the opt-in above, the resting state read
                "Track this dispute · 0.0h" on a disabled button, which looks
                like a broken total rather than "tick the box first". */}
            {isPending
              ? "Starting…"
              : claimTotal > 0
                ? `Track this dispute · ${fmtHours(claimTotal)}h`
                : "Track this dispute"}
          </Button>
          </div>
        </div>
      )}

      {dispute && (
        <div className="pp-stack pp-sub-body is-ruled">
          <div className="pp-btnrow is-tags">
            <Badge tone={STATUS_TONE[dispute.status]}>
              {DISPUTE_STATUS_LABELS[dispute.status]}
            </Badge>
            <span className="pp-fine">
              {DISPUTE_SCOPE_LABELS[dispute.scope]}
              {dispute.scope === "lines" && dispute.lines.length > 0
                ? ` · ${dispute.lines.length} line${dispute.lines.length === 1 ? "" : "s"}`
                : ""}
            </span>
            {waiting !== null && waiting >= 1 && (
              <span className="pp-fine">
                waiting {waiting} day{waiting === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <dl className="pp-rows">
            <div>
              <dt className="k">Claimed</dt>
              <dd className="v num">
                {withPt(fmtHours(dispute.claimedHours))}
                <span className="pp-unit">h</span>
                {dispute.claimedDollars !== null && (
                  <small>{fmtMoney(dispute.claimedDollars)}</small>
                )}
              </dd>
            </div>
            <div>
              <dt className="k">Recovered</dt>
              <dd className={`v num${dispute.recoveredHours > 0 ? " is-good" : " is-dim"}`}>
                {withPt(fmtHours(dispute.recoveredHours))}
                <span className="pp-unit">h</span>
                {dispute.recoveredDollars !== null && (
                  <small>{fmtMoney(dispute.recoveredDollars)}</small>
                )}
              </dd>
            </div>
            {outcome !== null && outcome !== "open" && (
              <div>
                <dt className="k">Outcome</dt>
                <dd
                  className={`v${outcome === "full" ? " is-good" : outcome === "partial" ? "" : " is-bad"}`}
                >
                  {outcome === "full"
                    ? "Paid in full"
                    : outcome === "partial"
                      ? "Partly paid"
                      : "Denied"}
                </dd>
              </div>
            )}
          </dl>

          {dispute.note && (
            <p className="pp-well pp-sub">{dispute.note}</p>
          )}

          {error && (
            <StatusField tag="Fix" role="alert"><p>
              {error}
            </p></StatusField>
          )}

          {/* The form is never closed imperatively — see the comment in
              OutcomeForm.save(). It unmounts when the SERVER says the write
              landed, and which server fact that is depends on the session:
              a live claim going closed, or a corrected claim's updatedAt
              moving off the value it had when the form opened. */}
          {recording !== null &&
          (recording.reopen
            ? dispute.updatedAt === recording.at
            : !isClosed(dispute.status)) ? (
            <OutcomeForm dispute={dispute} onDone={() => setRecording(null)} />
          ) : isClosed(dispute.status) ? (
            /* A closed claim is not finished business: shops answer in stages,
               and a mis-tap can close a claim at the wrong figure. The row is
               deliberately just this one control — no "Record outcome" (that is
               the first-time idiom), no advance, no "Drop it" on a claim that is
               already off the queue. OutcomeForm seeds from what was stored. */
            <div className="pp-btnrow">
              <Button
                variant="quiet"
                onClick={() =>
                  setRecording({ reopen: true, at: dispute.updatedAt })
                }
              >
                Correct outcome
              </Button>
            </div>
          ) : (
            <div className="pp-btnrow">
              {next === "submitted" && (
                <Button
                  variant="go"
                  onClick={() => advance("submitted")}
                  disabled={isPending}
                >
                  I handed it in
                </Button>
              )}
              {next === "answered" && (
                <Button
                  variant="go"
                  onClick={() => advance("answered")}
                  disabled={isPending}
                >
                  They responded
                </Button>
              )}
              <Button
                variant="quiet"
                onClick={() => setRecording({ reopen: false })}
              >
                Record outcome
              </Button>
              <Button
                variant="quiet"
                onClick={() => advance("withdrawn")}
                disabled={isPending}
              >
                Drop it
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Lifetime recovery rates and the "which kind of claim gets paid?"
          comparisons used to render here. They are cross-period, so under this
          page's scope rule they belong on /insights — and while they lived here
          they reported the same "2 claims closed · 100% got paid" on EVERY
          period a tech opened, including periods with no claim at all. Moved,
          not mirrored: this is a link, never a second copy of the figures. */}
      {lifetime.closedCount > 0 && (
        <div className="pp-sub-body is-ruled">
          <Link href="/insights" className="pp-link">
            How your claims tend to go →
          </Link>
        </div>
      )}
    </Root>
  );
}
