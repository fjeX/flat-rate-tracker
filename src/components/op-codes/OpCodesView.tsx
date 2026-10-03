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
import { Plus, Tag } from "lucide-react";
import type { OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import {
  createLibraryOpCode,
  deleteLibraryOpCode,
  reorderLibraryOpCodes,
  setTagColorAction,
  updateLibraryOpCode,
} from "@/app/actions/op-codes";
import {
  OpCodeFormModal,
  type OpCodeFormValues,
} from "./OpCodeFormModal";
import { OpCodeRow } from "./OpCodeRow";
import { OpCodeBrowseBar } from "./OpCodeBrowseBar";
import { useOpCodeBrowsing } from "./useOpCodeBrowsing";
import { useOpCodeLabelMode } from "./useOpCodeLabelMode";
import { actionErrorMessage } from "@/lib/action-error";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { withPt } from "@/components/ui/Figure";
import { StatusField } from "@/components/ui/StatusField";
import { Zone } from "@/components/ui/Zone";

type ModalState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; opCode: OpCode };

export function OpCodesView({
  library,
  tagColors: initialTagColors = {},
}: {
  library: OpCode[];
  /** Per-tag colour overrides (settings.tagColors). */
  tagColors?: Record<string, number>;
}) {
  const router = useRouter();

  const [items, setItems] = useState<OpCode[]>(library);
  const [tagColors, setTagColors] = useState<Record<string, number>>(initialTagColors);
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

  const [labelMode, setLabelMode] = useOpCodeLabelMode();

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

  // Tag colours are library-wide, saved immediately (not part of the form
  // draft) — optimistic update, rolled back if the server rejects it.
  function handleSetTagColor(tag: string, hue: number | null) {
    const key = tag.trim().toLowerCase();
    if (!key) return;
    const prev = tagColors;
    const next = { ...tagColors };
    if (hue === null) delete next[key];
    else next[key] = hue;
    setTagColors(next);
    startSaving(async () => {
      try {
        await setTagColorAction(tag, hue);
        router.refresh();
      } catch (err) {
        setTagColors(prev);
        window.alert(
          actionErrorMessage(err, "Failed to save tag color."),
        );
      }
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
          actionErrorMessage(err, "Failed to delete op code."),
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
    <main className="opl-page">
      <div className="pagehead">
        <div className="grow">
          <h1>Op codes</h1>
          <p>
            Your library: <span className="num">{items.length}</span> {items.length === 1 ? "code" : "codes"},{" "}
            <span className="num">{withPt(fmtHours(items.reduce((sum, op) => sum + op.flagHours, 0)))}</span>h on the books.
            {" "}Drag to reorder.
          </p>
        </div>
        <Button variant="go" onClick={() => setModal({ kind: "add" })}>
          <Plus size={16} aria-hidden="true" />
          Add a code
        </Button>
      </div>

      <OpCodeBrowseBar
        search={search}
        onSearch={setSearch}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortClick={handleSortClick}
        allTags={allTags}
        selectedTags={selectedTags}
        onToggleTag={toggleTag}
        onClearTags={clearTags}
        tagColors={tagColors}
        labelMode={labelMode}
        onLabelMode={setLabelMode}
      />

      {reorderError && (
        <StatusField tag="Fix" role="alert">
          {reorderError}
        </StatusField>
      )}

      <Zone
        id="z-opl"
        name="Library"
        aside={
          visible.length === items.length
            ? undefined
            : <><span className="num">{visible.length}</span> of <span className="num">{items.length}</span> shown</>
        }
      >
        {items.length === 0 ? (
          <EmptyState
            icon={<Tag size={22} />}
            title="No op codes yet"
            description="Add the jobs you flag most and they become one-tap chips on Log RO."
            action={
              <Button variant="go" onClick={() => setModal({ kind: "add" })}>
                <Plus size={16} aria-hidden="true" />
                Add a code
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <p className="opl-empty">No op codes match.</p>
        ) : (
          <DndContext
            // a stable id: without it dnd-kit numbers its aria-describedby
            // per render pass and SSR/client hydration disagree
            id="opl-dnd"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={visible.map((op) => op.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="opl-sheet">
                <li className="opl-row opl-head-row" aria-hidden="true">
                  <span />
                  <span>{labelMode === "description" ? "Description · code" : "Code · description"}</span>
                  <span>Flag</span>
                  <span />
                </li>
                {visible.map((op) => (
                  <OpCodeRow
                    key={op.id}
                    opCode={op}
                    tagColors={tagColors}
                    reorderable={canReorder}
                    labelMode={labelMode}
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
        {items.length > 0 && (
          <div className="opl-foot">
            <span>
              <span className="num">{visible.length}</span> {visible.length === 1 ? "code" : "codes"} shown
            </span>
            <span>
              <span className="num">{withPt(fmtHours(visible.reduce((sum, op) => sum + op.flagHours, 0)))}</span>h flagged
            </span>
          </div>
        )}
      </Zone>

      {/* Modals */}
      <OpCodeFormModal
        open={modal.kind === "add"}
        mode="add"
        allTags={allTags}
        tagColors={tagColors}
        onSetTagColor={handleSetTagColor}
        onClose={() => setModal({ kind: "closed" })}
        onSubmit={submitAdd}
        isPending={saving}
      />
      <OpCodeFormModal
        open={modal.kind === "edit"}
        mode="edit"
        allTags={allTags}
        tagColors={tagColors}
        onSetTagColor={handleSetTagColor}
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
