"use client";

import { useState } from "react";
import { Plus, Tag } from "lucide-react";
import { useGuestStore } from "@/lib/guest/context";
import { OpCodeFormModal, type OpCodeFormValues } from "@/components/op-codes/OpCodeFormModal";
import { OpCodeBrowseBar } from "@/components/op-codes/OpCodeBrowseBar";
import { useOpCodeBrowsing } from "@/components/op-codes/useOpCodeBrowsing";
import { OpCodeRowContent } from "@/components/op-codes/OpCodeRow";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { withPt } from "@/components/ui/Figure";
import { Zone } from "@/components/ui/Zone";
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
    <main className="opl-page">
      <div className="pagehead">
        <div className="grow">
          <h1>Op codes</h1>
          <p>
            Your guest library: <span className="num">{opCodes.length}</span> {opCodes.length === 1 ? "code" : "codes"},{" "}
            <span className="num">{withPt(fmtHours(opCodes.reduce((sum, op) => sum + op.flagHours, 0)))}</span>h on the books.
            {" "}Saved for this session.
          </p>
        </div>
        <Button variant="go" onClick={() => setAddOpen(true)}>
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
      />

      <Zone
        id="z-opl"
        name="Library"
        aside={
          visible.length === opCodes.length
            ? undefined
            : <><span className="num">{visible.length}</span> of <span className="num">{opCodes.length}</span> shown</>
        }
      >
        {opCodes.length === 0 ? (
          <EmptyState
            icon={<Tag size={22} />}
            title="No op codes yet"
            description="Add the jobs you flag most and they become one-tap chips on Log RO."
            action={
              <Button variant="go" onClick={() => setAddOpen(true)}>
                <Plus size={16} aria-hidden="true" />
                Add a code
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <p className="opl-empty">No op codes match.</p>
        ) : (
          <ul className="opl-sheet">
            <li className="opl-row opl-head-row" aria-hidden="true">
              <span />
              <span>Code · description</span>
              <span>Flag</span>
              <span />
            </li>
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
                className="opl-row"
              >
                {/* Blank space where the drag handle sits in the real app */}
                <span aria-hidden="true" />
                <OpCodeRowContent
                  opCode={op}
                  onEdit={() => setEditTarget(op)}
                  onDelete={() => handleDelete(op.id, op.code)}
                />
              </li>
            ))}
          </ul>
        )}
        {opCodes.length > 0 && (
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
