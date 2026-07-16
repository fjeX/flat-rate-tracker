"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import type { OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { tagHueVar } from "./tagHue";

export function OpCodeRow({
  opCode,
  tagColors,
  reorderable,
  onEdit,
  onDelete,
  deleting,
}: {
  opCode: OpCode;
  /** Per-tag colour overrides (settings.tagColors). */
  tagColors?: Record<string, number>;
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
      className="opl-grid opl-row"
    >
      {reorderable ? (
        <div
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--fg-3)] cursor-grab active:cursor-grabbing hover:text-[var(--fg-1)]"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      ) : (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--fg-3)] opacity-20"
          title="Reordering is available in My order with no search or tag filters"
          aria-hidden="true"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}

      <div className="opl-main">
        {/* Code + category tick (hue = first tag) */}
        <div
          className="opl-codecell"
          title={opCode.tags.length > 0 ? opCode.tags.join(", ") : undefined}
        >
          <span
            className="opl-tick"
            style={
              { "--tagc": tagHueVar(opCode.tags[0], tagColors) } as React.CSSProperties
            }
          />
          <span className="truncate font-mono text-sm font-semibold text-[var(--fg-0)]">
            {opCode.code}
          </span>
        </div>

        {/* Description · notes, one truncated line, sub count pinned */}
        <div className="opl-desc">
          <span className="truncate text-xs">
            {opCode.description && (
              <span className="text-[var(--fg-1)]">{opCode.description}</span>
            )}
            {opCode.notes && (
              <span className="italic text-[var(--fg-3)]">
                {opCode.description ? " · " : ""}
                {opCode.notes}
              </span>
            )}
          </span>
          {opCode.subOpCodes.length > 0 && (
            <span className="badge badge-neutral shrink-0">
              {opCode.subOpCodes.length} sub
              {opCode.subOpCodes.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      <span className="opl-hours font-mono text-sm font-semibold tabular text-[var(--brand)]">
        {fmtHours(opCode.flagHours)}
      </span>

      <div
        className="opl-acts flex shrink-0 items-center justify-end gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onEdit(opCode)}
          aria-label={`Edit ${opCode.code}`}
          className="relative cursor-pointer rounded-full p-2 text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--fg-0)] after:absolute after:-inset-1.5 after:content-['']"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(opCode)}
          disabled={deleting}
          aria-label={`Delete ${opCode.code}`}
          className="relative cursor-pointer rounded-full p-2 text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--bad)] disabled:opacity-50 after:absolute after:-inset-1.5 after:content-['']"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
