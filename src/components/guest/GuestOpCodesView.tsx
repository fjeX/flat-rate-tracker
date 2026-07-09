"use client";

import { useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useGuestStore } from "@/lib/guest/context";
import { OpCodeFormModal, type OpCodeFormValues } from "@/components/op-codes/OpCodeFormModal";
import { OpCodeBrowseBar } from "@/components/op-codes/OpCodeBrowseBar";
import { useOpCodeBrowsing } from "@/components/op-codes/useOpCodeBrowsing";
import { fmtHours } from "@/lib/stats";
import type { OpCode } from "@/lib/types";

export function GuestOpCodesView() {
  const { opCodes, addGuestOpCode, editGuestOpCode, deleteGuestOpCode } = useGuestStore();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OpCode | null>(null);
  const [saving, setSaving] = useState(false);

  const {
    search,
    setSearch,
    sortBy,
    sortDir,
    handleSortClick,
    selectedTags,
    toggleTag,
    clearTags,
    allTags,
    visible,
  } = useOpCodeBrowsing(opCodes);

  async function handleAdd(values: OpCodeFormValues): Promise<void> {
    setSaving(true);
    try {
      addGuestOpCode({
        code: values.code,
        description: values.description,
        flagHours: values.flagHours,
        notes: values.notes,
        tags: values.tags,
      });
      setAddOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(values: OpCodeFormValues): Promise<void> {
    if (!editTarget) return;
    setSaving(true);
    try {
      editGuestOpCode(editTarget.id, {
        code: values.code,
        description: values.description,
        flagHours: values.flagHours,
        notes: values.notes,
        tags: values.tags,
      });
      setEditTarget(null);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(id: string, code: string) {
    if (
      !window.confirm(
        `Delete "${code}"? Existing ROs that reference it will keep their line but lose the link.`,
      )
    )
      return;
    deleteGuestOpCode(id);
  }

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Op Codes</h1>
          <p className="text-xs text-[var(--fg-2)]">Your guest library. Changes are saved for this session.</p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="btn btn-primary"
        >
          <Plus className="h-4 w-4" />
          <span>Add</span>
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3">
        <Search className="h-4 w-4 text-[var(--fg-2)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code or description"
          className="w-full bg-transparent py-2 text-sm placeholder-[var(--fg-3)] focus:outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="text-[var(--fg-2)] hover:text-[var(--fg-1)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Sort + tag filters */}
      <OpCodeBrowseBar
        sortBy={sortBy}
        sortDir={sortDir}
        onSortClick={handleSortClick}
        allTags={allTags}
        selectedTags={selectedTags}
        onToggleTag={toggleTag}
        onClearTags={clearTags}
      />

      {/* List */}
      <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-1)] p-1.5">
        {opCodes.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--fg-2)]">
            No op codes yet. Add one to get started.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--fg-2)]">
            No op codes match.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {visible.map((op) => (
              <li
                key={op.id}
                role="button"
                tabIndex={0}
                onClick={() => setEditTarget(op)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setEditTarget(op);
                  }
                }}
                aria-label={`Edit ${op.code}`}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2 py-2 cursor-pointer transition-colors hover:border-[var(--line)] hover:bg-[var(--bg-3)]"
              >
                {/* Blank space where drag handle would be — keeps alignment identical to real app */}
                <div className="h-8 w-8 shrink-0" aria-hidden="true" />

                {/* Main content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold text-[var(--fg-0)]">{op.code}</span>
                    <span className="text-xs text-[var(--brand)]">{fmtHours(op.flagHours)}h</span>
                  </div>
                  {op.description && (
                    <p className="truncate text-xs text-[var(--fg-2)]">{op.description}</p>
                  )}
                  {op.notes && (
                    <p className="truncate text-xs italic text-[var(--fg-2)]">{op.notes}</p>
                  )}
                  {op.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {op.tags.map((tag) => (
                        <span
                          key={tag}
                          className="badge badge-neutral"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action buttons — stopPropagation so row click doesn't also fire */}
                <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => setEditTarget(op)}
                    aria-label={`Edit ${op.code}`}
                    className="cursor-pointer rounded p-2 text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--fg-0)]"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(op.id, op.code)}
                    aria-label={`Delete ${op.code}`}
                    className="cursor-pointer rounded p-2 text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--bad)]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add modal */}
      <OpCodeFormModal
        open={addOpen}
        mode="add"
        allTags={allTags}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAdd}
        isPending={saving}
      />

      {/* Edit modal */}
      <OpCodeFormModal
        open={editTarget !== null}
        mode="edit"
        allTags={allTags}
        initial={
          editTarget
            ? {
                code: editTarget.code,
                description: editTarget.description,
                flagHours: editTarget.flagHours,
                notes: editTarget.notes,
                tags: editTarget.tags,
                hasSubCodes: false,
                subCodes: [],
                removedSubIds: [],
              }
            : undefined
        }
        onClose={() => setEditTarget(null)}
        onSubmit={handleEdit}
        onDelete={() => {
          if (editTarget) handleDelete(editTarget.id, editTarget.code);
          setEditTarget(null);
        }}
        isPending={saving}
      />
    </main>
  );
}
