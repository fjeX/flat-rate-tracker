"use client";

import { Modal } from "@/components/ui/Modal";
import type { OpCode, SubOpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";

// Shown when a library op code with sub op codes is added to an RO —
// the user picks which procedure was actually performed.
export function SubOpCodePickerModal({
  opCode,
  onSelect,
  onClose,
}: {
  opCode: OpCode;
  onSelect: (sub: SubOpCode) => void;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={`Sub op code for ${opCode.code}`}>
      <div className="log-picks">
        <p className="log-sub">
          Select which procedure was performed on this vehicle.
        </p>
        {opCode.subOpCodes.map((sub) => (
          <button
            key={sub.id}
            type="button"
            onClick={() => onSelect(sub)}
            className="log-pick"
          >
            <span className="log-pick-txt">
              <b className="log-code">{sub.code}</b>
              {sub.description && <span className="log-pick-desc">{sub.description}</span>}
            </span>
            <span className="num">{fmtHours(sub.flagHours)}h</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
