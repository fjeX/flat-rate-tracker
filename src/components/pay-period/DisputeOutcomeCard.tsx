"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtHours } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import {
  daysWaiting,
  disputeOutcome,
  isClosed,
  lifetimeRecovery,
  nextStatus,
  outcomeInsights,
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

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

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
}: {
  periodKey: string;
  periodLabel: string;
  // The live claim for the viewed period, if one exists.
  openDispute: Dispute | null;
  // Every dispute the user has ever raised — drives the lifetime figure.
  allDisputes: Dispute[];
  // Outstanding hours for the viewed period, so the card knows whether there is
  // anything worth claiming yet.
  shortedHours: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const lifetime = lifetimeRecovery(allDisputes);
  const insights = outcomeInsights(allDisputes);
  // The closed claim for this period, if the live one is already gone. Lets a
  // finished period still show its outcome instead of offering a fresh claim.
  const closedForPeriod = allDisputes.find(
    (d) => d.periodKey === periodKey && isClosed(d.status),
  );
  const dispute = openDispute ?? closedForPeriod ?? null;

  // Nothing to claim, nothing ever claimed — the card has nothing to say.
  if (!dispute && shortedHours <= 0 && lifetime.disputeCount === 0) return null;

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
        await openDisputeAction(periodKey);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start tracking.");
      }
    });
  }

  const outcome = dispute ? disputeOutcome(dispute) : null;
  const waiting = dispute ? daysWaiting(dispute) : null;
  const next = dispute && !isClosed(dispute.status) ? nextStatus(dispute.status) : null;

  return (
    <section className="card padded-lg space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Dispute Tracking</h2>
        {lifetime.recoveredHours > 0 && (
          <span className="mono text-sm font-medium tabular-nums text-[var(--good)]">
            {lifetime.recoveredDollars !== null
              ? fmtMoney(lifetime.recoveredDollars)
              : `${fmtHours(lifetime.recoveredHours)}h`}{" "}
            recovered all-time
          </span>
        )}
      </div>

      {!dispute && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--fg-2)]">
            You&apos;re short {fmtHours(shortedHours)}h in {periodLabel}. Track
            the claim and FRT will remember what you asked for and what actually
            came back.
          </p>
          <button
            type="button"
            onClick={open}
            disabled={isPending}
            className="btn btn-sm btn-primary min-h-11"
          >
            {isPending ? "Starting…" : "Track this dispute"}
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

      {lifetime.closedCount > 0 && (
        <div className="border-t border-[var(--line)] pt-3 text-xs text-[var(--fg-3)]">
          {lifetime.closedCount} claim{lifetime.closedCount === 1 ? "" : "s"}{" "}
          closed
          {lifetime.winRate !== null && ` · ${pct(lifetime.winRate)} got paid`}
          {lifetime.hourRecoveryRate !== null &&
            ` · ${pct(lifetime.hourRecoveryRate)} of claimed hours recovered`}
        </div>
      )}

      {insights.length > 0 && (
        <div className="space-y-1 border-t border-[var(--line)] pt-3">
          {insights.map((i) => (
            <p key={i.id} className="text-xs text-[var(--fg-2)]">
              <span className="font-medium text-[var(--fg-1)]">
                {i.betterLabel}
              </span>{" "}
              claims get paid {pct(i.betterRate)} of the time ({i.betterCount}{" "}
              closed) vs {pct(i.worseRate)} for{" "}
              <span className="font-medium text-[var(--fg-1)]">
                {i.worseLabel.toLowerCase()}
              </span>{" "}
              ({i.worseCount} closed).
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
