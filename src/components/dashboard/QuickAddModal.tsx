"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { COMEBACK_KINDS, COMEBACK_KIND_LABELS } from "@/lib/types";
import type { ComebackKind, NewEntry, OpCode, RoMatch, SubOpCode } from "@/lib/types";
import { hhmmInTz, isoDate } from "@/lib/periods";
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
import { FLUSH_EVENT } from "@/components/layout/RefreshFlusher";
import { notifyDataChanged } from "@/components/layout/CrossTabRefresh";
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
  isComeback: boolean;
  // Book time from before the toggle zeroed it, so un-toggling a misclick
  // restores it rather than leaving a silent 0. Form-only.
  flagBeforeComeback?: number;
};

export function QuickAddModal({
  library: initialLibrary,
  open,
  onClose,
  trackRoTime = false,
  timeZone = "",
}: {
  library: OpCode[];
  open: boolean;
  onClose: () => void;
  /** The user's "time of day on each RO" setting. Off = no field, no value. */
  trackRoTime?: boolean;
  /** IANA zone from the frt_timezone cookie; "" falls back to this device's. */
  timeZone?: string;
}) {
  const router = useRouter();

  // Second mode: log a spiff/bonus without leaving the quick-add flow. Spiffs
  // get logged in the moment or never, so the fast path is one tab away.
  const [mode, setMode] = useState<QuickAddMode>("ro");
  const [roNumber, setRoNumber] = useState("");
  // Read fresh on every open, not once on the dashboard's render: TodayCard
  // changes this component's `key` when the modal opens, so React throws the old
  // instance away and this initialiser runs again. That matters here more than
  // on /log — the dashboard is the page a tech leaves open all day, and a time
  // captured at page load would be hours stale by the time they used it.
  //
  // Safe against hydration for the same reason: Modal renders null while closed,
  // so this value reaches the DOM only in an instance created by a click.
  const [loggedTime, setLoggedTime] = useState(() => hhmmInTz(timeZone));
  const [lines, setLines] = useState<QuickLine[]>([]);
  const [library, setLibrary] = useState<OpCode[]>(initialLibrary);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [newLibraryOpen, setNewLibraryOpen] = useState(false);
  const [newLibraryPending, setNewLibraryPending] = useState(false);
  const [subPickerOc, setSubPickerOc] = useState<OpCode | null>(null);
  // Quick-add carries the comeback KIND but not the "redo of" RO picker —
  // that lookup is a deliberate, slower act and belongs in the full log form.
  // The kind is one tap and can't be inferred, so it stays.
  const [comebackKind, setComebackKind] = useState<ComebackKind | null>(null);
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

  // Focus only. This used to also reset eleven pieces of state by hand on every
  // open, which is React's documented anti-pattern for "reset state when a prop
  // changes" — each setState is a fresh render, and any field added later has to
  // remember to join the list or it silently leaks between openings. TodayCard
  // now passes a `key` that changes each time the modal opens, so React discards
  // the instance and every useState initialiser runs again. Adding state here no
  // longer requires touching anything.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => roInputRef.current?.focus(), 60);
    return () => clearTimeout(id);
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
      isComeback: false,
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
        isComeback: false,
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

  // Marking a line zeroes its flag hours in the same update. buildLineFromLibrary
  // above auto-fills the library's book time the moment a code is picked — that
  // auto-fill is precisely how logging a comeback the natural way ends up
  // claiming PAID hours for FREE work. Zeroing here closes it at the source.
  function toggleLineComeback(key: string, on: boolean) {
    setLines((ls) =>
      ls.map((l) =>
        l.key === key
          ? {
              ...l,
              isComeback: on,
              flagHours: on ? 0 : (l.flagBeforeComeback ?? l.flagHours),
              flagBeforeComeback: on ? l.flagHours : undefined,
            }
          : l,
      ),
    );
    if (on) {
      if (comebackKind === null) setComebackKind("comeback_own");
      return;
    }
    const remaining = lines.filter((l) => l.key !== key && l.isComeback);
    if (remaining.length === 0) setComebackKind(null);
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
        // Absent, not null, when the setting is off — see NewEntry.loggedTime.
        ...(trackRoTime
          ? { loggedTime: loggedTime.trim() === "" ? null : loggedTime }
          : {}),
        roNumber: roNumber.trim(),
        vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
        notes: "",
        // Only meaningful when a line is actually marked — otherwise a normal
        // RO would get labelled a comeback after a toggle-on-then-off.
        comebackKind: lines.some((l) => l.isComeback) ? comebackKind : null,
        opCodes: lines.map((line, i) => ({
          opCodeId: line.opCodeId,
          custom: line.custom,
          customCode: line.customCode,
          customDescription: line.customDescription,
          flagHours: line.isComeback ? 0 : line.flagHours,
          actualHours: null,
          notes: "",
          position: i,
          subOpCodeId: line.subOpCodeId,
          laborType: null, // quick-add is a fast path; type on the line stays untyped
          isComeback: line.isComeback,
        })),
      };
      await saveEntry(input);
      tap();
      onClose();
      router.refresh();
      // The refreshed tree can arrive correct and never get painted (bug
      // c655c010) — nudge React into committing it. See RefreshFlusher.
      window.dispatchEvent(new Event(FLUSH_EVENT));
      // Same again in the other open tabs, which got neither the refresh nor
      // the flush — this is the write the cross-tab-stale report was filed on.
      notifyDataChanged();
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
            {/* Shown rather than captured silently. Quick Add drops the vehicle,
                the notes and the labor type to stay fast — but those are fields
                the tech chose to skip, and a timestamp written invisibly is data
                they never agreed to. One glance, one tap to correct. */}
            {trackRoTime && (
              <>
                <label htmlFor="quick-add-time" className="sr-only">
                  Time
                </label>
                <input
                  id="quick-add-time"
                  type="time"
                  value={loggedTime}
                  onChange={(e) => setLoggedTime(e.target.value)}
                  className="focus-ring rounded-full bg-transparent px-1 text-xs text-[var(--fg-3)] focus:outline-none"
                />
              </>
            )}
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
                          <button
                            type="button"
                            onClick={() =>
                              toggleLineComeback(line.key, !line.isComeback)
                            }
                            aria-pressed={line.isComeback}
                            className="opc-comeback-toggle"
                            data-on={line.isComeback ? "true" : undefined}
                          >
                            <RotateCcw size={11} aria-hidden="true" />
                            {line.isComeback ? "Comeback — unpaid" : "Mark as comeback"}
                          </button>
                        </div>
                        <div className="w-16">
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={
                              line.isComeback
                                ? 0
                                : Number.isFinite(line.flagHours)
                                  ? line.flagHours
                                  : ""
                            }
                            onChange={(e) =>
                              updateFlagHours(
                                line.key,
                                e.target.value === "" ? 0 : Number(e.target.value),
                              )
                            }
                            // Locked, not merely zeroed — see OpCodeLines.
                            disabled={line.isComeback}
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

          {/* Kind selector — appears only once a line is marked. No "redo of"
              RO lookup here: that's a deliberate search, and quick-add exists to
              be fast. It can be added later from the full log form. */}
          {lines.some((l) => l.isComeback) && (
            <fieldset className="mt-3 border-0 p-0">
              <legend className="mb-1.5 text-xs text-[var(--fg-3)]">
                Whose work came back?
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {COMEBACK_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setComebackKind(kind)}
                    aria-pressed={comebackKind === kind}
                    className="opc-comeback-toggle"
                    data-on={comebackKind === kind ? "true" : undefined}
                  >
                    {COMEBACK_KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
            </fieldset>
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
