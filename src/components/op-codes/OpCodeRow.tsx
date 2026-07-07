"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import type { OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";

export function OpCodeRow({
  opCode,
  reorderable,
  onEdit,
  onDelete,
  deleting,
}: {
  opCode: OpCode;
  reorderable: boolean;
  onEdit: (op: OpCode) => void;
  onDelete: (op: OpCode) => void;
  deleting: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: opCode.id, disabled: !reorderable });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={() => onEdit(opCode)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit(opCode);
        }
      }}
      aria-label={`Edit ${opCode.code}`}
      className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2 py-2 cursor-pointer transition-colors hover:border-[var(--line)] hover:bg-[var(--bg-3)]"
    >
      {!reorderable ? (
        <div className="h-8 w-8 shrink-0" aria-hidden="true" />
      ) : (
        <div
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--fg-2)] cursor-grab active:cursor-grabbing hover:text-[var(--fg-1)]"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-[var(--fg-0)]">
            {opCode.code}
          </span>
          <span className="text-xs text-[var(--brand)]">
            {fmtHours(opCode.flagHours)}h
          </span>
          {opCode.subOpCodes.length > 0 && (
            <span className="rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--fg-2)]">
              {opCode.subOpCodes.length} sub{opCode.subOpCodes.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {opCode.description && (
          <p className="truncate text-xs text-[var(--fg-2)]">
            {opCode.description}
          </p>
        )}
        {opCode.notes && (
          <p className="truncate text-xs italic text-[var(--fg-2)]">
            {opCode.notes}
          </p>
        )}
        {opCode.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {opCode.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[10px] text-[var(--fg-2)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onEdit(opCode)}
          aria-label={`Edit ${opCode.code}`}
          className="relative cursor-pointer rounded p-2 text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--fg-0)] after:absolute after:-inset-1.5 after:content-['']"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(opCode)}
          disabled={deleting}
          aria-label={`Delete ${opCode.code}`}
          className="relative cursor-pointer rounded p-2 text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--bad)] disabled:opacity-50 after:absolute after:-inset-1.5 after:content-['']"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
