"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, ChevronDown, ChevronUp, Plus, Search, Trash2, X } from "lucide-react";
import type { Entry, NewEntry, NewEntryOpCode, OpCode, RoTemplate } from "@/lib/types";
import { isoDate } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { saveEntry } from "@/app/actions/entries";
import { createLibraryOpCode } from "@/app/actions/op-codes";
import {
  CustomOpCodeModal,
  NewLibraryOpCodeModal,
  type OpCodeDraft,
} from "./OpCodeModals";
import { ScanRoButton } from "./ScanRoButton";
import type { OcrResult } from "@/lib/ocr";

const COMMON_MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler",
  "Dodge", "Ford", "GMC", "Honda", "Hyundai", "Infiniti", "Jeep", "Kia",
  "Land Rover", "Lexus", "Lincoln", "Lucid", "Mazda", "Mercedes-Benz",
  "Mitsubishi", "Nissan", "Porsche", "RAM", "Rivian", "Subaru", "Tesla",
  "Toyota", "Volkswagen", "Volvo",
];

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
    notes: oc.notes,
    position: oc.position,
  }));
}

export function LogRoForm({
  initialOpCodes,
  existingEntry,
  roTemplates,
  onSave,
  onCreateOpCode,
  redirectTo = "/",
}: {
  initialOpCodes: OpCode[];
  existingEntry?: Entry;
  roTemplates?: RoTemplate[];
  onSave?: (input: NewEntry) => void | Promise<void>;
  onCreateOpCode?: (draft: OpCodeDraft) => OpCode;
  redirectTo?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(existingEntry);

  const [date, setDate] = useState(existingEntry?.date ?? isoDate());
  const [roNumber, setRoNumber] = useState(existingEntry?.roNumber ?? "");
  const [year, setYear] = useState(existingEntry?.vehicle.year ?? "");
  const [make, setMake] = useState(existingEntry?.vehicle.make ?? "");
  const [model, setModel] = useState(existingEntry?.vehicle.model ?? "");
  const [vin, setVin] = useState(existingEntry?.vehicle.vin ?? "");
  const [mileage, setMileage] = useState(existingEntry?.vehicle.mileage ?? "");
  const [autoFill, setAutoFill] = useState(false);
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

  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [savedRoNumber, setSavedRoNumber] = useState<string | null>(null);
  const [isSubmitting, startTransition] = useTransition();

  const roInputRef = useRef<HTMLInputElement>(null);

  // On new-RO load, restore autofill make from localStorage if the user saved one.
  useEffect(() => {
    if (isEdit) return;
    const saved = localStorage.getItem("frt_default_make");
    if (saved) {
      setAutoFill(true);
      setMake((m) => m || saved);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMakeChange(value: string) {
    setMake(value);
    if (autoFill) localStorage.setItem("frt_default_make", value);
  }

  function handleAutoFillToggle(checked: boolean) {
    setAutoFill(checked);
    if (checked) {
      localStorage.setItem("frt_default_make", make);
    } else {
      localStorage.removeItem("frt_default_make");
    }
  }

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

  // Quick-add chips: first 6 library codes not already in lines
  const quickChips = useMemo(
    () =>
      library
        .slice(0, 6)
        .filter((oc) => !lines.some((l) => l.opCodeId === oc.id)),
    [library, lines],
  );

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
        notes: "",
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
        notes: "",
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
      const created = onCreateOpCode
        ? onCreateOpCode(draft)
        : await createLibraryOpCode(draft);
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

  // --- OCR scan result --------------------------------------------------

  function handleScanResult(result: OcrResult) {
    if (result.roNumber) setRoNumber(result.roNumber);
    if (result.year) setYear(result.year);
    if (result.make) setMake(result.make);
    if (result.model) setModel(result.model);
    if (result.vin) setVin(result.vin);
    // If the scan missed the RO#, drop focus there so the tech can type it fast.
    if (!result.roNumber) setTimeout(() => roInputRef.current?.focus(), 50);
    if (result.opCodeIds.length > 0) {
      const newLines: LineDraft[] = result.opCodeIds.flatMap((id) => {
        if (lines.some((l) => l.opCodeId === id)) return [];
        const oc = library.find((o) => o.id === id);
        if (!oc) return [];
        return [{
          key: crypto.randomUUID(),
          opCodeId: oc.id,
          custom: false,
          customCode: null,
          customDescription: null,
          flagHours: oc.flagHours,
          actualHours: null,
          notes: "",
          position: lines.length,
        }];
      });
      if (newLines.length > 0) setLines((ls) => [...ls, ...newLines]);
    }
  }

  // --- submit -----------------------------------------------------------
  //
  // The outer element is a <div>, not a <form>. The op-code modals
  // render inside this tree and have their own <form> elements; a real
  // outer <form> would capture their submit events and trigger a save.
  // We trigger save via the explicit Save button's onClick instead.

  function resetForm() {
    setDate(isoDate());
    setRoNumber("");
    setYear("");
    if (!autoFill) setMake("");
    setModel("");
    setVin("");
    setMileage("");
    setNotes("");
    setLines([]);
    setError(null);
    setVehicleOpen(false);
    setNotesOpen(false);
    setTimeout(() => roInputRef.current?.focus(), 50);
  }

  function handleSave(afterSave?: () => void) {
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
            vin: vin.trim().toUpperCase(),
            mileage: mileage.trim(),
          },
          notes,
          opCodes: lines.map((line, i) => ({
            opCodeId: line.opCodeId,
            custom: line.custom,
            customCode: line.customCode,
            customDescription: line.customDescription,
            flagHours: line.flagHours,
            actualHours: line.actualHours,
            notes: line.notes,
            position: i,
          })),
        };
        if (onSave) {
          await onSave(input);
        } else {
          await saveEntry(input, existingEntry?.id);
        }
        if (afterSave) {
          afterSave();
        } else {
          router.push(redirectTo);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  function handleSaveAndNew() {
    const savedRo = roNumber.trim();
    handleSave(() => {
      setSavedRoNumber(savedRo);
      resetForm();
      setTimeout(() => setSavedRoNumber(null), 3500);
    });
  }

  // Derived display values for save bar summary
  const vehicleSummary = [year, make, model].filter(Boolean).join(" ");

  return (
    <div className="mx-auto max-w-xl p-4 pb-32">

      {/* ---- Save & New confirmation ---- */}
      {savedRoNumber && (
        <div style={{
          borderRadius: 8,
          border: "1px solid color-mix(in oklab, var(--good) 40%, transparent)",
          background: "color-mix(in oklab, var(--good) 10%, transparent)",
          padding: "8px 12px",
          fontSize: 13,
          color: "var(--good)",
          marginBottom: 12,
        }}>
          RO #{savedRoNumber} saved ✓
        </div>
      )}

      {/* ---- Section title ---- */}
      <div className="section-title" style={{ marginBottom: 16 }}>
        <span>{isEdit ? `Edit RO #${existingEntry!.roNumber}` : "New repair order"}</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: 11,
            color: "var(--fg-3)",
            letterSpacing: "0.04em",
            cursor: "pointer",
          }}
        />
      </div>

      {/* ---- Scan banner (new RO only) ---- */}
      {!isEdit && (
        <div className="scan-banner">
          <div className="ico">
            <Camera size={20} style={{ color: "var(--brand)" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label">Scan RO ticket</div>
            <div className="sub">Auto-fills RO#, vehicle and op codes</div>
          </div>
          <ScanRoButton library={library} templates={roTemplates ?? []} onResult={handleScanResult} />
        </div>
      )}

      {/* ---- Step 1: RO number ---- */}
      <div className="step-card active">
        <div className="step-head" style={{ cursor: "default" }}>
          <div className="step-num">1</div>
          <div className="step-title">RO number</div>
          <div className="step-summary">required</div>
        </div>
        <div className="step-body">
          <div className="ro-hero">
            <span className="hash">#</span>
            <input
              ref={roInputRef}
              type="text"
              value={roNumber}
              onChange={(e) => setRoNumber(e.target.value)}
              required
              inputMode="numeric"
              placeholder="12345"
            />
          </div>
        </div>
      </div>

      {/* ---- Step 2: Op codes ---- */}
      <div className="step-card active">
        <div className="step-head" style={{ cursor: "default" }}>
          <div className="step-num">2</div>
          <div className="step-title">Op codes</div>
          {lines.length > 0 && (
            <div className="step-summary">
              {lines.length} line{lines.length !== 1 ? "s" : ""} · {fmtHours(totalFlag)}h
            </div>
          )}
        </div>
        <div className="step-body">
          {/* Search / picker */}
          <div className="opc-search" ref={pickerRef}>
            <span className="icon">
              <Search size={15} />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPickerOpen(true);
              }}
              onFocus={() => setPickerOpen(true)}
              placeholder="Search or add op code…"
              className="input"
              style={{ width: "100%", paddingRight: search ? 36 : undefined }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--fg-3)",
                  display: "flex",
                  alignItems: "center",
                }}
                aria-label="Clear"
              >
                <X size={14} />
              </button>
            )}

            {pickerOpen && (
              <div className="opc-dropdown">
                <div style={{ maxHeight: 256, overflowY: "auto" }}>
                  {filteredLibrary.length === 0 ? (
                    <div className="opc-dropdown-item" style={{ color: "var(--fg-3)", cursor: "default" }}>
                      No matches in your library.
                    </div>
                  ) : (
                    filteredLibrary.map((oc) => (
                      <button
                        key={oc.id}
                        type="button"
                        className="opc-dropdown-item"
                        onClick={() => addFromLibrary(oc)}
                      >
                        <span>
                          <span className="opc-code">{oc.code}</span>
                          <span style={{ marginLeft: 8, fontSize: 12, color: "var(--fg-2)" }}>
                            {oc.description}
                          </span>
                        </span>
                        <span style={{ fontSize: 12, color: "var(--fg-3)", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                          {oc.flagHours}h
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="opc-dropdown-footer">
                  <div className="opc-dropdown-footer-label">Other</div>
                  <button
                    type="button"
                    className="opc-dropdown-item"
                    onClick={() => setCustomOpen(true)}
                    style={{ borderRadius: 6 }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Plus size={13} />
                      Other op code (one-time)
                    </span>
                  </button>
                  <button
                    type="button"
                    className="opc-dropdown-item"
                    onClick={() => setNewLibraryOpen(true)}
                    style={{ borderRadius: 6 }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Plus size={13} />
                      Create new library op code
                    </span>
                  </button>
                </div>
                <div style={{ borderTop: "1px solid var(--line)", padding: "6px 12px", textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(false)}
                    style={{ fontSize: 11, color: "var(--fg-3)", background: "transparent", border: "none", cursor: "pointer" }}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Op code lines */}
          {lines.length === 0 ? (
            <p style={{ textAlign: "center", fontSize: 13, color: "var(--fg-3)", padding: "16px 0" }}>
              No op codes yet. Search above or tap a chip below.
            </p>
          ) : (
            <div style={{ marginTop: 8 }}>
              {lines.map((line) => {
                const { code, description } = lineLabel(line);
                return (
                  <div key={line.key} className="opc-line">
                    <div className="grow">
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span className="opc-code">{code}</span>
                        {line.custom && (
                          <span style={{
                            fontSize: 10,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: "var(--fg-3)",
                            background: "var(--bg-3)",
                            padding: "1px 5px",
                            borderRadius: 4,
                          }}>
                            Other
                          </span>
                        )}
                      </div>
                      <div className="opc-desc" style={{ fontSize: 12, color: "var(--fg-2)" }}>
                        {description}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={Number.isFinite(line.flagHours) ? line.flagHours : ""}
                      onChange={(e) =>
                        updateLine(line.key, {
                          flagHours: e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                      className="opc-hours-input"
                      title="Flag hours"
                      placeholder="flag"
                    />
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={line.actualHours ?? ""}
                      onChange={(e) =>
                        updateLine(line.key, {
                          actualHours: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className="opc-hours-input"
                      title="Actual hours"
                      placeholder="act"
                    />
                    <button
                      type="button"
                      className="remove"
                      onClick={() => removeLine(line.key)}
                      aria-label="Remove line"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quick-add chips */}
          {quickChips.length > 0 && (
            <div className="opc-quick">
              {quickChips.map((oc) => (
                <button
                  key={oc.id}
                  type="button"
                  className="opc-chip"
                  onClick={() => addFromLibrary(oc)}
                >
                  <span className="c">{oc.code}</span>
                  <span className="h">{oc.flagHours}h</span>
                </button>
              ))}
            </div>
          )}

          {/* Total */}
          {lines.length > 0 && (
            <div className="opc-total">
              <span className="label">Total flag hours</span>
              <span className="val">{fmtHours(totalFlag)}h</span>
            </div>
          )}
        </div>
      </div>

      {/* ---- Step 3: Vehicle (collapsible) ---- */}
      <div className={`step-card${vehicleOpen ? " active" : " collapsed"}`}>
        <div className="step-head" onClick={() => setVehicleOpen((v) => !v)}>
          <div className="step-num">3</div>
          <div className="step-title">
            Vehicle
            <span className="optional-badge">optional</span>
          </div>
          {vehicleSummary && !vehicleOpen && (
            <div className="step-summary">{vehicleSummary}</div>
          )}
          {vehicleOpen ? <ChevronUp size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} /> : <ChevronDown size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} />}
        </div>

        {vehicleOpen && (
          <div className="step-body">
            <datalist id="make-options">
              {COMMON_MAKES.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label className="field-label">Year</label>
                <input
                  type="text"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  inputMode="numeric"
                  placeholder="2000"
                  className="input"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label className="field-label" style={{ margin: 0 }}>Make</label>
                  {!isEdit && (
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={autoFill}
                        onChange={(e) => handleAutoFillToggle(e.target.checked)}
                        style={{ accentColor: "var(--brand)", width: 11, height: 11 }}
                      />
                      <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)" }}>
                        Auto
                      </span>
                    </label>
                  )}
                </div>
                <input
                  type="text"
                  list="make-options"
                  value={make}
                  onChange={(e) => handleMakeChange(e.target.value)}
                  placeholder="Toyota"
                  autoComplete="off"
                  className="input"
                  style={{
                    width: "100%",
                    borderColor: autoFill ? "var(--brand-soft)" : undefined,
                  }}
                />
                {autoFill && make && (
                  <p style={{ marginTop: 2, fontSize: 10, color: "var(--brand)" }}>
                    ✓ Saved — new ROs pre-fill with {make}
                  </p>
                )}
              </div>
              <div>
                <label className="field-label">Model</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Camry"
                  className="input"
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label className="field-label">VIN</label>
                <input
                  type="text"
                  value={vin}
                  onChange={(e) => setVin(e.target.value.toUpperCase())}
                  maxLength={17}
                  placeholder="17-char VIN"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="input mono"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label className="field-label">Mileage</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                  placeholder="65,000"
                  className="input"
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---- Step 4: Notes (collapsible) ---- */}
      <div className={`step-card${notesOpen ? " active" : " collapsed"}`}>
        <div className="step-head" onClick={() => setNotesOpen((v) => !v)}>
          <div className="step-num">4</div>
          <div className="step-title">
            Notes
            <span className="optional-badge">optional</span>
          </div>
          {notes && !notesOpen && (
            <div className="step-summary" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
              {notes}
            </div>
          )}
          {notesOpen ? <ChevronUp size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} /> : <ChevronDown size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} />}
        </div>

        {notesOpen && (
          <div className="step-body">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Customer concern, parts ordered, follow-up needed…"
              className="input"
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>
        )}
      </div>

      {/* ---- Error ---- */}
      {error && (
        <div style={{
          borderRadius: 8,
          border: "1px solid color-mix(in oklab, var(--bad) 40%, transparent)",
          background: "color-mix(in oklab, var(--bad) 10%, transparent)",
          padding: "8px 12px",
          fontSize: 13,
          color: "var(--bad)",
          marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      {/* ---- Sticky save bar ---- */}
      <div className="save-bar">
        <div className="summary">
          {roNumber ? (
            <>RO <b>#{roNumber}</b>{vehicleSummary ? ` · ${vehicleSummary}` : ""}{lines.length > 0 ? ` · ${lines.length} op code${lines.length !== 1 ? "s" : ""}` : ""}</>
          ) : (
            <span style={{ color: "var(--fg-3)" }}>Fill in RO # to save</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isEdit && (
            <Link href="/" className="btn btn-ghost btn-sm">
              Cancel
            </Link>
          )}
          {!isEdit && (
            <button
              type="button"
              onClick={handleSaveAndNew}
              disabled={isSubmitting}
              className="btn btn-ghost btn-sm"
            >
              Save & New
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={isSubmitting}
            className="btn btn-primary btn-sm"
          >
            {isSubmitting ? "Saving…" : isEdit ? "Save Changes" : "Save RO"}
          </button>
        </div>
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
