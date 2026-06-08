"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useGuestStore } from "@/lib/guest/context";
import { OpCodeFormModal, type OpCodeFormValues } from "@/components/op-codes/OpCodeFormModal";
import { fmtHours } from "@/lib/stats";
import type { OpCode } from "@/lib/types";

export function GuestOpCodesView() {
  const { opCodes, addGuestOpCode, editGuestOpCode, deleteGuestOpCode } = useGuestStore();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OpCode | null>(null);
  const [saving, setSaving] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return opCodes;
    return opCodes.filter(
      (op) =>
        op.code.toLowerCase().includes(q) ||
        op.description.toLowerCase().includes(q),
    );
  }, [opCodes, search]);

  async function handleAdd(values: OpCodeFormValues): Promise<void> {
    setSaving(true);
    try {
      addGuestOpCode({
        code: values.code,
        description: values.description,
        flagHours: values.flagHours,
        notes: values.notes,
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
          <p className="text-xs text-zinc-500">Your guest library. Changes are saved for this session.</p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500"
        >
          <Plus className="h-4 w-4" />
          <span>Add</span>
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3">
        <Search className="h-4 w-4 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code or description"
          className="w-full bg-transparent py-2 text-sm placeholder-zinc-600 focus:outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* List */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-1.5">
        {opCodes.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            No op codes yet. Add one to get started.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            No op codes match.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {visible.map((op) => (
              <li
                key={op.id}
                onClick={() => setEditTarget(op)}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 cursor-pointer transition-colors hover:border-zinc-700 hover:bg-zinc-800/60"
              >
                {/* Blank space where drag handle would be — keeps alignment identical to real app */}
                <div className="h-8 w-8 shrink-0" aria-hidden="true" />

                {/* Main content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold text-zinc-100">{op.code}</span>
                    <span className="text-xs text-orange-400">{fmtHours(op.flagHours)}h</span>
                  </div>
                  {op.description && (
                    <p className="truncate text-xs text-zinc-400">{op.description}</p>
                  )}
                  {op.notes && (
                    <p className="truncate text-xs italic text-zinc-500">{op.notes}</p>
                  )}
                </div>

                {/* Action buttons — stopPropagation so row click doesn't also fire */}
                <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => setEditTarget(op)}
                    aria-label={`Edit ${op.code}`}
                    className="cursor-pointer rounded p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(op.id, op.code)}
                    aria-label={`Delete ${op.code}`}
                    className="cursor-pointer rounded p-2 text-zinc-400 hover:bg-zinc-800 hover:text-red-300"
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
        onClose={() => setAddOpen(false)}
        onSubmit={handleAdd}
        isPending={saving}
      />

      {/* Edit modal */}
      <OpCodeFormModal
        open={editTarget !== null}
        mode="edit"
        initial={
          editTarget
            ? {
                code: editTarget.code,
                description: editTarget.description,
                flagHours: editTarget.flagHours,
                notes: editTarget.notes,
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
