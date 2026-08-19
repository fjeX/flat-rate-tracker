"use client";

// Custom period dates, with the consequences shown before you commit.
//
// The workflow this serves: a tech logs ROs as they go, not knowing exactly
// which days their shop's pay period covers. The paystub arrives and states the
// real dates. They come back here and set them. The default 1st–15th / 16th–end
// split was never meant to be authoritative — it is the usual shape of a pay
// period, refined once the tech has the paperwork.
//
// Because every figure on the page is derived by date range, moving a boundary
// silently re-files work: ROs, flagged hours, clocked hours, efficiency and
// earnings all change, in THIS period and the neighbouring one. That is correct
// behaviour and also the kind of thing that makes a tech think the app lost
// their work — so the modal computes the real before/after and shows it.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { formatDateLong, type PeriodRange } from "@/lib/periods";
import { aggregateStatsAuto, fmtHours, fmtPct, type ScheduleContext } from "@/lib/stats";
import {
  efficiencyDisplay,
  type EfficiencyDisplay,
} from "@/lib/efficiency-display";
import { fmtMoney, hasAnyRate, periodEarnings, type RateMap } from "@/lib/earnings";
import { setPeriodOverrideAction } from "@/app/actions/settings";
import type { ScheduleFallback } from "@/lib/wage-check";
import type { DailyClock, Entry, UnpaidTime } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build the modal's ScheduleContext from the schedule context the page already
 * assembled for its own figures.
 *
 * This exists because the caller used to hand-write the object literal, and a
 * hand-written literal is one field away from a different answer: it passed
 * `confirmedZeroDays: []`, which under the shared pairDay rule demotes every
 * confirmed real-zero day from "counted" to "unresolved" and drops it out of
 * the denominator. The modal then divided the same flagged hours by a shorter
 * denominator than the page behind it — 365% in the preview against 183% in
 * the hero, for the identical unchanged range.
 *
 * So the conversion is a function, exported and tested, rather than a literal
 * at a call site. Adding a field to ScheduleContext now breaks here, once,
 * instead of silently defaulting somewhere.
 *
 * Returns null when there is no usable schedule — aggregateStatsAuto then falls
 * back to clocked hours only, exactly as the page does.
 */
export function scheduleContextFrom(
  schedule: ScheduleFallback | null | undefined,
  today: string,
): ScheduleContext | null {
  if (!schedule || schedule.schedules.length === 0) return null;
  return {
    schedules: schedule.schedules,
    daysOff: schedule.daysOff,
    // Optional on ScheduleFallback because effectiveHourly never reads it;
    // required here. This `?? []` is the ONLY place that default is allowed to
    // be applied, and the page supplies the real list.
    confirmedZeroDays: schedule.confirmedZeroDays ?? [],
    today,
    shiftOverrides: schedule.shiftOverrides,
  };
}

type Snapshot = {
  roCount: number;
  flagHours: number;
  denomHours: number;
  efficiency: number | null;
  // The classification, not just the raw number. Carried on the snapshot so the
  // preview cannot state a percentage the page behind it is refusing to state
  // for the same range — the whole reason this modal exists is that it must
  // agree with that page.
  efficiencyDisplay: EfficiencyDisplay;
  earnings: number | null;
};

// Exported for the regression test: this is the figure the modal shows, and it
// has to equal the page's for an unchanged range.
export function snapshot(
  entries: Entry[],
  clocks: DailyClock[],
  unpaid: UnpaidTime[],
  schedule: ScheduleContext | null,
  rates: RateMap,
  range: { start: string; end: string },
): Snapshot {
  const stats = aggregateStatsAuto(entries, clocks, range, unpaid, schedule);
  const inRange = entries.filter(
    (e) => e.date >= range.start && e.date <= range.end,
  );
  return {
    roCount: stats.roCount,
    flagHours: stats.flagHours,
    denomHours: stats.denomHours ?? stats.clockedHours,
    efficiency: stats.efficiency,
    efficiencyDisplay: efficiencyDisplay(stats),
    earnings: hasAnyRate(rates) ? periodEarnings(inRange, rates) : null,
  };
}

function DeltaRow({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  const changed = before !== after;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-[var(--fg-3)]">{label}</span>
      <span className="mono flex items-baseline gap-2 tabular-nums">
        <span className={changed ? "text-[var(--fg-3)] line-through" : "text-[var(--fg-2)]"}>
          {before}
        </span>
        {changed && (
          <>
            <span className="text-[var(--fg-3)]">→</span>
            <span className="font-semibold text-[var(--fg-1)]">{after}</span>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * The efficiency row — the one figure here that can stop existing.
 *
 * A delta needs two numbers. When either side is withheld there is no honest
 * arrow to draw: "0% → 138%" reads as a fix that happened, "138% → —" reads as
 * work that vanished, and "— → —" reads as a broken app. All three are the same
 * situation: for at least one of these two date ranges, most or all of the
 * flagged hours landed on days the app cannot put a length to, so the
 * percentage for that range describes almost none of the work in it.
 *
 * So the row states that instead of comparing. No arrow, no strikethrough, no
 * "+0%". The sentence underneath (rendered by the caller, in the same voice as
 * the pay-period hero) says which hours and what to do about it.
 *
 * Same classifier as the hero and the stat tile on the page behind this modal,
 * so the three can never disagree about whether a figure is printable.
 */
function EfficiencyDeltaRow({
  before,
  after,
}: {
  before: EfficiencyDisplay;
  after: EfficiencyDisplay;
}) {
  const b = pctText(before);
  const a = pctText(after);
  if (b !== null && a !== null) {
    return <DeltaRow label="Efficiency" before={b} after={a} />;
  }
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-[var(--fg-3)]">Efficiency</span>
      <span className="text-right text-[var(--fg-2)]">nothing to compare</span>
    </div>
  );
}

/**
 * What to print for one side of the row, or null when nothing may be printed.
 *
 * `none` is NOT withheld — it means the range had no measurable days at all and
 * no excluded hours either, which is the plain "—" the grid has always shown for
 * an absent figure. Folding it in with the withheld kinds would put "nothing to
 * compare" (and a sentence about excluded hours that do not exist) in front of a
 * tech who simply widened a range into an empty week.
 */
function pctText(display: EfficiencyDisplay): string | null {
  if (display.kind === "shown") return fmtPct(display.pct);
  if (display.kind === "none") return fmtPct(null);
  return null;
}

/** Hours behind a withheld percentage, for the sentence under the rows. */
function excludedHours(display: EfficiencyDisplay): number {
  return display.kind === "all_excluded" || display.kind === "mostly_excluded"
    ? display.excludedHours
    : 0;
}

/** Withheld — as opposed to merely absent. Only this state gets the sentence. */
function isWithheld(display: EfficiencyDisplay): boolean {
  return display.kind === "all_excluded" || display.kind === "mostly_excluded";
}

function PeriodOverrideBody({
  periodKey,
  initialRange,
  entries,
  clocks,
  unpaid,
  schedule,
  rates,
  paidFlagHours,
  onClose,
}: {
  periodKey: string;
  initialRange: PeriodRange;
  entries: Entry[];
  clocks: DailyClock[];
  unpaid: UnpaidTime[];
  schedule: ScheduleContext | null;
  rates: RateMap;
  paidFlagHours: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const valid =
    DATE_RE.test(start) && DATE_RE.test(end) && start <= end;
  const dirty = start !== initialRange.start || end !== initialRange.end;

  const before = useMemo(
    () => snapshot(entries, clocks, unpaid, schedule, rates, initialRange),
    [entries, clocks, unpaid, schedule, rates, initialRange],
  );
  const after = useMemo(
    () =>
      valid
        ? snapshot(entries, clocks, unpaid, schedule, rates, { start, end })
        : null,
    [entries, clocks, unpaid, schedule, rates, start, end, valid],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!start || !end) {
      setError("Both start and end dates are required.");
      return;
    }
    if (start > end) {
      setError("Start date must be on or before end date.");
      return;
    }
    startTransition(async () => {
      try {
        await setPeriodOverrideAction(periodKey, start, end);
        router.refresh();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-xs text-[var(--fg-3)]">
        Set the exact dates your paystub covers. The usual 1st-to-15th split is
        only a starting shape — your shop&apos;s real boundary is whatever the
        stub says, and this is where you tell FRT.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block" htmlFor="period-override-start">
          <span className="field-label">Start</span>
          <input
            id="period-override-start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            aria-required="true"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "period-override-error" : undefined}
            className="input mt-1 text-sm"
          />
        </label>
        <label className="block" htmlFor="period-override-end">
          <span className="field-label">End</span>
          <input
            id="period-override-end"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
            aria-required="true"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "period-override-error" : undefined}
            className="input mt-1 text-sm"
          />
        </label>
      </div>

      {/* The impact block. Only once the dates actually differ — showing a table
          of unchanged figures on open would train the eye to ignore it. */}
      {dirty && after !== null && (
        <div className="card-inset space-y-2 px-3 py-3">
          <p className="text-xs text-[var(--fg-2)]">
            <span className="font-medium text-[var(--warn)]">Heads up —</span>{" "}
            work is filed by date, so this re-files every RO on the days you
            added or removed. These figures change here, and the matching
            amounts move into or out of the neighbouring period:
          </p>

          <div className="divide-y divide-[var(--line-soft)]">
            <DeltaRow
              label="Logged ROs"
              before={String(before.roCount)}
              after={String(after.roCount)}
            />
            <DeltaRow
              label="Flagged hours"
              before={`${fmtHours(before.flagHours)}h`}
              after={`${fmtHours(after.flagHours)}h`}
            />
            <DeltaRow
              label="Clocked hours"
              before={`${fmtHours(before.denomHours)}h`}
              after={`${fmtHours(after.denomHours)}h`}
            />
            <EfficiencyDeltaRow
              before={before.efficiencyDisplay}
              after={after.efficiencyDisplay}
            />
            {before.earnings !== null && after.earnings !== null && (
              <DeltaRow
                label="Earnings"
                before={fmtMoney(before.earnings)}
                after={fmtMoney(after.earnings)}
              />
            )}
          </div>

          {(isWithheld(before.efficiencyDisplay) ||
            isWithheld(after.efficiencyDisplay)) && (
            <p className="text-xs text-[var(--fg-3)]">
              No efficiency comparison for these dates —{" "}
              <span className="font-medium text-[var(--fg-2)]">
                {fmtHours(
                  Math.max(
                    excludedHours(before.efficiencyDisplay),
                    excludedHours(after.efficiencyDisplay),
                  ),
                )}
                h
              </span>{" "}
              {/* The {" "} above is load-bearing: text after an expression
                  container loses its leading space in the JSX transform, which
                  is how "1 daywith" shipped in PeriodStats. */}
              of the flagged work in one of these ranges landed on days with no
              clocked hours and no schedule, so the percentage would leave out
              most of it. Everything else above still moves.
            </p>
          )}

          <p className="text-xs text-[var(--fg-3)]">
            New range: {formatDateLong(start)} – {formatDateLong(end)}.
            {paidFlagHours !== null && (
              <>
                {" "}
                Your recorded {fmtHours(paidFlagHours)}h from the stub stays
                attached to this period — that is the point of correcting the
                dates, so the two finally describe the same days.
              </>
            )}
          </p>
        </div>
      )}

      {dirty && !valid && (
        <p className="text-xs text-[var(--bad)]">
          Start date must be on or before end date.
        </p>
      )}

      {error && (
        <p id="period-override-error" role="alert" className="text-sm text-[var(--bad)]">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="btn btn-ghost"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !valid || !dirty}
          className="btn btn-primary"
        >
          {isPending ? "Saving…" : "Save dates"}
        </button>
      </div>
    </form>
  );
}

export function PeriodOverrideModal({
  open,
  periodKey,
  initialRange,
  entries,
  clocks,
  unpaid,
  schedule,
  rates,
  paidFlagHours,
  onClose,
}: {
  open: boolean;
  periodKey: string;
  initialRange: PeriodRange;
  // Entries spanning WIDER than the current period — the preview has to be able
  // to see the work that would move IN from either side, not just what is
  // already here.
  entries: Entry[];
  clocks: DailyClock[];
  unpaid: UnpaidTime[];
  schedule: ScheduleContext | null;
  rates: RateMap;
  paidFlagHours: number | null;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Custom period dates">
      <PeriodOverrideBody
        periodKey={periodKey}
        initialRange={initialRange}
        entries={entries}
        clocks={clocks}
        unpaid={unpaid}
        schedule={schedule}
        rates={rates}
        paidFlagHours={paidFlagHours}
        onClose={onClose}
      />
    </Modal>
  );
}
