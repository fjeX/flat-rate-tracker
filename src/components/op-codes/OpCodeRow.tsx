"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import type { OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";

export function OpCodeRow({
  opCode,
  isSearching,
  onEdit,
  onDelete,
  deleting,
}: {
  opCode: OpCode;
  isSearching: boolean;
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
  } = useSortable({ id: opCode.id, disabled: isSearching });

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
      onClick={() => onEdit(opCode)}
      className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 cursor-pointer transition-colors hover:border-zinc-700 hover:bg-zinc-800/60"
    >
      {isSearching ? (
        <div className="h-8 w-8 shrink-0" aria-hidden="true" />
      ) : (
        <div
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-zinc-500 cursor-grab active:cursor-grabbing hover:text-zinc-300"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-zinc-100">
            {opCode.code}
          </span>
          <span className="text-xs text-orange-400">
            {fmtHours(opCode.flagHours)}h
          </span>
          {opCode.subOpCodes.length > 0 && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
              {opCode.subOpCodes.length} sub{opCode.subOpCodes.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {opCode.description && (
          <p className="truncate text-xs text-zinc-400">
            {opCode.description}
          </p>
        )}
        {opCode.notes && (
          <p className="truncate text-xs italic text-zinc-500">
            {opCode.notes}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onEdit(opCode)}
          aria-label={`Edit ${opCode.code}`}
          className="cursor-pointer rounded p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(opCode)}
          disabled={deleting}
          aria-label={`Delete ${opCode.code}`}
          className="cursor-pointer rounded p-2 text-zinc-400 hover:bg-zinc-800 hover:text-red-300 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
