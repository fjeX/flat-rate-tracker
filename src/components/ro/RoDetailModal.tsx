"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { formatDateLong } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import {
  deleteEntryAction,
  setLineActualHoursAction,
} from "@/app/actions/entries";

export function RoDetailModal({
  entry,
  library = [],
  onClose,
}: {
  entry: Entry;
  library?: OpCode[];
  onClose: () => void;
}) {
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const totalActual = entry.opCodes.reduce(
    (s, oc) => s + (oc.actualHours ?? 0),
    0,
  );
  const hasAnyActual = entry.opCodes.some((oc) => oc.actualHours !== null);

  return (
    <Modal open onClose={onClose} title={`RO #${entry.roNumber}`}>
      <div className="space-y-4">
        <div className="text-xs text-zinc-500">
          <div>{formatDateLong(entry.date)}</div>
          <div className="mt-0.5">
            Logged{" "}
            {new Date(entry.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </div>
        </div>

        <VehicleLine
          year={entry.vehicle.year}
          make={entry.vehicle.make}
          model={entry.vehicle.model}
        />

        <div className="rounded-md border border-zinc-800">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
            <div>Op code</div>
            <div className="w-16 text-right">Flag</div>
            <div className="w-20 text-right">Actual</div>
          </div>
          <ul>
            {entry.opCodes.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                libraryById={libraryById}
              />
            ))}
          </ul>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
            <div className="text-zinc-400">Total</div>
            <div className="w-16 text-right font-medium">
              {fmtHours(entry.flagHours)}h
            </div>
            <div className="w-20 text-right text-zinc-400">
              {hasAnyActual ? `${fmtHours(totalActual)}h` : "—"}
            </div>
          </div>
        </div>

        {entry.notes && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
              Notes
            </div>
            <p className="whitespace-pre-wrap text-sm text-zinc-200">
              {entry.notes}
            </p>
          </div>
        )}

        <Footer entryId={entry.id} onClose={onClose} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------

function VehicleLine({
  year,
  make,
  model,
}: {
  year: string;
  make: string;
  model: string;
}) {
  const label = [year, make, model].filter(Boolean).join(" ").trim();
  if (!label) return null;
  return <div className="text-sm text-zinc-300">{label}</div>;
}

// ------------------------------------------------------------------------

function LineRow({
  line,
  libraryById,
}: {
  line: EntryOpCode;
  libraryById: Map<string, OpCode>;
}) {
  const router = useRouter();
  const [text, setText] = useState<string>(
    line.actualHours !== null ? String(line.actualHours) : "",
  );
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ref = line.opCodeId ? libraryById.get(line.opCodeId) : undefined;
  const code = line.custom
    ? (line.customCode ?? "").trim() || "—"
    : (ref?.code ?? "—");
  const description = line.custom
    ? (line.customDescription ?? "").trim()
    : (ref?.description ?? "");

  function commit() {
    const trimmed = text.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError("Invalid");
      return;
    }
    if (parsed === line.actualHours) return;
    setError(null);
    startTransition(async () => {
      try {
        await setLineActualHoursAction(line.id, parsed);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  return (
    <li className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-zinc-800 px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <span className="font-mono text-sm text-orange-400">{code}</span>
        {line.custom && (
          <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
            Other
          </span>
        )}
        {description && (
          <div className="truncate text-xs text-zinc-500">{description}</div>
        )}
      </div>
      <div className="w-16 text-right font-mono text-sm">
        {fmtHours(line.flagHours)}
      </div>
      <div className="w-20">
        <input
          type="number"
          min={0}
          step={0.1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="—"
          disabled={saving}
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-right font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-orange-500 focus:outline-none"
        />
        {error && <div className="text-[10px] text-red-300">{error}</div>}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------------

function Footer({
  entryId,
  onClose,
}: {
  entryId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!window.confirm("Delete this RO? This can't be undone.")) return;
    setError(null);
    startDelete(async () => {
      try {
        await deleteEntryAction(entryId);
        onClose();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete.");
      }
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-sm text-red-300">{error}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-900/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? "Deleting…" : "Delete"}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Close
          </button>
          <Link
            href={`/log?edit=${entryId}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500"
          >
            <Pencil className="h-4 w-4" />
            Edit RO
          </Link>
        </div>
      </div>
    </div>
  );
}
