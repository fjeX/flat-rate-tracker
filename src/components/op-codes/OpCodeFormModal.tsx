"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { StatusField } from "@/components/ui/StatusField";
import { Switch } from "@/components/ui/Switch";
import { TAG_HUE_SLOTS, tagHueOverride, tagHueSlot, tagHueVar } from "./tagHue";
import { actionErrorMessage } from "@/lib/action-error";

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

// Single-line-looking textarea that grows with its content so long sub op
// code descriptions are fully readable while editing.
function AutoGrowInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={`ocf-grow ${className ?? ""}`}
    />
  );
}

// Chip-style tag editor: type a tag, Enter or comma commits it, × removes it.
// `suggestions` are tags already used elsewhere in the library (for autocomplete).
// When `onSetTagColor` is provided, each chip gets a colour dot that opens an
// 8-swatch picker — colours are library-wide per tag, saved immediately.
function TagInput({
  inputId,
  tags,
  onChange,
  suggestions,
  tagColors,
  onSetTagColor,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  inputId: string;
  tagColors?: Record<string, number>;
  onSetTagColor?: (tag: string, hue: number | null) => void;
}) {
  const [raw, setRaw] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
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
    <div className="ocf-tags">
      <input
        id={inputId}
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
        className="input"
      />
      <datalist id={listId}>
        {available.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {tags.length > 0 && (
        <div className="fchips ocf-chips">
          {tags.map((tag) => (
            <span key={tag} className="fchip ocf-chip">
              {onSetTagColor && (
                <button
                  type="button"
                  onClick={() => setPickerFor(pickerFor === tag ? null : tag)}
                  aria-label={`Change color for ${tag}`}
                  aria-expanded={pickerFor === tag}
                  title="Tag color"
                  className="ocf-dot"
                  style={{ "--tagc": tagHueVar(tag, tagColors) } as React.CSSProperties}
                >
                  <span className="hue" aria-hidden="true" />
                </button>
              )}
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove ${tag}`}
                className="ocf-x-tag"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Swatch picker for the chip whose dot was tapped */}
      {onSetTagColor && pickerFor && tags.includes(pickerFor) && (
        <div className="ocf-picker" role="group" aria-label={`Color for ${pickerFor}`}>
          <span className="ocf-picker-tag">{pickerFor}:</span>
          {/* "Pinned" and "showing" are different questions. A tag whose hash
              lands on the slot the user pinned looks identical either way, so
              a picker keyed on the resolved colour alone made "Auto" appear to
              do nothing. Solid ring = pinned here; soft ring = auto landed
              here. */}
          {Array.from({ length: TAG_HUE_SLOTS }, (_, i) => {
            const pinned = tagHueOverride(pickerFor, tagColors) === i;
            const showing = tagHueSlot(pickerFor, tagColors) === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  onSetTagColor(pickerFor, i);
                  setPickerFor(null);
                }}
                aria-pressed={pinned}
                aria-label={`Color ${i + 1}${
                  pinned ? " (current)" : showing ? " (current, automatic)" : ""
                }`}
                className={`ocf-swatch${showing && !pinned ? " is-showing" : ""}`}
                style={{ "--swatch": `var(--tag-hue-${i})` } as React.CSSProperties}
              />
            );
          })}
          {(() => {
            const isAuto = tagHueOverride(pickerFor, tagColors) === null;
            return (
              <button
                type="button"
                onClick={() => {
                  onSetTagColor(pickerFor, null);
                  setPickerFor(null);
                }}
                aria-pressed={isAuto}
                aria-label={`Auto${isAuto ? " (current)" : ""}`}
                className="fchip ocf-auto"
              >
                Auto
              </button>
            );
          })()}
        </div>
      )}
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

// Owns the draft and renders the Modal itself: the footer's Save/Delete need
// the form's state, and the Modal only takes the footer as a prop.
function OpCodeFormBody({
  open,
  title,
  mode,
  initial,
  allTags,
  tagColors,
  onSetTagColor,
  onSubmit,
  onClose,
  onDelete,
  isPending,
}: {
  open: boolean;
  title: string;
  mode: Mode;
  initial: OpCodeFormValues;
  allTags: string[];
  tagColors?: Record<string, number>;
  onSetTagColor?: (tag: string, hue: number | null) => void;
  onSubmit: (values: OpCodeFormValues) => Promise<void>;
  onClose: () => void;
  onDelete?: () => void;
  isPending: boolean;
}) {
  const [draft, setDraft] = useState<OpCodeFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const formId = `${uid}-form`;
  const descId = `${uid}-desc`;
  const hoursId = `${uid}-hours`;
  const notesId = `${uid}-notes`;
  const tagsId = `${uid}-tags`;

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
      setError(actionErrorMessage(err, "Failed to save."));
    }
  }


  const footer = (
    <>
      {mode === "edit" && onDelete && (
        <Button variant="danger" onClick={onDelete} disabled={isPending}>
          Delete
        </Button>
      )}
      <span className="ocf-foot-end">
        <Button variant="quiet" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="go" type="submit" form={formId} disabled={isPending}>
          {isPending ? "Saving…" : mode === "add" ? "Save" : "Save changes"}
        </Button>
      </span>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" footer={footer}>
      <form id={formId} onSubmit={handle} className="ocf-form">
        <Field label="Code" htmlFor="opc-form-code">
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
            className="input mono"
          />
        </Field>
        <Field label="Description" htmlFor={descId}>
          <input
            id={descId}
            type="text"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="input"
          />
        </Field>
        <Field
          label="Flag hours"
          htmlFor={hoursId}
          hint={draft.hasSubCodes ? "Set per sub op code — kept for reference" : undefined}
          className="ocf-hours"
        >
          <HoursInput
            id={hoursId}
            value={draft.flagHours}
            onChange={(val) => setDraft({ ...draft, flagHours: val })}
            className="input num"
          />
        </Field>
        <Field label="Notes (optional)" htmlFor={notesId}>
          <textarea
            id={notesId}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={2}
            placeholder="Part numbers, reminders, procedure notes…"
            className="input"
          />
        </Field>
        <Field
          label="Tags"
          htmlFor={tagsId}
          hint="Optional — group repairs, e.g. Brakes, Warranty"
        >
          <TagInput
            inputId={tagsId}
            tags={draft.tags}
            onChange={(tags) => setDraft({ ...draft, tags })}
            suggestions={allTags}
            tagColors={tagColors}
            onSetTagColor={onSetTagColor}
          />
        </Field>

        {/* Sub op codes */}
        <div className="card-inset ocf-sub">
          <div className="ocf-sub-head">
            <span className="ocf-sub-label">This op code has sub op codes</span>
            <Switch
              checked={draft.hasSubCodes}
              onChange={toggleSubCodes}
              label="This op code has sub op codes"
            />
          </div>

          {draft.hasSubCodes && (
            <>
              {draft.subCodes.length > 0 && (
                <table className="table ocf-table">
                  <thead>
                    <tr>
                      <th scope="col">Code</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="table-num">Flag hrs</th>
                      <th scope="col"><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.subCodes.map((sub) => (
                      <tr key={sub.draftKey}>
                        <td className="ocf-c-code">
                          <input
                            type="text"
                            value={sub.code}
                            onChange={(e) => updateSubCode(sub.draftKey, { code: e.target.value })}
                            placeholder="R1"
                            aria-label="Sub op code"
                            required
                            aria-required="true"
                            className="input mono"
                          />
                        </td>
                        <td>
                          <AutoGrowInput
                            value={sub.description}
                            onChange={(val) => updateSubCode(sub.draftKey, { description: val })}
                            placeholder="Description…"
                            ariaLabel="Sub op code description"
                            className="input"
                          />
                        </td>
                        <td className="ocf-c-hrs">
                          <HoursInput
                            value={sub.flagHours}
                            onChange={(val) => updateSubCode(sub.draftKey, { flagHours: val })}
                            ariaLabel="Sub op code flag hours"
                            className="input num"
                          />
                        </td>
                        <td className="ocf-c-x">
                          <Button
                            variant="quiet"
                            className="ocf-x"
                            onClick={() => removeSubCode(sub.draftKey)}
                            // Falls back while the code field is still empty mid-typing.
                            aria-label={
                              sub.code.trim()
                                ? `Remove sub op code ${sub.code.trim()}`
                                : "Remove sub op code"
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <Button variant="line" onClick={addSubCode}>
                <Plus className="h-3.5 w-3.5" />
                Add sub op code
              </Button>
            </>
          )}
        </div>

        {error && (
          <StatusField tag="Fix" role="alert" inset id="opc-form-error">
            {error}
          </StatusField>
        )}
      </form>
    </Modal>
  );
}

export function OpCodeFormModal({
  open,
  mode,
  initial,
  allTags = [],
  tagColors,
  onSetTagColor,
  onSubmit,
  onClose,
  onDelete,
  isPending,
}: {
  open: boolean;
  mode: Mode;
  initial?: OpCodeFormValues;
  allTags?: string[];
  /** Per-tag colour overrides (settings.tagColors). */
  tagColors?: Record<string, number>;
  /** When provided, tag chips get the colour-dot picker. */
  onSetTagColor?: (tag: string, hue: number | null) => void;
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

  // The form owns the Modal, so it must unmount when closed or the draft
  // would survive between openings (the Modal itself used to do this).
  if (!open) return null;

  return (
    <OpCodeFormBody
      open={open}
      title={title}
      mode={mode}
      initial={seeded}
      allTags={allTags}
      tagColors={tagColors}
      onSetTagColor={onSetTagColor}
      onSubmit={onSubmit}
      onClose={onClose}
      onDelete={onDelete}
      isPending={isPending}
    />
  );
}
