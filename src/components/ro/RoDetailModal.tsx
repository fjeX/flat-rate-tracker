"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { formatDateLong } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import {
  addOpCodeLineToEntryAction,
  deleteEntryAction,
  deleteEntryLineAction,
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
          mileage={entry.vehicle.mileage}
        />

        <div className="rounded-md border border-zinc-800">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
            <div>Op code</div>
            <div className="w-16 text-right">Flag</div>
            <div className="w-20 text-right">Actual</div>
            <div className="w-8" aria-hidden="true" />
          </div>
          <ul>
            {entry.opCodes.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                libraryById={libraryById}
                isOnly={entry.opCodes.length === 1}
              />
            ))}
          </ul>
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
            <div className="text-zinc-400">Total</div>
            <div className="w-16 text-right font-medium">
              {fmtHours(entry.flagHours)}h
            </div>
            <div className="w-20 text-right text-zinc-400">
              {hasAnyActual ? `${fmtHours(totalActual)}h` : "—"}
            </div>
            <div className="w-8" aria-hidden="true" />
          </div>
          <AddOpCodePicker entryId={entry.id} library={library} />
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
  mileage,
}: {
  year: string;
  make: string;
  model: string;
  mileage: string;
}) {
  const label = [year, make, model].filter(Boolean).join(" ").trim();
  if (!label && !mileage) return null;
  return (
    <div className="text-sm text-zinc-300">
      {label}
      {mileage && (
        <span className="ml-2 text-xs text-zinc-500">{mileage} mi</span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------

function LineRow({
  line,
  libraryById,
  isOnly,
}: {
  line: EntryOpCode;
  libraryById: Map<string, OpCode>;
  isOnly: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState<string>(
    line.actualHours !== null ? String(line.actualHours) : "",
  );
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
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
    startSave(async () => {
      try {
        await setLineActualHoursAction(line.id, parsed);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  function handleDelete() {
    if (isOnly) {
      alert("Can't remove the last line — delete the whole RO instead.");
      return;
    }
    if (!window.confirm("Remove this line?")) return;
    startDelete(async () => {
      try {
        await deleteEntryLineAction(line.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to remove line.");
      }
    });
  }

  return (
    <li className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-zinc-800 px-3 py-2 last:border-b-0">
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
        {line.notes && (
          <div className="truncate text-xs italic text-zinc-500">{line.notes}</div>
        )}
        {error && <div className="mt-0.5 text-[10px] text-red-300">{error}</div>}
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
          disabled={saving || deleting}
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-right font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-orange-500 focus:outline-none"
        />
      </div>
      <div className="flex w-8 justify-center">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting || saving}
          aria-label="Remove line"
          className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-300 disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------------

function AddOpCodePicker({
  entryId,
  library,
}: {
  entryId: string;
  library: OpCode[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, startAdding] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = library.filter((oc) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      oc.code.toLowerCase().includes(q) ||
      oc.description.toLowerCase().includes(q)
    );
  });

  function handleSelect(oc: OpCode) {
    setError(null);
    startAdding(async () => {
      try {
        await addOpCodeLineToEntryAction(entryId, {
          id: oc.id,
          flagHours: oc.flagHours,
        });
        setOpen(false);
        setSearch("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add op code.");
      }
    });
  }

  if (!open) {
    return (
      <div className="border-t border-zinc-800 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
        >
          <Plus className="h-3.5 w-3.5" />
          Add op code
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-zinc-800 p-3">
      <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search op codes…"
          className="w-full bg-transparent py-1.5 text-sm placeholder-zinc-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setSearch("");
            setError(null);
          }}
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
          aria-label="Close picker"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <ul className="max-h-40 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="py-2 text-center text-xs text-zinc-500">
            No matches in your library.
          </li>
        ) : (
          filtered.map((oc) => (
            <li key={oc.id}>
              <button
                type="button"
                onClick={() => handleSelect(oc)}
                disabled={adding}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-800 disabled:opacity-60"
              >
                <span>
                  <span className="font-mono text-sm text-orange-400">
                    {oc.code}
                  </span>
                  {oc.description && (
                    <span className="ml-2 text-xs text-zinc-500">
                      {oc.description}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-zinc-400">
                  {oc.flagHours}h
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
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
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-900/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? "Deleting…" : "Delete RO"}
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
