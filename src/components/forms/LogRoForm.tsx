"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Search, Trash2, X } from "lucide-react";
import type { Entry, NewEntry, NewEntryOpCode, OpCode } from "@/lib/types";
import { isoDate } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { saveEntry } from "@/app/actions/entries";
import { createLibraryOpCode } from "@/app/actions/op-codes";
import {
  CustomOpCodeModal,
  NewLibraryOpCodeModal,
  type OpCodeDraft,
} from "./OpCodeModals";

type LineDraft = NewEntryOpCode & { key: string };

function linesFromEntry(entry: Entry | undefined): LineDraft[] {
  if (!entry) return [];
  return entry.opCodes.map((oc) => ({
    key: oc.id,
    opCodeId: oc.opCodeId,
    custom: oc.custom,
    customCode: oc.customCode,
    customDescription: oc.customDescription,
    flagHours: oc.flagHours,
    actualHours: oc.actualHours,
    position: oc.position,
  }));
}

export function LogRoForm({
  initialOpCodes,
  existingEntry,
}: {
  initialOpCodes: OpCode[];
  existingEntry?: Entry;
}) {
  const router = useRouter();
  const isEdit = Boolean(existingEntry);

  const [date, setDate] = useState(existingEntry?.date ?? isoDate());
  const [roNumber, setRoNumber] = useState(existingEntry?.roNumber ?? "");
  const [year, setYear] = useState(existingEntry?.vehicle.year ?? "");
  const [make, setMake] = useState(existingEntry?.vehicle.make ?? "");
  const [model, setModel] = useState(existingEntry?.vehicle.model ?? "");
  const [notes, setNotes] = useState(existingEntry?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    linesFromEntry(existingEntry),
  );
  const [library, setLibrary] = useState<OpCode[]>(initialOpCodes);

  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [newLibraryOpen, setNewLibraryOpen] = useState(false);
  const [newLibraryPending, setNewLibraryPending] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, startTransition] = useTransition();

  // Close the op-code picker when clicking anywhere outside it.
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () =>
      document.removeEventListener("mousedown", handleMouseDown);
  }, [pickerOpen]);

  const filteredLibrary = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (oc) =>
        oc.code.toLowerCase().includes(q) ||
        oc.description.toLowerCase().includes(q),
    );
  }, [search, library]);

  const totalFlag = lines.reduce((s, l) => s + (l.flagHours || 0), 0);

  // --- line manipulation ------------------------------------------------

  function addFromLibrary(oc: OpCode) {
    setLines((ls) => [
      ...ls,
      {
        key: crypto.randomUUID(),
        opCodeId: oc.id,
        custom: false,
        customCode: null,
        customDescription: null,
        flagHours: oc.flagHours,
        actualHours: null,
        position: ls.length,
      },
    ]);
    setSearch("");
    setPickerOpen(false);
  }

  function addCustomLine(draft: OpCodeDraft) {
    setLines((ls) => [
      ...ls,
      {
        key: crypto.randomUUID(),
        opCodeId: null,
        custom: true,
        customCode: draft.code,
        customDescription: draft.description,
        flagHours: draft.flagHours,
        actualHours: null,
        position: ls.length,
      },
    ]);
    setCustomOpen(false);
    setSearch("");
    setPickerOpen(false);
  }

  async function addNewLibraryLine(draft: OpCodeDraft) {
    setNewLibraryPending(true);
    try {
      const created = await createLibraryOpCode(draft);
      setLibrary((l) => [...l, created]);
      addFromLibrary(created);
      setNewLibraryOpen(false);
    } finally {
      setNewLibraryPending(false);
    }
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  function lineLabel(line: LineDraft): { code: string; description: string } {
    if (line.custom) {
      return {
        code: line.customCode ?? "",
        description: line.customDescription ?? "",
      };
    }
    const ref = library.find((oc) => oc.id === line.opCodeId);
    return {
      code: ref?.code ?? "",
      description: ref?.description ?? "",
    };
  }

  // --- submit -----------------------------------------------------------
  //
  // The outer element is a <div>, not a <form>. The op-code modals
  // render inside this tree and have their own <form> elements; a real
  // outer <form> would capture their submit events and trigger a save.
  // We trigger save via the explicit Save button's onClick instead.

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        const input: NewEntry = {
          date,
          roNumber: roNumber.trim(),
          vehicle: {
            year: year.trim(),
            make: make.trim(),
            model: model.trim(),
          },
          notes,
          opCodes: lines.map((line, i) => ({
            opCodeId: line.opCodeId,
            custom: line.custom,
            customCode: line.customCode,
            customDescription: line.customDescription,
            flagHours: line.flagHours,
            actualHours: line.actualHours,
            position: i,
          })),
        };
        await saveEntry(input, existingEntry?.id);
        router.push("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 pb-24">
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {isEdit ? `Edit RO #${existingEntry!.roNumber}` : "Log RO"}
        </h1>
        {isEdit && (
          <Link
            href="/"
            className="text-sm text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </Link>
        )}
      </div>

      {/* ---- Basics ---- */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="grid grid-cols-[auto_1fr] gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-400">
              Date
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-400">
              RO #
            </span>
            <input
              type="text"
              value={roNumber}
              onChange={(e) => setRoNumber(e.target.value)}
              required
              inputMode="text"
              placeholder="12345"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-mono placeholder-zinc-600 focus:border-orange-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-400">
              Year
            </span>
            <input
              type="text"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputMode="numeric"
              placeholder="2000"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder-zinc-600 focus:border-orange-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-400">
              Make
            </span>
            <input
              type="text"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="Toyota"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder-zinc-600 focus:border-orange-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-400">
              Model
            </span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Camry"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder-zinc-600 focus:border-orange-500 focus:outline-none"
            />
          </label>
        </div>
      </section>

      {/* ---- Op Codes ---- */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">Op codes</h2>
          <span className="text-xs text-zinc-400">
            Total:{" "}
            <span className="font-mono text-orange-400">
              {fmtHours(totalFlag)}h
            </span>
          </span>
        </div>

        {/* Picker */}
        <div className="relative" ref={pickerRef}>
          <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3">
            <Search className="h-4 w-4 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPickerOpen(true);
              }}
              onFocus={() => setPickerOpen(true)}
              placeholder="Search or add op code…"
              className="w-full bg-transparent py-2 text-sm placeholder-zinc-500 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-zinc-500 hover:text-zinc-300"
                aria-label="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {pickerOpen && (
            <div className="absolute z-30 mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 shadow-lg">
              <ul className="max-h-64 overflow-y-auto">
                {filteredLibrary.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-zinc-500">
                    No matches in your library.
                  </li>
                ) : (
                  filteredLibrary.map((oc) => (
                    <li key={oc.id}>
                      <button
                        type="button"
                        onClick={() => addFromLibrary(oc)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-800"
                      >
                        <span>
                          <span className="font-mono text-sm text-orange-400">
                            {oc.code}
                          </span>
                          <span className="ml-2 text-xs text-zinc-500">
                            {oc.description}
                          </span>
                        </span>
                        <span className="text-xs text-zinc-400">
                          {oc.flagHours}h
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <div className="border-t border-zinc-800 p-2">
                <div className="mb-1 px-1 text-xs uppercase tracking-wide text-zinc-500">
                  Other
                </div>
                <button
                  type="button"
                  onClick={() => setCustomOpen(true)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Other op code (one-time)
                </button>
                <button
                  type="button"
                  onClick={() => setNewLibraryOpen(true)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create new library op code
                </button>
              </div>
              <div className="border-t border-zinc-800 px-3 py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Lines */}
        {lines.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            No op codes added yet. Search above to get started.
          </p>
        ) : (
          <ul className="space-y-2">
            {lines.map((line) => {
              const { code, description } = lineLabel(line);
              return (
                <li
                  key={line.key}
                  className="rounded-md border border-zinc-800 bg-zinc-950 p-3"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-sm text-orange-400">
                        {code}
                      </span>
                      {line.custom && (
                        <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                          Other
                        </span>
                      )}
                      <div className="truncate text-xs text-zinc-500">
                        {description}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                        Flag hrs
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={
                          Number.isFinite(line.flagHours) ? line.flagHours : ""
                        }
                        onChange={(e) =>
                          updateLine(line.key, {
                            flagHours:
                              e.target.value === "" ? 0 : Number(e.target.value),
                          })
                        }
                        className="mt-0.5 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm focus:border-orange-500 focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                        Actual hrs
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={line.actualHours ?? ""}
                        onChange={(e) =>
                          updateLine(line.key, {
                            actualHours:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                        placeholder="—"
                        className="mt-0.5 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm focus:border-orange-500 focus:outline-none"
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- Notes ---- */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-zinc-400">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optional — parts ordered, follow-up needed, etc."
            className="mt-1 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
          />
        </label>
      </section>

      {/* ---- Error + Save ---- */}
      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="sticky bottom-4 z-10 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSubmitting}
          className="rounded-md bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-orange-500 disabled:opacity-60"
        >
          {isSubmitting
            ? "Saving…"
            : isEdit
              ? "Save Changes"
              : "Save RO"}
        </button>
      </div>

      {/* ---- Modals ---- */}
      <CustomOpCodeModal
        open={customOpen}
        initialCode={search}
        onAdd={addCustomLine}
        onClose={() => setCustomOpen(false)}
      />
      <NewLibraryOpCodeModal
        open={newLibraryOpen}
        initialCode={search}
        onSubmit={addNewLibraryLine}
        onClose={() => setNewLibraryOpen(false)}
        isPending={newLibraryPending}
      />
    </div>
  );
}
