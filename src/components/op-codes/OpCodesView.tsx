"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, Search, X } from "lucide-react";
import type { OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import {
  createLibraryOpCode,
  deleteLibraryOpCode,
  reorderLibraryOpCodes,
  updateLibraryOpCode,
} from "@/app/actions/op-codes";
import {
  OpCodeFormModal,
  type OpCodeFormValues,
} from "./OpCodeFormModal";
import { OpCodeRow } from "./OpCodeRow";
import { OpCodeBrowseBar } from "./OpCodeBrowseBar";
import { useOpCodeBrowsing } from "./useOpCodeBrowsing";

type ModalState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; opCode: OpCode };

export function OpCodesView({ library }: { library: OpCode[] }) {
  const router = useRouter();

  const [items, setItems] = useState<OpCode[]>(library);
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [saving, startSaving] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

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
    canReorder,
  } = useOpCodeBrowsing(items);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const next = arrayMove(items, oldIdx, newIdx);
    const prev = items;
    setItems(next);
    setReorderError(null);

    startSaving(async () => {
      try {
        await reorderLibraryOpCodes(next.map((i) => i.id));
        router.refresh();
      } catch (err) {
        setItems(prev);
        setReorderError(
          err instanceof Error
            ? `Couldn't save order: ${err.message}`
            : "Couldn't save order. Restored previous.",
        );
      }
    });
  }

  async function submitAdd(values: OpCodeFormValues) {
    await new Promise<void>((resolve, reject) => {
      startSaving(async () => {
        try {
          const created = await createLibraryOpCode({
            code: values.code,
            description: values.description,
            flagHours: values.flagHours,
            notes: values.notes,
            tags: values.tags,
            subCodes: values.hasSubCodes ? values.subCodes : [],
          });
          setItems((curr) => [...curr, created]);
          setModal({ kind: "closed" });
          router.refresh();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async function submitEdit(id: string, values: OpCodeFormValues) {
    await new Promise<void>((resolve, reject) => {
      startSaving(async () => {
        try {
          const updated = await updateLibraryOpCode(id, {
            code: values.code,
            description: values.description,
            flagHours: values.flagHours,
            notes: values.notes,
            tags: values.tags,
            subCodes: values.hasSubCodes ? values.subCodes : [],
            removedSubIds: values.removedSubIds,
          });
          setItems((curr) =>
            curr.map((op) => (op.id === id ? updated : op)),
          );
          setModal({ kind: "closed" });
          router.refresh();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  function handleDelete(opCode: OpCode) {
    if (
      !window.confirm(
        `Delete "${opCode.code}"? Existing ROs that reference it will keep their line but lose the link.`,
      )
    )
      return;

    setDeletingId(opCode.id);
    startSaving(async () => {
      try {
        await deleteLibraryOpCode(opCode.id);
        setItems((curr) => curr.filter((op) => op.id !== opCode.id));
        setModal({ kind: "closed" });
        router.refresh();
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : "Failed to delete op code.",
        );
      } finally {
        setDeletingId(null);
      }
    });
  }

  // Build the initial form values for editing.
  function editInitial(opCode: OpCode): OpCodeFormValues {
    return {
      code: opCode.code,
      description: opCode.description,
      flagHours: opCode.flagHours,
      notes: opCode.notes,
      tags: opCode.tags,
      hasSubCodes: opCode.subOpCodes.length > 0,
      subCodes: opCode.subOpCodes.map((s) => ({
        draftKey: s.id,
        id: s.id,
        code: s.code,
        description: s.description,
        flagHours: s.flagHours,
      })),
      removedSubIds: [],
    };
  }

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Op Codes</h1>
          <p className="text-xs text-[var(--fg-2)]">
            Your personal library. Drag to reorder.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ kind: "add" })}
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

      {reorderError && (
        <p className="rounded-[var(--radius-sm)] bg-[var(--bad-bg)] px-3 py-2 text-xs text-[var(--bad)]">
          {reorderError}
        </p>
      )}

      {/* List — ledger sheet */}
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
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--fg-2)]">
            No op codes yet. Add one to get started.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--fg-2)]">
            No op codes match.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={visible.map((op) => op.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {visible.map((op) => (
                  <OpCodeRow
                    key={op.id}
                    opCode={op}
                    reorderable={canReorder}
                    onEdit={(target) =>
                      setModal({ kind: "edit", opCode: target })
                    }
                    onDelete={handleDelete}
                    deleting={deletingId === op.id}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
        <div className="opl-foot">
          <span>
            {visible.length === items.length
              ? `${items.length} code${items.length !== 1 ? "s" : ""}`
              : `${visible.length} of ${items.length} codes`}
          </span>
          <span className="mono tabular">
            {fmtHours(visible.reduce((sum, op) => sum + op.flagHours, 0))} flag
            hours on the books
          </span>
        </div>
      </div>

      {/* Modals */}
      <OpCodeFormModal
        open={modal.kind === "add"}
        mode="add"
        allTags={allTags}
        onClose={() => setModal({ kind: "closed" })}
        onSubmit={submitAdd}
        isPending={saving}
      />
      <OpCodeFormModal
        open={modal.kind === "edit"}
        mode="edit"
        allTags={allTags}
        initial={modal.kind === "edit" ? editInitial(modal.opCode) : undefined}
        onClose={() => setModal({ kind: "closed" })}
        onSubmit={(values) =>
          modal.kind === "edit"
            ? submitEdit(modal.opCode.id, values)
            : Promise.resolve()
        }
        onDelete={
          modal.kind === "edit"
            ? () => handleDelete(modal.opCode)
            : undefined
        }
        isPending={saving}
      />
    </main>
  );
}
