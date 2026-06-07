"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { NewEntry, OpCode } from "@/lib/types";
import { isoDate } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { saveEntry } from "@/app/actions/entries";

type QuickLine = {
  key: string;
  opCodeId: string | null;
  custom: boolean;
  customCode: string | null;
  customDescription: string | null;
  flagHours: number;
};

export function QuickAddModal({
  library,
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
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
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
      setSearch("");
      setError(null);
      setPickerOpen(false);
      setTimeout(() => roInputRef.current?.focus(), 60);
    }
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
      },
    ]);
    setSearch("");
    setPickerOpen(false);
  }

  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  function updateFlagHours(key: string, val: number) {
    setLines((ls) =>
      ls.map((l) => (l.key === key ? { ...l, flagHours: val } : l)),
    );
  }

  function lineLabel(line: QuickLine) {
    if (line.custom) {
      return { code: line.customCode ?? "", description: line.customDescription ?? "" };
    }
    const ref = library.find((oc) => oc.id === line.opCodeId);
    return { code: ref?.code ?? "", description: ref?.description ?? "" };
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
            subOpCodeId: null,
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

  return (
    <Modal open={open} onClose={onClose} title="Quick Add RO">
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
                  <span className="text-zinc-500">{oc.flagHours}h</span>
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
                  const { code, description } = lineLabel(line);
                  return (
                    <li
                      key={line.key}
                      className="border-b border-zinc-800 px-3 py-2 last:border-b-0"
                    >
                      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                        <div className="min-w-0">
                          <span className="font-mono text-sm text-orange-400">
                            {code}
                          </span>
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
    </Modal>
  );
}
