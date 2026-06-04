"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useEffect, useState, useTransition } from "react";
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
  const router = useRouter();
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
          vin={entry.vehicle.vin}
          mileage={entry.vehicle.mileage}
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
                isOnly={entry.opCodes.length === 1}
                onDeleted={() => router.refresh()}
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

        {/* Quick-add op code from library */}
        <AddOpCodePicker
          entryId={entry.id}
          library={library}
          onAdded={() => router.refresh()}
        />

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

const DESC_CHAR_LIMIT = 80;

function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= DESC_CHAR_LIMIT) {
    return <div className="text-xs text-zinc-500">{text}</div>;
  }
  return (
    <div className="text-xs text-zinc-500">
      {expanded ? text : text.slice(0, DESC_CHAR_LIMIT) + "…"}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="ml-1 text-orange-400 hover:text-orange-300 focus:outline-none"
      >
        {expanded ? "less" : "more"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------

function VehicleLine({
  year,
  make,
  model,
  vin,
  mileage,
}: {
  year: string;
  make: string;
  model: string;
  vin: string;
  mileage: string;
}) {
  const label = [year, make, model].filter(Boolean).join(" ").trim();
  if (!label && !vin && !mileage) return null;
  return (
    <div className="space-y-0.5">
      {label && <div className="text-sm text-zinc-300">{label}</div>}
      {vin && (
        <div className="font-mono text-xs text-zinc-500">
          VIN: {vin}
        </div>
      )}
      {mileage && (
        <div className="text-xs text-zinc-500">
          Mileage: {mileage}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------

function LineRow({
  line,
  libraryById,
  isOnly,
  onDeleted,
}: {
  line: EntryOpCode;
  libraryById: Map<string, OpCode>;
  isOnly: boolean;
  onDeleted: () => void;
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
  const subRef = line.subOpCodeId && ref
    ? ref.subOpCodes.find((s) => s.id === line.subOpCodeId)
    : undefined;
  const description = line.custom
    ? (line.customDescription ?? "").trim()
    : subRef
      ? subRef.description
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
      alert("An RO needs at least one line.");
      return;
    }
    if (!window.confirm("Remove this line?")) return;
    setError(null);
    startDelete(async () => {
      try {
        await deleteEntryLineAction(line.id);
        onDeleted();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to remove.");
      }
    });
  }

  return (
    <li className="border-b border-zinc-800 px-3 py-2 last:border-b-0">
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
        <div className="min-w-0">
          <span className="font-mono text-sm text-orange-400">{code}</span>
          {subRef && (
            <span className="ml-2 rounded bg-orange-950/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-orange-400">
              {subRef.code}
            </span>
          )}
          {line.custom && (
            <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
              Other
            </span>
          )}
          {description && <ExpandableDescription text={description} />}
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
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting || isOnly}
          aria-label="Remove line"
          className="rounded p-1 text-zinc-600 hover:text-red-400 disabled:opacity-30"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && <div className="mt-1 text-[10px] text-red-300">{error}</div>}
      {line.notes && (
        <p className="mt-1.5 text-xs text-zinc-500 italic">{line.notes}</p>
      )}
    </li>
  );
}

// ------------------------------------------------------------------------

function AddOpCodePicker({
  entryId,
  library,
  onAdded,
}: {
  entryId: string;
  library: OpCode[];
  onAdded: () => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subPickOc, setSubPickOc] = useState<OpCode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (oc) =>
        oc.code.toLowerCase().includes(q) ||
        oc.description.toLowerCase().includes(q),
    );
  }, [search, library]);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  function addLine(oc: OpCode, subOpCodeId?: string) {
    setError(null);
    const flagHours = subOpCodeId
      ? (oc.subOpCodes.find((s) => s.id === subOpCodeId)?.flagHours ?? oc.flagHours)
      : oc.flagHours;
    startTransition(async () => {
      try {
        await addOpCodeLineToEntryAction(entryId, {
          opCodeId: oc.id,
          custom: false,
          customCode: null,
          customDescription: null,
          flagHours,
          actualHours: null,
          notes: "",
          subOpCodeId: subOpCodeId ?? null,
        });
        onAdded();
        setSearch("");
        setOpen(false);
        setSubPickOc(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add.");
      }
    });
  }

  function handleOpCodeClick(oc: OpCode) {
    if (oc.subOpCodes.length > 0) {
      setSubPickOc(oc);
    } else {
      addLine(oc);
    }
  }

  if (!library.length) return null;

  return (
    <div ref={containerRef} className="relative">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-zinc-700 py-2 text-xs text-zinc-500 hover:border-orange-500/50 hover:text-zinc-300"
        >
          <Plus className="h-3.5 w-3.5" />
          Add op code
        </button>
      ) : subPickOc ? (
        // Sub op code selection step
        <div className="rounded-md border border-zinc-700 bg-zinc-900">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <button
              type="button"
              onClick={() => setSubPickOc(null)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              ← Back
            </button>
            <span className="text-xs text-zinc-400">
              Sub op code for{" "}
              <span className="font-mono text-orange-400">{subPickOc.code}</span>
            </span>
          </div>
          <ul className="max-h-48 overflow-y-auto">
            {subPickOc.subOpCodes.map((sub) => (
              <li key={sub.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => addLine(subPickOc, sub.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-800 disabled:opacity-50"
                >
                  <span>
                    <span className="font-mono text-sm text-orange-400">{sub.code}</span>
                    {sub.description && (
                      <span className="ml-2 text-xs text-zinc-400">{sub.description}</span>
                    )}
                  </span>
                  <span className="text-xs text-zinc-400">{sub.flagHours}h</span>
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <div className="border-t border-zinc-800 px-3 py-1.5 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-zinc-700 bg-zinc-900">
          <div className="flex items-center gap-2 px-3">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search op codes…"
              className="w-full bg-transparent py-2 text-sm placeholder-zinc-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => { setOpen(false); setSearch(""); }}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="max-h-48 overflow-y-auto border-t border-zinc-800">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-zinc-500">No matches.</li>
            ) : (
              filtered.map((oc) => (
                <li key={oc.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleOpCodeClick(oc)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <span>
                      <span className="font-mono text-sm text-orange-400">{oc.code}</span>
                      <span className="ml-2 text-xs text-zinc-500">{oc.description}</span>
                    </span>
                    <span className="text-xs text-zinc-400">
                      {oc.subOpCodes.length > 0 ? "select →" : `${oc.flagHours}h`}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          {error && (
            <div className="border-t border-zinc-800 px-3 py-1.5 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>
      )}
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
