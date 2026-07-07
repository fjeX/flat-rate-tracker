"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import type { PeriodRange } from "@/lib/periods";
import { setPeriodOverrideAction } from "@/app/actions/settings";

function PeriodOverrideBody({
  periodKey,
  initialRange,
  onClose,
}: {
  periodKey: string;
  initialRange: PeriodRange;
  onClose: () => void;
}) {
  const router = useRouter();
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
        Override the date range for this pay period. ROs with dates inside the
        new range will appear here.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block" htmlFor="period-override-start">
          <span className="field-label">
            Start
          </span>
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
          <span className="field-label">
            End
          </span>
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

      {error && <p id="period-override-error" role="alert" className="text-sm text-[var(--bad)]">{error}</p>}

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
          disabled={isPending}
          className="btn btn-primary"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

export function PeriodOverrideModal({
  open,
  periodKey,
  initialRange,
  onClose,
}: {
  open: boolean;
  periodKey: string;
  initialRange: PeriodRange;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Custom period dates">
      <PeriodOverrideBody
        periodKey={periodKey}
        initialRange={initialRange}
        onClose={onClose}
      />
    </Modal>
  );
}
