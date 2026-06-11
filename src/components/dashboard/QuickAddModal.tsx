"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { NewEntry, OpCode, SubOpCode } from "@/lib/types";
import { isoDate } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { saveEntry } from "@/app/actions/entries";
import { createLibraryOpCode } from "@/app/actions/op-codes";
import {
  CustomOpCodeModal,
  NewLibraryOpCodeModal,
  type OpCodeDraft,
} from "@/components/forms/OpCodeModals";
import { SubOpCodePickerModal } from "@/components/forms/SubOpCodePickerModal";

type QuickLine = {
  key: string;
  opCodeId: string | null;
  custom: boolean;
  customCode: string | null;
  customDescription: string | null;
  flagHours: number;
  subOpCodeId: string | null;
};

export function QuickAddModal({
  library: initialLibrary,
  open,
  onClose,
}: {
  library: OpCode[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const [roNumber, setRoNumber] = useState("");
  const [lines, setLines] = useState<QuickLine[]>([]);
  const [library, setLibrary] = useState<OpCode[]>(initialLibrary);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [newLibraryOpen, setNewLibraryOpen] = useState(false);
  const [newLibraryPending, setNewLibraryPending] = useState(false);
  const [subPickerOc, setSubPickerOc] = useState<OpCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, startTransition] = useTransition();

  const roInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      const inSearch = pickerRef.current?.contains(e.target as Node);
      const inDropdown = dropdownRef.current?.contains(e.target as Node);
      if (!inSearch && !inDropdown) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  useEffect(() => {
    if (pickerOpen && pickerRef.current) {
      const r = pickerRef.current.getBoundingClientRect();
      setDropdownRect({ top: r.bottom + 4, left: r.left, width: r.width });
    }
  }, [pickerOpen]);

  useEffect(() => {
    if (open) {
      setRoNumber("");
      setLines([]);
      setLibrary(initialLibrary);
      setSearch("");
      setError(null);
      setPickerOpen(false);
      setCustomOpen(false);
      setNewLibraryOpen(false);
      setSubPickerOc(null);
      setTimeout(() => roInputRef.current?.focus(), 60);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filteredLibrary = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (oc) =>
        oc.code.toLowerCase().includes(q) ||
        oc.description.toLowerCase().includes(q),
    );
  }, [search, library]);

  const quickChips = useMemo(
    () => library.slice(0, 6).filter((oc) => !lines.some((l) => l.opCodeId === oc.id)),
    [library, lines],
  );

  const totalFlag = lines.reduce((s, l) => s + (l.flagHours || 0), 0);

  function buildLineFromLibrary(oc: OpCode, sub?: SubOpCode): QuickLine {
    return {
      key: crypto.randomUUID(),
      opCodeId: oc.id,
      custom: false,
      customCode: null,
      customDescription: null,
      flagHours: sub ? sub.flagHours : oc.flagHours,
      subOpCodeId: sub ? sub.id : null,
    };
  }

  function addFromLibrary(oc: OpCode) {
    setSearch("");
    setPickerOpen(false);
    if (oc.subOpCodes.length > 0) {
      // Pause and ask which sub op code was performed.
      setSubPickerOc(oc);
      return;
    }
    setLines((ls) => [...ls, buildLineFromLibrary(oc)]);
  }

  function confirmSubPick(sub: SubOpCode) {
    if (!subPickerOc) return;
    const oc = subPickerOc;
    setSubPickerOc(null);
    setLines((ls) => [...ls, buildLineFromLibrary(oc, sub)]);
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
        subOpCodeId: null,
      },
    ]);
    setCustomOpen(false);
    setSearch("");
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

  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  function updateFlagHours(key: string, val: number) {
    setLines((ls) =>
      ls.map((l) => (l.key === key ? { ...l, flagHours: val } : l)),
    );
  }

  function lineLabel(line: QuickLine): {
    code: string;
    description: string;
    subCode: string | null;
  } {
    if (line.custom) {
      return {
        code: line.customCode ?? "",
        description: line.customDescription ?? "",
        subCode: null,
      };
    }
    const ref = library.find((oc) => oc.id === line.opCodeId);
    if (line.subOpCodeId && ref) {
      const sub = ref.subOpCodes.find((s) => s.id === line.subOpCodeId);
      if (sub) {
        return { code: ref.code, description: sub.description, subCode: sub.code };
      }
    }
    return {
      code: ref?.code ?? "",
      description: ref?.description ?? "",
      subCode: null,
    };
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        const input: NewEntry = {
          date: isoDate(),
          roNumber: roNumber.trim(),
          vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
          notes: "",
          opCodes: lines.map((line, i) => ({
            opCodeId: line.opCodeId,
            custom: line.custom,
            customCode: line.customCode,
            customDescription: line.customDescription,
            flagHours: line.flagHours,
            actualHours: null,
            notes: "",
            position: i,
            subOpCodeId: line.subOpCodeId,
          })),
        };
        await saveEntry(input);
        onClose();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  // While a child modal is stacked on top, the outer modal must ignore its
  // own close triggers (Escape fires both modals' window listeners).
  const childModalOpen = customOpen || newLibraryOpen || subPickerOc !== null;

  return (
    <Modal
      open={open}
      onClose={childModalOpen ? () => {} : onClose}
      title="Quick Add RO"
    >
      <div className="space-y-4">

        {/* RO Number */}
        <div>
          <div className="mb-1.5 text-xs uppercase tracking-wide text-zinc-500">
            RO Number
          </div>
          <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 focus-within:border-orange-500">
            <span className="text-lg font-bold text-zinc-500">#</span>
            <input
              ref={roInputRef}
              type="text"
              value={roNumber}
              onChange={(e) => setRoNumber(e.target.value)}
              inputMode="numeric"
              placeholder="12345"
              autoComplete="off"
              className="flex-1 bg-transparent text-lg font-semibold text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Op Codes */}
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
            Op Codes
          </div>

          {/* Quick chips */}
          {quickChips.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {quickChips.map((oc) => (
                <button
                  key={oc.id}
                  type="button"
                  onClick={() => addFromLibrary(oc)}
                  className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs hover:border-orange-500/50 hover:bg-zinc-700"
                >
                  <span className="font-mono text-orange-400">{oc.code}</span>
                  <span className="text-zinc-500">
                    {oc.subOpCodes.length > 0 ? "→" : `${oc.flagHours}h`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Search picker */}
          <div ref={pickerRef}>
            <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 focus-within:border-orange-500/50">
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPickerOpen(true); }}
                onFocus={() => setPickerOpen(true)}
                placeholder="Search op codes…"
                className="w-full bg-transparent py-2 text-sm placeholder-zinc-500 focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setPickerOpen(false); }}
                  className="text-zinc-500 hover:text-zinc-300"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          {pickerOpen && dropdownRect && typeof document !== "undefined" && createPortal(
            <div
              ref={dropdownRef}
              style={{ position: "fixed", top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width, zIndex: 9999 }}
              className="rounded-md border border-zinc-700 bg-zinc-900 shadow-xl"
            >
              <ul className="max-h-48 overflow-y-auto">
                {filteredLibrary.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-zinc-500">
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
                        <span className="min-w-0">
                          <span className="font-mono text-sm text-orange-400">
                            {oc.code}
                          </span>
                          <span className="ml-2 text-xs text-zinc-500">
                            {oc.description}
                          </span>
                          {oc.subOpCodes.length > 0 && (
                            <span className="ml-1.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                              {oc.subOpCodes.length} sub{oc.subOpCodes.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </span>
                        <span className="flex-shrink-0 font-mono text-xs text-zinc-400">
                          {oc.subOpCodes.length > 0 ? "select →" : `${oc.flagHours}h`}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <div className="border-t border-zinc-800 p-1">
                <div className="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-zinc-600">
                  Other
                </div>
                <button
                  type="button"
                  onClick={() => { setPickerOpen(false); setCustomOpen(true); }}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Other op code (one-time)
                </button>
                <button
                  type="button"
                  onClick={() => { setPickerOpen(false); setNewLibraryOpen(true); }}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create new library op code
                </button>
              </div>
            </div>,
            document.body
          )}

          {/* Lines table */}
          {lines.length > 0 && (
            <div className="mt-3 rounded-md border border-zinc-800">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
                <div>Op code</div>
                <div className="w-16 text-right">Flag hrs</div>
                <div className="w-6" />
              </div>
              <ul>
                {lines.map((line) => {
                  const { code, description, subCode } = lineLabel(line);
                  return (
                    <li
                      key={line.key}
                      className="border-b border-zinc-800 px-3 py-2 last:border-b-0"
                    >
                      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm text-orange-400">
                              {code}
                            </span>
                            {subCode && (
                              <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-orange-400">
                                {subCode}
                              </span>
                            )}
                            {line.custom && (
                              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                                Other
                              </span>
                            )}
                          </div>
                          {description && (
                            <div className="truncate text-xs text-zinc-500">
                              {description}
                            </div>
                          )}
                        </div>
                        <div className="w-16">
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={Number.isFinite(line.flagHours) ? line.flagHours : ""}
                            onChange={(e) =>
                              updateFlagHours(
                                line.key,
                                e.target.value === "" ? 0 : Number(e.target.value),
                              )
                            }
                            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-right font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-orange-500 focus:outline-none"
                            placeholder="0"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          aria-label="Remove line"
                          className="rounded p-1 text-zinc-600 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
                <div className="text-zinc-400">Total</div>
                <div className="w-16 text-right font-mono font-medium">
                  {fmtHours(totalFlag)}h
                </div>
                <div className="w-6" />
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && <p className="text-sm text-red-300">{error}</p>}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting || !roNumber.trim()}
            className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? "Saving…" : "Save RO"}
          </button>
        </div>

      </div>

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
      {subPickerOc && (
        <SubOpCodePickerModal
          opCode={subPickerOc}
          onSelect={confirmSubPick}
          onClose={() => setSubPickerOc(null)}
        />
      )}
    </Modal>
  );
}
