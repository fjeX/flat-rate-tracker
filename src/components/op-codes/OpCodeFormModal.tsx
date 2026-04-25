"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

export type OpCodeFormValues = {
  code: string;
  description: string;
  flagHours: number;
};

type Mode = "add" | "edit";

function OpCodeFormBody({
  mode,
  initial,
  onSubmit,
  onClose,
  isPending,
}: {
  mode: Mode;
  initial: OpCodeFormValues;
  onSubmit: (values: OpCodeFormValues) => Promise<void>;
  onClose: () => void;
  isPending: boolean;
}) {
  const [draft, setDraft] = useState<OpCodeFormValues>(initial);
  const [error, setError] = useState<string | null>(null);

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!draft.code.trim()) {
      setError("Code is required.");
      return;
    }
    if (!Number.isFinite(draft.flagHours) || draft.flagHours < 0) {
      setError("Flag hours must be a non-negative number.");
      return;
    }
    try {
      await onSubmit({
        code: draft.code.trim(),
        description: draft.description.trim(),
        flagHours: draft.flagHours,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  return (
    <form onSubmit={handle} className="space-y-4">
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-zinc-400">
            Code
          </span>
          <input
            type="text"
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            autoFocus
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-mono focus:border-orange-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-zinc-400">
            Description
          </span>
          <input
            type="text"
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-zinc-400">
            Flag hours
          </span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={Number.isFinite(draft.flagHours) ? draft.flagHours : ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                flagHours:
                  e.target.value === "" ? 0 : Number(e.target.value),
              })
            }
            className="mt-1 w-32 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
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
          {isPending
            ? "Saving…"
            : mode === "add"
              ? "Save"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}

export function OpCodeFormModal({
  open,
  mode,
  initial,
  onSubmit,
  onClose,
  isPending,
}: {
  open: boolean;
  mode: Mode;
  initial?: OpCodeFormValues;
  onSubmit: (values: OpCodeFormValues) => Promise<void>;
  onClose: () => void;
  isPending: boolean;
}) {
  const title = mode === "add" ? "New op code" : "Edit op code";
  const seeded: OpCodeFormValues = initial ?? {
    code: "",
    description: "",
    flagHours: 0,
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <OpCodeFormBody
        mode={mode}
        initial={seeded}
        onSubmit={onSubmit}
        onClose={onClose}
        isPending={isPending}
      />
    </Modal>
  );
}
