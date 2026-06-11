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
      <div className="space-y-1">
        <p className="text-xs text-zinc-500 pb-2">
          Select which procedure was performed on this vehicle.
        </p>
        {opCode.subOpCodes.map((sub) => (
          <button
            key={sub.id}
            type="button"
            onClick={() => onSelect(sub)}
            className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left hover:bg-zinc-800"
          >
            <span className="min-w-0">
              <span className="font-mono text-sm font-medium text-orange-400">
                {sub.code}
              </span>
              {sub.description && (
                <span className="ml-2 text-sm text-zinc-300">{sub.description}</span>
              )}
            </span>
            <span className="shrink-0 font-mono text-sm text-zinc-400">
              {fmtHours(sub.flagHours)}h
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
