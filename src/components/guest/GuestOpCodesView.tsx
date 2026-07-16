"use client";

import { useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useGuestStore } from "@/lib/guest/context";
import { OpCodeFormModal, type OpCodeFormValues } from "@/components/op-codes/OpCodeFormModal";
import { OpCodeBrowseBar } from "@/components/op-codes/OpCodeBrowseBar";
import { useOpCodeBrowsing } from "@/components/op-codes/useOpCodeBrowsing";
import { tagHueVar } from "@/components/op-codes/tagHue";
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
          className="min-h-[44px] w-full rounded-full bg-transparent px-1 text-sm placeholder-[var(--fg-3)] focus-ring focus:outline-none"
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

      {/* List — ledger sheet (mirrors the authed view's layout) */}
      <div className="opl-sheet">
        <div className="opl-grid opl-head" aria-hidden="true">
          <span />
          <div className="opl-main">
            <span className="opl-codecell">Code</span>
            <span className="opl-desc">Description</span>
          </div>
          <span className="opl-hours">Flag hrs</span>
          <span />
        </div>
        {opCodes.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--fg-2)]">
            No op codes yet. Add one to get started.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--fg-2)]">
            No op codes match.
          </p>
        ) : (
          <ul>
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
                className="opl-grid opl-row"
              >
                {/* Blank space where the drag handle sits in the real app */}
                <div className="h-8 w-8 shrink-0" aria-hidden="true" />

                <div className="opl-main">
                  <div
                    className="opl-codecell"
                    title={op.tags.length > 0 ? op.tags.join(", ") : undefined}
                  >
                    <span
                      className="opl-tick"
                      style={
                        {
                          "--tagc": tagHueVar(op.tags[0]),
                        } as React.CSSProperties
                      }
                    />
                    <span className="truncate font-mono text-sm font-semibold text-[var(--fg-0)]">
                      {op.code}
                    </span>
                  </div>

                  <div className="opl-desc">
                    <span className="truncate text-xs">
                      {op.description && (
                        <span className="text-[var(--fg-1)]">
                          {op.description}
                        </span>
                      )}
                      {op.notes && (
                        <span className="italic text-[var(--fg-3)]">
                          {op.description ? " · " : ""}
                          {op.notes}
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                <span className="opl-hours font-mono text-sm font-semibold tabular text-[var(--brand)]">
                  {fmtHours(op.flagHours)}
                </span>

                {/* Action buttons — stopPropagation so row click doesn't also fire */}
                <div
                  className="opl-acts flex shrink-0 items-center justify-end gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setEditTarget(op)}
                    aria-label={`Edit ${op.code}`}
                    className="relative cursor-pointer rounded-full p-2 text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--fg-0)] after:absolute after:-inset-1.5 after:content-['']"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(op.id, op.code)}
                    aria-label={`Delete ${op.code}`}
                    className="relative cursor-pointer rounded-full p-2 text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--bad)] after:absolute after:-inset-1.5 after:content-['']"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="opl-foot">
          <span>
            {visible.length === opCodes.length
              ? `${opCodes.length} code${opCodes.length !== 1 ? "s" : ""}`
              : `${visible.length} of ${opCodes.length} codes`}
          </span>
          <span className="mono tabular">
            {fmtHours(visible.reduce((sum, op) => sum + op.flagHours, 0))} flag
            hours on the books
          </span>
        </div>
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
