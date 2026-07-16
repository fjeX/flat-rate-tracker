"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import type { NewEntry, OpCode, RoMatch, SubOpCode } from "@/lib/types";
import { isoDate } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { findDuplicateRos, saveEntry } from "@/app/actions/entries";
import { DuplicateRoDialog } from "@/components/forms/DuplicateRoDialog";
import { createLibraryOpCode } from "@/app/actions/op-codes";
import {
  CustomOpCodeModal,
  NewLibraryOpCodeModal,
  type OpCodeDraft,
} from "@/components/forms/OpCodeModals";
import { SubOpCodePickerModal } from "@/components/forms/SubOpCodePickerModal";
import { BonusForm } from "@/components/bonuses/BonusForm";
import { tap } from "@/lib/haptics";

type QuickAddMode = "ro" | "spiff";

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

  // Second mode: log a spiff/bonus without leaving the quick-add flow. Spiffs
  // get logged in the moment or never, so the fast path is one tab away.
  const [mode, setMode] = useState<QuickAddMode>("ro");
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
  // Same warn-but-allow duplicate flow as the full log form.
  const [dupMatches, setDupMatches] = useState<RoMatch[] | null>(null);

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
      setMode("ro");
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
    const ro = roNumber.trim();
    if (!ro) {
      performSave();
      return; // server surfaces the empty-RO# error
    }
    startTransition(async () => {
      // Warn-but-allow: a failed check never blocks saving.
      const matches = await findDuplicateRos(ro).catch(() => []);
      if (matches.length > 0) setDupMatches(matches);
      else await performSaveInner();
    });
  }

  function performSave() {
    startTransition(performSaveInner);
  }

  async function performSaveInner() {
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
          laborType: null, // quick-add is a fast path; type on the line stays untyped
        })),
      };
      await saveEntry(input);
      tap();
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  // While a child modal is stacked on top, the outer modal must ignore its
  // own close triggers (Escape fires both modals' window listeners).
  const childModalOpen =
    customOpen || newLibraryOpen || subPickerOc !== null || dupMatches !== null;

  return (
    <Modal
      open={open}
      onClose={childModalOpen ? () => {} : onClose}
      title="Quick Add"
    >
      {/* Mode tabs — RO vs. Spiff/Bonus */}
      <div className="mb-4 grid grid-cols-2 gap-1 card-inset p-1" role="tablist" aria-label="Quick add mode">
        {(["ro", "spiff"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-3 text-sm font-medium ${
              mode === m
                ? "bg-[var(--bg-3)] text-[var(--fg-0)] shadow-[inset_0_0_0_1px_var(--bg-4)]"
                : "text-[var(--fg-2)] hover:text-[var(--fg-1)]"
            }`}
          >
            {m === "ro" ? "RO" : "Spiff"}
          </button>
        ))}
      </div>

      {mode === "spiff" ? (
        <BonusForm onSaved={onClose} onCancel={onClose} />
      ) : (
      <div className="space-y-4">

        {/* RO Number */}
        <div>
          <label htmlFor="quick-add-ro-number" className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--fg-3)]">
            RO Number
          </label>
          <div className="flex items-center gap-2 card-inset px-3 py-2 focus-within:border-[var(--brand)] focus-within:shadow-[var(--ring)]">
            <span className="text-base font-bold text-[var(--fg-3)]" aria-hidden="true">#</span>
            <input
              id="quick-add-ro-number"
              ref={roInputRef}
              type="text"
              value={roNumber}
              onChange={(e) => setRoNumber(e.target.value)}
              inputMode="numeric"
              placeholder="12345"
              autoComplete="off"
              required
              aria-required="true"
              aria-describedby={error ? "quick-add-error" : undefined}
              className="mono flex-1 bg-transparent text-base font-semibold tabular-nums text-[var(--fg-0)] placeholder-[var(--fg-3)] focus:outline-none"
            />
          </div>
        </div>

        {/* Op Codes */}
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-[var(--fg-3)]">
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
                  className="flex min-h-[38px] items-center gap-1.5 rounded-full bg-[var(--bg-3)] px-3 py-1 text-xs hover:bg-[var(--bg-4)]"
                >
                  <span className="font-mono text-[var(--brand)]">{oc.code}</span>
                  <span className="text-[var(--fg-3)]">
                    {oc.subOpCodes.length > 0 ? "→" : `${oc.flagHours}h`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Search picker */}
          <div ref={pickerRef}>
            <div className="flex items-center gap-2 card-inset px-3 focus-within:border-[var(--brand-soft)] focus-within:shadow-[var(--ring)]">
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-[var(--fg-3)]" />
              <label htmlFor="quick-add-search" className="sr-only">Search op codes</label>
              <input
                id="quick-add-search"
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPickerOpen(true); }}
                onFocus={() => setPickerOpen(true)}
                placeholder="Search op codes…"
                className="min-h-[44px] w-full bg-transparent text-sm placeholder-[var(--fg-3)] focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setPickerOpen(false); }}
                  className="relative text-[var(--fg-3)] hover:text-[var(--fg-1)] after:absolute after:-inset-2 after:content-['']"
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
              className="card-inset shadow-[var(--shadow-pop)]"
            >
              <ul className="max-h-48 overflow-y-auto">
                {filteredLibrary.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-[var(--fg-3)]">
                    No matches in your library.
                  </li>
                ) : (
                  filteredLibrary.map((oc) => (
                    <li key={oc.id}>
                      <button
                        type="button"
                        onClick={() => addFromLibrary(oc)}
                        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--bg-3)]"
                      >
                        <span className="min-w-0">
                          <span className="font-mono text-sm text-[var(--brand)]">
                            {oc.code}
                          </span>
                          <span className="ml-2 text-xs text-[var(--fg-3)]">
                            {oc.description}
                          </span>
                          {oc.subOpCodes.length > 0 && (
                            <Badge className="ml-1.5">
                              {oc.subOpCodes.length} sub{oc.subOpCodes.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                        </span>
                        <span className="flex-shrink-0 font-mono text-xs text-[var(--fg-2)]">
                          {oc.subOpCodes.length > 0 ? "select →" : `${oc.flagHours}h`}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <div className="border-t border-[var(--line)] p-1">
                <div className="px-2 pb-0.5 pt-1 text-xs text-[var(--fg-3)]">
                  Other
                </div>
                <button
                  type="button"
                  onClick={() => { setPickerOpen(false); setCustomOpen(true); }}
                  className="flex min-h-[44px] w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-2 text-left text-sm text-[var(--fg-1)] hover:bg-[var(--bg-3)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Other op code (one-time)
                </button>
                <button
                  type="button"
                  onClick={() => { setPickerOpen(false); setNewLibraryOpen(true); }}
                  className="flex min-h-[44px] w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-2 text-left text-sm text-[var(--fg-1)] hover:bg-[var(--bg-3)]"
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
            <div className="mt-3 card-inset overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-[var(--line)] px-3 py-2 text-xs text-[var(--fg-3)]">
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
                      className="border-b border-[var(--line)] px-3 py-2 last:border-b-0"
                    >
                      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm text-[var(--brand)]">
                              {code}
                            </span>
                            {subCode && (
                              <Badge tone="brand" mono>
                                {subCode}
                              </Badge>
                            )}
                            {line.custom && (
                              <Badge>
                                Other
                              </Badge>
                            )}
                          </div>
                          {description && (
                            <div className="truncate text-xs text-[var(--fg-3)]">
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
                            aria-label={`Flag hours for ${code || "op code line"}`}
                            className="opc-hours-input on-inset w-full"
                            placeholder="0"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          aria-label="Remove line"
                          className="relative rounded-full p-1 text-[var(--fg-3)] transition-transform hover:text-[var(--bad)] active:scale-[0.96] after:absolute after:-inset-2 after:content-['']"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-sm">
                <div className="text-[var(--fg-2)]">Total</div>
                <div className="w-16 text-right font-mono font-medium">
                  {fmtHours(totalFlag)}h
                </div>
                <div className="w-6" />
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && <p id="quick-add-error" role="alert" className="text-sm text-[var(--bad)]">{error}</p>}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting || !roNumber.trim()}
            className="btn btn-primary"
          >
            {isSubmitting ? "Saving…" : "Save RO"}
          </button>
        </div>

      </div>
      )}

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
      {dupMatches && (
        <DuplicateRoDialog
          roNumber={roNumber.trim()}
          matches={dupMatches}
          onEdit={(id) => {
            setDupMatches(null);
            onClose();
            router.push(`/log?edit=${id}`);
          }}
          onLogNew={() => {
            setDupMatches(null);
            performSave();
          }}
          onClose={() => setDupMatches(null)}
        />
      )}
    </Modal>
  );
}
