"use client";

import { useMemo, useState, useTransition } from "react";
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

type ModalState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; opCode: OpCode };

export function OpCodesView({ library }: { library: OpCode[] }) {
  const router = useRouter();

  const [items, setItems] = useState<OpCode[]>(library);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [saving, startSaving] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const isSearching = search.trim() !== "";

  const visible = useMemo(() => {
    if (!isSearching) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (op) =>
        op.code.toLowerCase().includes(q) ||
        op.description.toLowerCase().includes(q),
    );
  }, [items, isSearching, search]);

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
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Op Codes</h1>
          <p className="text-xs text-zinc-500">
            Your personal library. Drag to reorder.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ kind: "add" })}
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

      {reorderError && (
        <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {reorderError}
        </p>
      )}

      {/* List */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            No op codes yet. Add one to get started.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
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
              <ul className="divide-y divide-zinc-800">
                {visible.map((op) => (
                  <OpCodeRow
                    key={op.id}
                    opCode={op}
                    isSearching={isSearching}
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
      </div>

      {/* Modals */}
      <OpCodeFormModal
        open={modal.kind === "add"}
        mode="add"
        onClose={() => setModal({ kind: "closed" })}
        onSubmit={submitAdd}
        isPending={saving}
      />
      <OpCodeFormModal
        open={modal.kind === "edit"}
        mode="edit"
        initial={modal.kind === "edit" ? editInitial(modal.opCode) : undefined}
        onClose={() => setModal({ kind: "closed" })}
        onSubmit={(values) =>
          modal.kind === "edit"
            ? submitEdit(modal.opCode.id, values)
            : Promise.resolve()
        }
        isPending={saving}
      />
    </div>
  );
}
