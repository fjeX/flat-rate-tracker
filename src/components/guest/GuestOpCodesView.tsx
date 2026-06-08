"use client";

import { useMemo, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { useGuestStore } from "@/lib/guest/context";
import { OpCodeFormModal, type OpCodeFormValues } from "@/components/op-codes/OpCodeFormModal";

export function GuestOpCodesView() {
  const { opCodes, addGuestOpCode, deleteGuestOpCode } = useGuestStore();
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
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
      setModalOpen(false);
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
          onClick={() => setModalOpen(true)}
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
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-zinc-900"
              >
                <span className="min-w-[80px] font-mono text-sm text-orange-400">
                  {op.code}
                </span>
                <span className="flex-1 truncate text-sm text-zinc-200">
                  {op.description}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-zinc-400">
                  {op.flagHours} hrs
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(op.id, op.code)}
                  aria-label={`Delete ${op.code}`}
                  className="flex items-center justify-center rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add modal */}
      <OpCodeFormModal
        open={modalOpen}
        mode="add"
        onClose={() => setModalOpen(false)}
        onSubmit={handleAdd}
        isPending={saving}
      />
    </main>
  );
}
