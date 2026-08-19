"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Stats } from "@/lib/stats";
import { fmtHours } from "@/lib/stats";
import {
  deletePaidPeriodAction,
  setPaidPeriodHoursAction,
} from "@/app/actions/paid-periods";
import { FLUSH_EVENT } from "@/components/layout/RefreshFlusher";
import { notifyDataChanged } from "@/components/layout/CrossTabRefresh";
import { toText, parseHours, verdictFor } from "@/lib/discrepancy";

export function DiscrepancyCard({
  periodKey,
  stats,
  initialPaid,
  embedded = false,
}: {
  periodKey: string;
  stats: Stats;
  initialPaid: number | null;
  // Rendered as the period-level figures INSIDE PaidCheckCard. Drops the card
  // chrome and its own heading, since the family card owns both.
  embedded?: boolean;
}) {
  const router = useRouter();
  const [paidText, setPaidText] = useState<string>(toText(initialPaid));
  const [savedPaid, setSavedPaid] = useState<number | null>(initialPaid);
  // Two transitions, not one. A save belongs to the input and a reset belongs
  // to the button; sharing a pending flag is what let a blur-commit disable the
  // reset button while the user's focus was already sitting on it.
  const [isSaving, startSaving] = useTransition();
  const [isResetting, startResetting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  // The save currently in the air, so a reset can queue behind it instead of
  // racing it. Without this a DELETE can land ahead of an UPSERT and the row
  // comes straight back.
  const inFlightSave = useRef<Promise<void> | null>(null);
  // True from the moment a reset is confirmed until its delete settles. A ref
  // rather than `isResetting`, because disabling the button blurs it, and that
  // blur must not fire the very commit the reset is trying to avoid.
  const resettingRef = useRef(false);

  const parsedPaid = parseHours(paidText);
  const logged = stats.flagHours;
  const verdict = verdictFor(parsedPaid, logged);
  const dirty = parsedPaid !== null && parsedPaid !== savedPaid;
  const isPending = isSaving || isResetting;

  // Every other write on this page does all three (BonusForm, SpiffsCard,
  // QuickAddModal): refetch the server tree, make React actually paint it
  // (c655c010), then tell the other open tabs. The hero and the period `mode`
  // above this card are server props, so without it a cleared figure leaves the
  // Settled hero sitting over a discrepancy card reading "—".
  function repaint() {
    router.refresh();
    window.dispatchEvent(new Event(FLUSH_EVENT));
    notifyDataChanged(); // and the other open tabs
  }

  function commit() {
    // A reset is already under way — the figure is on its way out, not in.
    if (resettingRef.current) return;
    if (!dirty || parsedPaid === null) return;
    setError(null);
    const value = parsedPaid;
    startSaving(async () => {
      const run = (async () => {
        try {
          // Validation answers with { error } — a thrown one would be redacted
          // in production. Only DB failures reach the catch.
          const res = await setPaidPeriodHoursAction(periodKey, value);
          if (res.error) {
            setError(res.error);
            return;
          }
          setSavedPaid(value);
          repaint();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to save.");
        }
      })();
      inFlightSave.current = run;
      await run;
      if (inFlightSave.current === run) inFlightSave.current = null;
    });
  }

  // The way back out. Blanking the input can't do this: parseHours("") is null
  // and commit() early-returns, and the column is NOT NULL so there is no
  // "unset" value to write — clearing means deleting the row. Without it a
  // mistyped figure pins the period to settled/short/over forever.
  function reset() {
    if (savedPaid === null) return;
    if (
      !window.confirm(
        "Clear the paid flag hours for this period? It goes back to awaiting " +
          "pay and the discrepancy verdict disappears. You can enter a new " +
          "figure any time.",
      )
    ) {
      return;
    }
    setError(null);
    resettingRef.current = true;
    startResetting(async () => {
      try {
        // Queue behind any save still in the air so the DELETE is last.
        await inFlightSave.current;
        const res = await deletePaidPeriodAction(periodKey);
        if (res.error) {
          setError(res.error);
          return;
        }
        setSavedPaid(null);
        setPaidText("");
        repaint();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to clear.");
      } finally {
        resettingRef.current = false;
      }
    });
  }

  const diff = parsedPaid === null ? null : parsedPaid - logged;

  const diffColor =
    verdict === "missing"
      ? "text-[var(--bad)]"
      : verdict === "over"
        ? "text-[var(--warn)]"
        : verdict === "match"
          ? "text-[var(--good)]"
          : "text-[var(--fg-3)]";

  const Root = embedded ? "div" : "section";

  return (
    <Root className={embedded ? "space-y-3" : "card padded-lg space-y-3"}>
      {!embedded && (
        <h2 className="text-sm font-medium">Pay Discrepancy Check</h2>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="block">
          <label className="block">
            <span className="field-label">
              Actual paid flag hrs
            </span>
            <input
              ref={inputRef}
              type="number"
              min={0}
              step={0.1}
              value={paidText}
              onChange={(e) => setPaidText(e.target.value)}
              onBlur={(e) => {
                // Focus is moving onto "Reset to unpaid": the user is about to
                // erase this figure, so saving it first is a write they never
                // asked for and one the delete then has to race. relatedTarget
                // covers keyboard AND pointer, unlike the onMouseDown guard
                // below — which stays because Safari and Firefox/macOS don't
                // focus a clicked button at all, leaving relatedTarget null.
                //
                // The `resetRef.current &&` is load-bearing, not defensive
                // noise. The reset button only renders once a figure is saved,
                // so on a period with nothing saved yet resetRef.current is
                // null — and `null === null` is true. Without this guard the
                // comparison swallowed the save for every blur that carries no
                // relatedTarget: pressing Enter (a programmatic .blur(), which
                // is what this card's own "Press enter or click away to save"
                // hint tells you to do) and clicking any non-focusable space.
                // That silently discarded the first figure a tech ever typed
                // into a period, with no error — and a successful reset returns
                // the card to exactly that state.
                if (resetRef.current && e.relatedTarget === resetRef.current) return;
                commit();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="—"
              className="input mt-1 text-lg font-semibold"
            />
          </label>
          {savedPaid !== null && (
            <button
              ref={resetRef}
              type="button"
              // Taking focus off the input would fire its onBlur commit first,
              // racing an upsert against this delete in the same transition.
              // Keeping focus where it is means only one write happens.
              onMouseDown={(e) => e.preventDefault()}
              onBlur={(e) => {
                // The commit suppressed when focus arrived here. Tabbing PAST
                // the button without pressing it must still save the typed
                // figure, exactly as it did before. commit() no-ops if a reset
                // is under way or the field isn't dirty.
                if (e.relatedTarget === inputRef.current) return;
                commit();
              }}
              onClick={reset}
              // Only its OWN transition, never the input's. Guarding against a
              // double delete is this button's job; a save in flight is the
              // input's, and letting that disable this control is the bug.
              // Ordering is handled by awaiting inFlightSave, not by disabling.
              disabled={isResetting}
              // Same ghost button every other secondary action on this page
              // uses. No colour/padding utilities: globals.css is unlayered, so
              // .btn-sm silently beats a Tailwind px-0 or text-[…] anyway.
              className="btn btn-sm btn-ghost min-h-11 mt-2"
            >
              Reset to unpaid
            </button>
          )}
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
          <div className="field-label">
            Logged flag hrs
          </div>
          <div className="mt-1 text-lg font-semibold text-[var(--fg-1)]">
            {fmtHours(logged)}h
          </div>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
          <div className="field-label">
            Difference
          </div>
          <div className={`mt-1 text-lg font-semibold ${diffColor}`}>
            {diff === null
              ? "—"
              : `${diff > 0 ? "+" : ""}${fmtHours(diff)}h`}
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-[var(--bad)]">{error}</p>}
      {!error && isPending && (
        <p className="text-xs text-[var(--fg-3)]">Saving…</p>
      )}
      {!error && !isPending && dirty && (
        <p className="text-xs text-[var(--fg-3)]">
          Press enter or click away to save
        </p>
      )}

      {verdict === "missing" && diff !== null && (
        <div className="rounded-[var(--radius-sm)] bg-[var(--bad-bg)] px-3 py-2 text-sm text-[var(--bad)]">
          Missing {fmtHours(-diff)} hours. Review the RO list below — use the
          logged ROs as proof when you talk to your service manager.
        </div>
      )}
    </Root>
  );
}
