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
      <p className="text-xs text-zinc-500">
        Override the date range for this pay period. ROs with dates inside the
        new range will appear here.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-zinc-400">
            Start
          </span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-zinc-400">
            End
          </span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
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
