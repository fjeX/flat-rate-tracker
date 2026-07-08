"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useGuestStore } from "@/lib/guest/context";
import { formatDateLong } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";

export function GuestRoDetailModal({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  const { opCodes, deleteGuestEntry, hourlyRate } = useGuestStore();
  const opCodesById = new Map(opCodes.map((oc) => [oc.id, oc]));
  const showMoney = hourlyRate !== null && hourlyRate > 0;
  const roEarnings = showMoney ? entry.flagHours * hourlyRate : 0;

  function handleDelete() {
    if (!window.confirm("Delete this RO? This can't be undone.")) return;
    deleteGuestEntry(entry.id);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`RO #${entry.roNumber}`}>
      <div className="space-y-4">
        {/* Date section */}
        <div className="text-xs text-[var(--fg-3)]">
          <div>{formatDateLong(entry.date)}</div>
          <div className="mt-0.5">
            Logged{" "}
            {new Date(entry.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </div>
        </div>

        {/* Vehicle section */}
        {(entry.vehicle.year || entry.vehicle.make || entry.vehicle.model || entry.vehicle.vin || entry.vehicle.mileage) && (
          <div className="space-y-0.5">
            {[entry.vehicle.year, entry.vehicle.make, entry.vehicle.model].filter(Boolean).join(" ") && (
              <div className="text-sm text-[var(--fg-1)]">
                {[entry.vehicle.year, entry.vehicle.make, entry.vehicle.model].filter(Boolean).join(" ")}
              </div>
            )}
            {entry.vehicle.vin && <div className="font-mono text-xs text-[var(--fg-3)]">VIN: {entry.vehicle.vin}</div>}
            {entry.vehicle.mileage && <div className="text-xs text-[var(--fg-3)]">Mileage: {entry.vehicle.mileage}</div>}
          </div>
        )}

        {/* Op code lines table */}
        <div className="rounded-md border border-[var(--line)]">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-[var(--line)] bg-[var(--bg-1)] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--fg-3)]">
            <div>Op code</div>
            <div className="w-16 text-right">Flag</div>
            <div className="w-20 text-right">Actual</div>
          </div>
          <ul>
            {entry.opCodes.map((line) => (
              <GuestLineRow key={line.id} line={line} entryId={entry.id} opCodesMap={opCodesById} />
            ))}
          </ul>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-sm">
            <div className="text-[var(--fg-2)]">Total</div>
            <div className="w-16 text-right font-medium">{fmtHours(entry.flagHours)}h</div>
            <div className="w-20 text-right text-[var(--fg-2)]">
              {entry.opCodes.some((l) => l.actualHours !== null)
                ? `${fmtHours(entry.opCodes.reduce((s, l) => s + (l.actualHours ?? 0), 0))}h`
                : "—"}
            </div>
          </div>
          {showMoney && (
            <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-sm">
              <span className="text-[var(--fg-2)]">Earnings</span>
              <span className="font-medium text-[var(--good)]">{fmtMoney(roEarnings)}</span>
            </div>
          )}
        </div>

        {/* Notes section */}
        {entry.notes && (
          <div className="rounded-md border border-[var(--line)] bg-[var(--bg-1)] p-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-[var(--fg-3)]">Notes</div>
            <p className="whitespace-pre-wrap text-sm text-[var(--fg-1)]">{entry.notes}</p>
          </div>
        )}

        {/* Footer with Delete + Close */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--bad)]/40 px-3 py-2 text-sm text-[var(--bad)] hover:bg-[var(--bad-bg)]"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--line)] px-3 py-2 text-sm text-[var(--fg-1)] hover:bg-[var(--bg-3)]"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------

function GuestLineRow({
  line,
  entryId,
  opCodesMap,
}: {
  line: EntryOpCode;
  entryId: string;
  opCodesMap: Map<string, OpCode>;
}) {
  const { updateEntryHours } = useGuestStore();

  const ref = line.opCodeId ? opCodesMap.get(line.opCodeId) : undefined;
  const code = line.custom
    ? line.customCode?.trim() || "—"
    : ref?.code ?? "—";
  const description = line.custom
    ? line.customDescription?.trim() ?? ""
    : ref?.description ?? "";

  const [text, setText] = useState<string>(
    line.actualHours !== null ? String(line.actualHours) : "",
  );

  function commit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    updateEntryHours(entryId, line.id, parsed);
  }

  return (
    <li className="border-b border-[var(--line)] px-3 py-2 last:border-b-0">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
        <div className="min-w-0">
          <span className="font-mono text-sm text-[var(--brand)]">{code}</span>
          {line.custom && (
            <span className="ml-2 rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--fg-2)]">Other</span>
          )}
          {description && <div className="text-xs text-[var(--fg-3)]">{description}</div>}
        </div>
        <div className="w-16 text-right font-mono text-sm">{fmtHours(line.flagHours)}</div>
        <div className="w-20">
          <input
            type="number"
            min={0}
            step={0.1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder="—"
            aria-label={`Actual hours for ${code}`}
            className="w-full rounded border border-[var(--line)] bg-[var(--bg-1)] px-2 py-1 text-right font-mono text-sm text-[var(--fg-0)] placeholder-[var(--fg-3)] focus:border-[var(--brand)] focus:outline-none"
          />
        </div>
      </div>
    </li>
  );
}
