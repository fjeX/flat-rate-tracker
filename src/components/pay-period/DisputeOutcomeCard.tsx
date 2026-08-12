"use client";

import { useState, useTransition } from "react";
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
} from "@/lib/disputes";
import {
  DISPUTE_SCOPE_LABELS,
  DISPUTE_STATUS_LABELS,
  type Dispute,
} from "@/lib/types";
import {
  openDisputeAction,
  recordDisputeOutcomeAction,
  setDisputeStatusAction,
} from "@/app/actions/disputes";

// Tone per lifecycle state. 'answered' is warn, not good: they replied, but the
// claim isn't settled until the tech records what actually came back.
const STATUS_TONE: Record<Dispute["status"], string> = {
  generated: "",
  submitted: "warn",
  answered: "warn",
  resolved: "good",
  withdrawn: "",
};

function OutcomeForm({
  dispute,
  onDone,
}: {
  dispute: Dispute;
  onDone: () => void;
}) {
  const router = useRouter();
  // Pre-fill with the full ask: the common outcome is "they paid it", so the
  // fast path should be one tap. Partial payments are the edit case.
  const [hoursText, setHoursText] = useState(
    String(dispute.recoveredHours || dispute.claimedHours),
  );
  const [dollarsText, setDollarsText] = useState(
    dispute.recoveredDollars !== null
      ? String(dispute.recoveredDollars)
      : dispute.claimedDollars !== null
        ? String(dispute.claimedDollars)
        : "",
  );
  const [note, setNote] = useState(dispute.note);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    const hours = Number(hoursText);
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
        await recordDisputeOutcomeAction(dispute.id, {
          recoveredHours: hours,
          recoveredDollars: dollars,
          note,
          status: "resolved",
        });
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
        setError(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] p-3">
      <p className="text-xs text-[var(--fg-2)]">
        What did they actually pay back? Leave dollars blank if you only know the
        hours.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Recovered hrs</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={hoursText}
            onChange={(e) => setHoursText(e.target.value)}
            aria-label="Recovered hours"
            className="input mt-1 text-base font-semibold"
          />
        </label>
        <label className="block">
          <span className="field-label">Recovered $</span>
          <input
            type="number"
            min={0}
            step={1}
            value={dollarsText}
            onChange={(e) => setDollarsText(e.target.value)}
            placeholder="—"
            aria-label="Recovered dollars"
            className="input mt-1 text-base font-semibold"
          />
        </label>
      </div>
      <label className="block">
        <span className="field-label">What happened</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Ray adjusted 3 of the 4 lines…"
          aria-label="Outcome note"
          className="input mt-1 text-sm"
        />
      </label>
      {error && <p className="text-xs text-[var(--bad)]">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="btn btn-sm btn-ghost min-h-11"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="btn btn-sm btn-primary min-h-11"
        >
          {isPending ? "Saving…" : "Close out claim"}
        </button>
      </div>
    </div>
  );
}

export function DisputeOutcomeCard({
  periodKey,
  periodLabel,
  openDispute,
  allDisputes,
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
  const [recording, setRecording] = useState(false);
  // Opt-in, never the default: see the doc comment on openDisputeAction.
  const [claimPending, setClaimPending] = useState(false);

  const canOfferPending = periodEnded && pendingCount > 0;
  // What the claim will actually freeze. Shown on the button so the figure the
  // tech sees and the figure the ledger records are the same number.
  const claimTotal = shortedHours + (claimPending ? pendingHours : 0);

  const lifetime = lifetimeRecovery(allDisputes);
  // The closed claim for this period, if the live one is already gone. Lets a
  // finished period still show its outcome.
  const closedForPeriod = allDisputes.find(
    (d) => d.periodKey === periodKey && isClosed(d.status),
  );
  // Drives the OUTCOME section only. It used to gate the offer too, which meant
  // one closed claim hid the offer for the rest of the period's life — money
  // found after the claim went out stayed unclaimed with no way to ask for it.
  // The DB never agreed with that: disputes_one_open_per_period_idx excludes
  // terminal states precisely so a second-round claim is possible once the
  // first closes (20260729000000_dispute_ledger.sql:107-112).
  const dispute = openDispute ?? closedForPeriod ?? null;

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
        await setDisputeStatusAction(dispute.id, to);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update.");
      }
    });
  }

  function open() {
    setError(null);
    startTransition(async () => {
      try {
        await openDisputeAction(periodKey, { includePending: claimPending });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start tracking.");
      }
    });
  }

  const outcome = dispute ? disputeOutcome(dispute) : null;
  const waiting = dispute ? daysWaiting(dispute) : null;
  const next = dispute && !isClosed(dispute.status) ? nextStatus(dispute.status) : null;

  const Root = embedded ? "div" : "section";

  return (
    <Root className={embedded ? "space-y-3" : "card padded-lg space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {/* The lifetime "recovered all-time" figure used to sit here. It is
            cross-period data, so under the page's scope rule it belongs on a
            surface that owns lifetime numbers — and the dashboard's
            RecoveredCard already showed the identical figure. Removed rather
            than mirrored. */}
      </div>

      {/* Gated on the LIVE claim, not on any claim. A closed one still renders
          its outcome above; it no longer silences the offer. openDisputeAction
          hands back an existing open dispute rather than tripping the unique
          index, so this can never create a second live claim. */}
      {!openDispute && (shortedHours > 0 || canOfferPending) && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--fg-2)]">
            {shortedHours > 0 ? (
              closedForPeriod ? (
                <>
                  Your earlier claim for {periodLabel} is closed and you&apos;re
                  still short {fmtHours(shortedHours)}h. You can raise a
                  second-round claim for what&apos;s left.
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
            <label className="card-inset flex cursor-pointer items-start gap-2 px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={claimPending}
                onChange={(e) => setClaimPending(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[var(--brand)]"
              />
              <span>
                <span className="font-medium text-[var(--fg-1)]">
                  Also claim {pendingCount} line
                  {pendingCount === 1 ? "" : "s"} you never marked paid (+
                  {fmtHours(pendingHours)}h)
                </span>
                <span className="mt-0.5 block text-[var(--fg-3)]">
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
          {error && <p className="text-xs text-[var(--bad)]">{error}</p>}

          <button
            type="button"
            onClick={open}
            disabled={isPending || claimTotal <= 0}
            className="btn btn-sm btn-primary min-h-11"
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
          </button>
        </div>
      )}

      {dispute && (
        <div className="space-y-3 border-t border-[var(--line)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`pill ${STATUS_TONE[dispute.status]}`}>
              {DISPUTE_STATUS_LABELS[dispute.status]}
            </span>
            <span className="text-xs text-[var(--fg-3)]">
              {DISPUTE_SCOPE_LABELS[dispute.scope]}
              {dispute.scope === "lines" && dispute.lines.length > 0
                ? ` · ${dispute.lines.length} line${dispute.lines.length === 1 ? "" : "s"}`
                : ""}
            </span>
            {waiting !== null && waiting >= 1 && (
              <span className="text-xs text-[var(--warn)]">
                waiting {waiting} day{waiting === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
              <div className="field-label">Claimed</div>
              <div className="mono mt-1 text-base font-semibold tabular-nums text-[var(--fg-1)]">
                {fmtHours(dispute.claimedHours)}h
              </div>
              {dispute.claimedDollars !== null && (
                <div className="mt-0.5 text-xs text-[var(--fg-3)]">
                  {fmtMoney(dispute.claimedDollars)}
                </div>
              )}
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
              <div className="field-label">Recovered</div>
              <div
                className={`mono mt-1 text-base font-semibold tabular-nums ${dispute.recoveredHours > 0 ? "text-[var(--good)]" : "text-[var(--fg-3)]"}`}
              >
                {fmtHours(dispute.recoveredHours)}h
              </div>
              {dispute.recoveredDollars !== null && (
                <div className="mt-0.5 text-xs text-[var(--fg-3)]">
                  {fmtMoney(dispute.recoveredDollars)}
                </div>
              )}
            </div>
            {outcome !== null && outcome !== "open" && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
                <div className="field-label">Outcome</div>
                <div
                  className={`mt-1 text-base font-semibold ${outcome === "full" ? "text-[var(--good)]" : outcome === "partial" ? "text-[var(--warn)]" : "text-[var(--bad)]"}`}
                >
                  {outcome === "full"
                    ? "Paid in full"
                    : outcome === "partial"
                      ? "Partly paid"
                      : "Denied"}
                </div>
              </div>
            )}
          </div>

          {dispute.note && (
            <p className="rounded-[var(--radius-sm)] bg-[var(--bg-1)] px-3 py-2 text-sm text-[var(--fg-2)]">
              {dispute.note}
            </p>
          )}

          {error && <p className="text-xs text-[var(--bad)]">{error}</p>}

          {/* `&& !isClosed` is what actually closes the form: once the refresh
              lands and the dispute reads as resolved, this unmounts it. See the
              comment in OutcomeForm.save() for why it isn't closed imperatively. */}
          {recording && !isClosed(dispute.status) ? (
            <OutcomeForm dispute={dispute} onDone={() => setRecording(false)} />
          ) : (
            !isClosed(dispute.status) && (
              <div className="flex flex-wrap items-center gap-2">
                {next === "submitted" && (
                  <button
                    type="button"
                    onClick={() => advance("submitted")}
                    disabled={isPending}
                    className="btn btn-sm btn-primary min-h-11"
                  >
                    I handed it in
                  </button>
                )}
                {next === "answered" && (
                  <button
                    type="button"
                    onClick={() => advance("answered")}
                    disabled={isPending}
                    className="btn btn-sm btn-primary min-h-11"
                  >
                    They responded
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRecording(true)}
                  className="btn btn-sm btn-ghost min-h-11"
                >
                  Record outcome
                </button>
                <button
                  type="button"
                  onClick={() => advance("withdrawn")}
                  disabled={isPending}
                  className="btn btn-sm btn-ghost min-h-11"
                >
                  Drop it
                </button>
              </div>
            )
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
        <div className="border-t border-[var(--line)] pt-3">
          <Link href="/insights" className="link text-xs">
            How your claims tend to go →
          </Link>
        </div>
      )}
    </Root>
  );
}
