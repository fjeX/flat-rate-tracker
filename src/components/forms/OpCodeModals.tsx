"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

// ------------------------------------------------------------------------
// Shared: a small op-code form used by both modals.
// ------------------------------------------------------------------------

export type OpCodeDraft = {
  code: string;
  description: string;
  flagHours: number;
  notes?: string;
  tags?: string[];
};

function OpCodeFields({
  draft,
  onChange,
  errorId,
  invalid,
  idPrefix = "opc",
}: {
  draft: OpCodeDraft;
  onChange: (d: OpCodeDraft) => void;
  errorId?: string;
  invalid?: boolean;
  idPrefix?: string;
}) {
  return (
    <div className="space-y-3">
      <label className="block" htmlFor={`${idPrefix}-code`}>
        <span className="text-xs uppercase tracking-wide text-[var(--fg-2)]">
          Code <span aria-hidden="true">*</span>
          <span className="sr-only"> (required)</span>
        </span>
        <input
          id={`${idPrefix}-code`}
          type="text"
          value={draft.code}
          onChange={(e) => onChange({ ...draft, code: e.target.value })}
          autoFocus
          required
          aria-required="true"
          aria-invalid={invalid}
          aria-describedby={errorId}
          className="mt-1 input font-mono"
        />
      </label>
      <label className="block" htmlFor={`${idPrefix}-description`}>
        <span className="text-xs uppercase tracking-wide text-[var(--fg-2)]">
          Description
        </span>
        <input
          id={`${idPrefix}-description`}
          type="text"
          value={draft.description}
          onChange={(e) =>
            onChange({ ...draft, description: e.target.value })
          }
          className="mt-1 input"
        />
      </label>
      <label className="block" htmlFor={`${idPrefix}-flag-hours`}>
        <span className="text-xs uppercase tracking-wide text-[var(--fg-2)]">
          Flag hours
        </span>
        <input
          id={`${idPrefix}-flag-hours`}
          type="number"
          min={0}
          step={0.1}
          value={Number.isFinite(draft.flagHours) ? draft.flagHours : ""}
          onChange={(e) =>
            onChange({
              ...draft,
              flagHours: e.target.value === "" ? 0 : Number(e.target.value),
            })
          }
          aria-describedby={errorId}
          className="mt-1 w-32 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-sm text-[var(--fg-0)] focus:border-[var(--brand)] focus:outline-none"
        />
      </label>
    </div>
  );
}

// ------------------------------------------------------------------------
// Custom op code modal — one-time, doesn't save to library.
// State lives in an inner component so it resets naturally on each open
// (the inner unmounts when the modal closes).
// ------------------------------------------------------------------------

function CustomOpCodeBody({
  initialCode,
  onAdd,
  onClose,
}: {
  initialCode: string;
  onAdd: (draft: OpCodeDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<OpCodeDraft>({
    code: initialCode,
    description: "",
    flagHours: 0,
  });
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.code.trim()) {
      setError("Code is required.");
      return;
    }
    if (!Number.isFinite(draft.flagHours) || draft.flagHours < 0) {
      setError("Flag hours must be a non-negative number.");
      return;
    }
    onAdd({
      code: draft.code.trim(),
      description: draft.description.trim(),
      flagHours: draft.flagHours,
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-xs text-[var(--fg-2)]">
        This won&apos;t be saved to your library. It&apos;s attached to this RO
        only.
      </p>
      <OpCodeFields draft={draft} onChange={setDraft} idPrefix="custom-opc" errorId={error ? "custom-opc-error" : undefined} invalid={Boolean(error)} />
      {error && <p id="custom-opc-error" role="alert" className="text-sm text-[var(--bad)]">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
        >
          Add to RO
        </button>
      </div>
    </form>
  );
}

export function CustomOpCodeModal({
  open,
  initialCode,
  onAdd,
  onClose,
}: {
  open: boolean;
  initialCode?: string;
  onAdd: (draft: OpCodeDraft) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Other op code (one-time)">
      <CustomOpCodeBody
        initialCode={initialCode ?? ""}
        onAdd={onAdd}
        onClose={onClose}
      />
    </Modal>
  );
}

// ------------------------------------------------------------------------
// New library op code modal — saves to library AND adds to RO.
// ------------------------------------------------------------------------

function NewLibraryBody({
  initialCode,
  onSubmit,
  onClose,
  isPending,
}: {
  initialCode: string;
  onSubmit: (draft: OpCodeDraft) => Promise<void>;
  onClose: () => void;
  isPending: boolean;
}) {
  const [draft, setDraft] = useState<OpCodeDraft>({
    code: initialCode,
    description: "",
    flagHours: 0,
  });
  const [error, setError] = useState<string | null>(null);

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!draft.code.trim()) {
      setError("Code is required.");
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
      <p className="text-xs text-[var(--fg-2)]">
        This will be saved to your library and added to this RO.
      </p>
      <OpCodeFields draft={draft} onChange={setDraft} idPrefix="new-lib-opc" errorId={error ? "new-lib-opc-error" : undefined} invalid={Boolean(error)} />
      {error && <p id="new-lib-opc-error" role="alert" className="text-sm text-[var(--bad)]">{error}</p>}
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
          {isPending ? "Saving…" : "Save & add"}
        </button>
      </div>
    </form>
  );
}

export function NewLibraryOpCodeModal({
  open,
  initialCode,
  onSubmit,
  onClose,
  isPending,
}: {
  open: boolean;
  initialCode?: string;
  onSubmit: (draft: OpCodeDraft) => Promise<void>;
  onClose: () => void;
  isPending: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Create new library op code">
      <NewLibraryBody
        initialCode={initialCode ?? ""}
        onSubmit={onSubmit}
        onClose={onClose}
        isPending={isPending}
      />
    </Modal>
  );
}
