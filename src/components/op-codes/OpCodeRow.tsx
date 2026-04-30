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
      {...(!isSearching ? { ...attributes, ...listeners } : {})}
      className={`flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-2 py-2 last:border-b-0${!isSearching ? " cursor-grab active:cursor-grabbing" : ""}`}
    >
      {isSearching ? (
        <div className="h-8 w-8 shrink-0" aria-hidden="true" />
      ) : (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center text-zinc-500"
          aria-hidden="true"
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

      <div className="flex shrink-0 items-center gap-1">
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
