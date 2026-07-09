"use client";

import { useId, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

function HoursInput({
  value,
  onChange,
  className,
  ariaLabel,
  id,
}: {
  value: number;
  onChange: (val: number) => void;
  className?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const [raw, setRaw] = useState(String(value));

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={raw}
      aria-label={ariaLabel}
      onChange={(e) => {
        const str = e.target.value;
        if (!/^[0-9]*\.?[0-9]*$/.test(str)) return;
        setRaw(str);
        const parsed = parseFloat(str);
        onChange(isNaN(parsed) ? 0 : parsed);
      }}
      onBlur={() => {
        const parsed = parseFloat(raw);
        const normalized = isNaN(parsed) || parsed < 0 ? 0 : parsed;
        setRaw(String(normalized));
        onChange(normalized);
      }}
      className={className}
    />
  );
}

// Chip-style tag editor: type a tag, Enter or comma commits it, × removes it.
// `suggestions` are tags already used elsewhere in the library (for autocomplete).
function TagInput({
  tags,
  onChange,
  suggestions,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const [raw, setRaw] = useState("");
  const listId = useId();

  function addTag(value: string) {
    const tag = value.trim().replace(/,$/, "").trim();
    if (!tag) return;
    // Case-insensitive dedupe — don't add one we already have.
    if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setRaw("");
      return;
    }
    onChange([...tags, tag]);
    setRaw("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(raw);
    } else if (e.key === "Backspace" && raw === "" && tags.length > 0) {
      // Backspace on an empty box pops the last tag.
      removeTag(tags[tags.length - 1]);
    }
  }

  // Offer only tags not already applied.
  const available = suggestions.filter(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 focus-within:border-[var(--brand)]">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-xs text-[var(--fg-1)]"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            aria-label={`Remove ${tag}`}
            className="text-[var(--fg-2)] hover:text-[var(--bad)]"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={raw}
        list={listId}
        onChange={(e) => {
          const val = e.target.value;
          // Commit when the user types a comma or picks a datalist suggestion.
          if (val.endsWith(",")) addTag(val);
          else setRaw(val);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => addTag(raw)}
        placeholder={tags.length === 0 ? "Add tags…" : ""}
        className="min-w-[6rem] flex-1 bg-transparent py-0.5 text-sm placeholder-[var(--fg-3)] focus:outline-none"
      />
      <datalist id={listId}>
        {available.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

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
  tags: string[];
  hasSubCodes: boolean;
  subCodes: SubCodeDraft[];
  removedSubIds: string[]; // IDs to delete from DB on save
};

type Mode = "add" | "edit";

function OpCodeFormBody({
  mode,
  initial,
  allTags,
  onSubmit,
  onClose,
  onDelete,
  isPending,
}: {
  mode: Mode;
  initial: OpCodeFormValues;
  allTags: string[];
  onSubmit: (values: OpCodeFormValues) => Promise<void>;
  onClose: () => void;
  onDelete?: () => void;
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
        tags: draft.tags,
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
        <label className="block" htmlFor="opc-form-code">
          <span className="text-xs uppercase tracking-wide text-[var(--fg-2)]">
            Code <span aria-hidden="true">*</span>
            <span className="sr-only"> (required)</span>
          </span>
          <input
            id="opc-form-code"
            type="text"
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            autoFocus
            required
            aria-required="true"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "opc-form-error" : undefined}
            className="mt-1 input font-mono"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-[var(--fg-2)]">
            Description
          </span>
          <input
            type="text"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="mt-1 input"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-[var(--fg-2)]">
            Flag hours
            {draft.hasSubCodes && (
              <span className="ml-2 font-normal normal-case text-[var(--fg-3)]">
                (set per sub op code — kept for reference)
              </span>
            )}
          </span>
          <HoursInput
            value={draft.flagHours}
            onChange={(val) => setDraft({ ...draft, flagHours: val })}
            className="mt-1 w-32 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-sm text-[var(--fg-0)] focus:border-[var(--brand)] focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-[var(--fg-2)]">
            Notes{" "}
            <span className="font-normal normal-case text-[var(--fg-3)]">
              (optional)
            </span>
          </span>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={2}
            placeholder="Part numbers, reminders, procedure notes…"
            className="mt-1 w-full resize-y input placeholder-[var(--fg-3)]"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-[var(--fg-2)]">
            Tags{" "}
            <span className="font-normal normal-case text-[var(--fg-3)]">
              (optional — group repairs, e.g. Brakes, Warranty)
            </span>
          </span>
          <TagInput
            tags={draft.tags}
            onChange={(tags) => setDraft({ ...draft, tags })}
            suggestions={allTags}
          />
        </label>
      </div>

      {/* Sub op codes */}
      <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] p-3 space-y-3">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draft.hasSubCodes}
            onChange={(e) => toggleSubCodes(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--line)] bg-[var(--bg-3)] accent-[var(--brand)]"
          />
          <span className="text-sm text-[var(--fg-1)]">This op code has sub op codes</span>
        </label>

        {draft.hasSubCodes && (
          <div className="space-y-2">
            {/* Column header */}
            {draft.subCodes.length > 0 && (
              <div className="grid grid-cols-[100px_1fr_72px_32px] gap-2 px-1">
                <span className="text-xs text-[var(--fg-2)]">Code</span>
                <span className="text-xs text-[var(--fg-2)]">Description</span>
                <span className="text-xs text-[var(--fg-2)]">Flag hrs</span>
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
                  aria-label="Sub op code"
                  required
                  aria-required="true"
                  className="rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-sm font-mono text-[var(--fg-0)] focus:border-[var(--brand)] focus:outline-none"
                />
                <input
                  type="text"
                  value={sub.description}
                  onChange={(e) => updateSubCode(sub.draftKey, { description: e.target.value })}
                  placeholder="Description…"
                  aria-label="Sub op code description"
                  className="rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-sm text-[var(--fg-0)] focus:border-[var(--brand)] focus:outline-none"
                />
                <HoursInput
                  value={sub.flagHours}
                  onChange={(val) => updateSubCode(sub.draftKey, { flagHours: val })}
                  ariaLabel="Sub op code flag hours"
                  className="rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1.5 text-sm text-[var(--fg-0)] focus:border-[var(--brand)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeSubCode(sub.draftKey)}
                  aria-label="Remove sub op code"
                  className="flex items-center justify-center rounded p-1 text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--bad)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addSubCode}
              className="flex items-center gap-1.5 min-h-[38px] rounded-[var(--radius-sm)] border border-dashed border-[var(--line-soft)] px-3 py-1.5 text-xs text-[var(--fg-2)] hover:border-[var(--brand-soft)] hover:text-[var(--fg-1)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add sub op code
            </button>
          </div>
        )}
      </div>

      {error && <p id="opc-form-error" role="alert" className="text-sm text-[var(--bad)]">{error}</p>}

      <div className="flex items-center justify-between gap-2 pt-2">
        <div>
          {mode === "edit" && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={isPending}
              className="btn"
              style={{
                color: "var(--bad)",
                borderColor: "color-mix(in oklab, var(--bad) 40%, transparent)",
                background: "transparent",
              }}
            >
              Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
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
          {isPending ? "Saving…" : mode === "add" ? "Save" : "Save changes"}
        </button>
        </div>
      </div>
    </form>
  );
}

export function OpCodeFormModal({
  open,
  mode,
  initial,
  allTags = [],
  onSubmit,
  onClose,
  onDelete,
  isPending,
}: {
  open: boolean;
  mode: Mode;
  initial?: OpCodeFormValues;
  allTags?: string[];
  onSubmit: (values: OpCodeFormValues) => Promise<void>;
  onClose: () => void;
  onDelete?: () => void;
  isPending: boolean;
}) {
  const title = mode === "add" ? "New op code" : "Edit op code";
  const seeded: OpCodeFormValues = initial ?? {
    code: "",
    description: "",
    flagHours: 0,
    notes: "",
    tags: [],
    hasSubCodes: false,
    subCodes: [],
    removedSubIds: [],
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <OpCodeFormBody
        mode={mode}
        initial={seeded}
        allTags={allTags}
        onSubmit={onSubmit}
        onClose={onClose}
        onDelete={onDelete}
        isPending={isPending}
      />
    </Modal>
  );
}
