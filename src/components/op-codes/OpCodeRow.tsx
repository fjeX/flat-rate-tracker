"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import type { OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { Badge } from "@/components/ui/Badge";
import { withPt } from "@/components/ui/Figure";
import { tagHueVar } from "./tagHue";
import type { OpCodeLabelMode } from "./useOpCodeLabelMode";

/**
 * The cells of one library row (phase 5 sketch): code with its category tick,
 * description · notes, flag hours, then edit / delete. Shared by the
 * signed-in row (which wraps it in a sortable `<li>`) and the guest mirror
 * (a plain `<li>`), so the two can't drift.
 */
export function OpCodeRowContent({
  opCode,
  tagColors,
  onEdit,
  onDelete,
  deleting,
  labelMode,
}: {
  opCode: OpCode;
  tagColors?: Record<string, number>;
  labelMode: OpCodeLabelMode;
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
}) {
  // Description-first swaps which field is the big label. An op code with no
  // description falls back to its code so the row never has a blank lead.
  const descFirst = labelMode === "description" && opCode.description !== "";
  const primary = descFirst ? opCode.description : opCode.code;
  const secondary = descFirst ? opCode.code : opCode.description;

  return (
    <>
      {/* the column layout follows the mode, not the row, so a code with no
          description still lines up with its neighbours */}
      <div className={`opl-main${labelMode === "description" ? " is-desc-first" : ""}`}>
        <div
          className="opl-code"
          title={opCode.tags.length > 0 ? opCode.tags.join(", ") : undefined}
        >
          <span
            className="opl-tick"
            style={{ "--tagc": tagHueVar(opCode.tags[0], tagColors) } as React.CSSProperties}
            aria-hidden="true"
          />
          <b>{primary}</b>
        </div>
        <div className="opl-desc">
          <span>
            {secondary}
            {opCode.notes && (
              <i>
                {secondary ? " · " : ""}
                {opCode.notes}
              </i>
            )}
          </span>
          {opCode.subOpCodes.length > 0 && (
            <Badge tone="neutral">
              {opCode.subOpCodes.length} sub{opCode.subOpCodes.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>

      <span className="opl-hours num">
        {withPt(fmtHours(opCode.flagHours))}
        <span className="unit">h</span>
      </span>

      <div className="opl-acts" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${opCode.code}`}
          className="iconbtn"
        >
          <Pencil size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          aria-label={`Delete ${opCode.code}`}
          className="iconbtn is-del"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

export function OpCodeRow({
  opCode,
  tagColors,
  reorderable,
  onEdit,
  onDelete,
  deleting,
  labelMode,
}: {
  opCode: OpCode;
  labelMode: OpCodeLabelMode;
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
      className={`opl-row${isDragging ? " is-dragging" : ""}`}
    >
      {reorderable ? (
        <div
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="opl-grip"
          aria-label="Drag to reorder"
        >
          <GripVertical size={16} aria-hidden="true" />
        </div>
      ) : (
        <div
          className="opl-grip is-off"
          title="Reordering is available in My order with no search or tag filters"
          aria-hidden="true"
        >
          <GripVertical size={16} />
        </div>
      )}
      <OpCodeRowContent
        opCode={opCode}
        tagColors={tagColors}
        onEdit={() => onEdit(opCode)}
        onDelete={() => onDelete(opCode)}
        deleting={deleting}
        labelMode={labelMode}
      />
    </li>
  );
}
