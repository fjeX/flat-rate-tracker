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
import { fmtMoney, hasAnyRate, periodEarnings, type RateMap } from "@/lib/earnings";
import { setPeriodOverrideAction } from "@/app/actions/settings";
import type { DailyClock, Entry, UnpaidTime } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Snapshot = {
  roCount: number;
  flagHours: number;
  denomHours: number;
  efficiency: number | null;
  earnings: number | null;
};

function snapshot(
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
            <DeltaRow
              label="Efficiency"
              before={fmtPct(before.efficiency)}
              after={fmtPct(after.efficiency)}
            />
            {before.earnings !== null && after.earnings !== null && (
              <DeltaRow
                label="Earnings"
                before={fmtMoney(before.earnings)}
                after={fmtMoney(after.earnings)}
              />
            )}
          </div>

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
