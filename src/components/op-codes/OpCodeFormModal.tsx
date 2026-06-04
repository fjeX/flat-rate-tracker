"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

export type SubCodeDraft = {
  draftKey: string; // local React key; crypto.randomUUID() for new, id for existing
  id?: string;      // undefined = not yet saved
  code: string;
  description: string;
  flagHours: number;
};

export type OpCodeFormValues = {
  code: string;
  description: string;
  flagHours: number;
  notes: string;
  hasSubCodes: boolean;
  subCodes: SubCodeDraft[];
  removedSubIds: string[]; // IDs to delete from DB on save
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

  function toggleSubCodes(enabled: boolean) {
    if (!enabled) {
      // Collect existing sub IDs to mark for deletion on save.
      const toRemove = draft.subCodes
        .filter((s) => s.id !== undefined)
        .map((s) => s.id as string);
      setDraft((d) => ({
        ...d,
        hasSubCodes: false,
        subCodes: [],
        removedSubIds: [...d.removedSubIds, ...toRemove],
      }));
    } else {
      setDraft((d) => ({ ...d, hasSubCodes: true }));
    }
  }

  function addSubCode() {
    setDraft((d) => ({
      ...d,
      subCodes: [
        ...d.subCodes,
        {
          draftKey: crypto.randomUUID(),
          code: "",
          description: "",
          flagHours: 0,
        },
      ],
    }));
  }

  function updateSubCode(draftKey: string, patch: Partial<SubCodeDraft>) {
    setDraft((d) => ({
      ...d,
      subCodes: d.subCodes.map((s) =>
        s.draftKey === draftKey ? { ...s, ...patch } : s,
      ),
    }));
  }

  function removeSubCode(draftKey: string) {
    const target = draft.subCodes.find((s) => s.draftKey === draftKey);
    setDraft((d) => ({
      ...d,
      subCodes: d.subCodes.filter((s) => s.draftKey !== draftKey),
      removedSubIds: target?.id
        ? [...d.removedSubIds, target.id]
        : d.removedSubIds,
    }));
  }

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
    if (draft.hasSubCodes) {
      for (const sub of draft.subCodes) {
        if (!sub.code.trim()) {
          setError("All sub op codes must have a code.");
          return;
        }
        if (!Number.isFinite(sub.flagHours) || sub.flagHours < 0) {
          setError("All sub op code flag hours must be non-negative.");
          return;
        }
      }
    }

    try {
      await onSubmit({
        code: draft.code.trim(),
        description: draft.description.trim(),
        flagHours: draft.flagHours,
        notes: draft.notes.trim(),
        hasSubCodes: draft.hasSubCodes,
        subCodes: draft.subCodes,
        removedSubIds: draft.removedSubIds,
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
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-zinc-400">
            Flag hours
            {draft.hasSubCodes && (
              <span className="ml-2 font-normal normal-case text-zinc-600">
                (set per sub op code — kept for reference)
              </span>
            )}
          </span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={Number.isFinite(draft.flagHours) ? draft.flagHours : ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                flagHours: e.target.value === "" ? 0 : Number(e.target.value),
              })
            }
            className="mt-1 w-32 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-zinc-400">
            Notes{" "}
            <span className="font-normal normal-case text-zinc-600">
              (optional)
            </span>
          </span>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={2}
            placeholder="Part numbers, reminders, procedure notes…"
            className="mt-1 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder-zinc-600 focus:border-orange-500 focus:outline-none"
          />
        </label>
      </div>

      {/* Sub op codes */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3 space-y-3">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draft.hasSubCodes}
            onChange={(e) => toggleSubCodes(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-orange-500"
          />
          <span className="text-sm text-zinc-300">This op code has sub op codes</span>
        </label>

        {draft.hasSubCodes && (
          <div className="space-y-2">
            {/* Column header */}
            {draft.subCodes.length > 0 && (
              <div className="grid grid-cols-[100px_1fr_72px_32px] gap-2 px-1">
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">Code</span>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">Description</span>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">Flag hrs</span>
                <span />
              </div>
            )}

            {draft.subCodes.map((sub) => (
              <div
                key={sub.draftKey}
                className="grid grid-cols-[100px_1fr_72px_32px] items-center gap-2"
              >
                <input
                  type="text"
                  value={sub.code}
                  onChange={(e) => updateSubCode(sub.draftKey, { code: e.target.value })}
                  placeholder="R1"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm font-mono focus:border-orange-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={sub.description}
                  onChange={(e) => updateSubCode(sub.draftKey, { description: e.target.value })}
                  placeholder="Description…"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none"
                />
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={Number.isFinite(sub.flagHours) ? sub.flagHours : ""}
                  onChange={(e) =>
                    updateSubCode(sub.draftKey, {
                      flagHours: e.target.value === "" ? 0 : Number(e.target.value),
                    })
                  }
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeSubCode(sub.draftKey)}
                  aria-label="Remove sub op code"
                  className="flex items-center justify-center rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addSubCode}
              className="flex items-center gap-1.5 rounded-md border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-orange-500/50 hover:text-zinc-200"
            >
              <Plus className="h-3.5 w-3.5" />
              Add sub op code
            </button>
          </div>
        )}
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
          {isPending ? "Saving…" : mode === "add" ? "Save" : "Save changes"}
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
    notes: "",
    hasSubCodes: false,
    subCodes: [],
    removedSubIds: [],
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
