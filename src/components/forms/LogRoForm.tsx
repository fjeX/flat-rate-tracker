"use client";

// Log / edit a repair order. This component is the STATE OWNER: it calls
// useLogRoForm once and threads slices of that state down into the section
// components (RoScanSection, OpCodeLines, VehicleFields). The shell here owns
// only the surrounding layout — title, RO#/notes steps, save bar, dialogs.
import Link from "next/link";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { Entry, LaborType, NewEntry, OpCode, RoTemplate } from "@/lib/types";
import type { OpCodeDraft } from "./OpCodeModals";
import { DuplicateRoDialog } from "./DuplicateRoDialog";
import { useLogRoForm } from "./useLogRoForm";
import { RoScanSection } from "./RoScanSection";
import { OpCodeLines } from "./OpCodeLines";
import { VehicleFields } from "./VehicleFields";

export function LogRoForm({
  initialOpCodes,
  existingEntry,
  roTemplates,
  onSave,
  onCreateOpCode,
  redirectTo = "/dashboard",
  defaultLaborType = null,
  laborTypeEnabled = false,
}: {
  initialOpCodes: OpCode[];
  existingEntry?: Entry;
  roTemplates?: RoTemplate[];
  onSave?: (input: NewEntry) => void | Promise<void>;
  onCreateOpCode?: (draft: OpCodeDraft) => OpCode;
  redirectTo?: string;
  defaultLaborType?: LaborType | null;
  laborTypeEnabled?: boolean;
}) {
  // Destructure into locals rather than reading `x` in JSX: the hook returns
  // refs, and the react-compiler lint rule otherwise taints every `x` read as
  // "accessing a ref during render".
  const {
    isEdit, savedRoNumber, date, setDate, roNumber, setRoNumber, error, roInputRef,
    library, handleScanResult, lines, search, setSearch, pickerOpen, setPickerOpen,
    pickerRef, filteredLibrary, totalFlag, quickChips, customOpen, setCustomOpen,
    newLibraryOpen, setNewLibraryOpen, newLibraryPending, subPickerOc, setSubPickerOc,
    addFromLibrary, confirmSubPick, addCustomLine, addNewLibraryLine, updateLine, removeLine,
    vehicleOpen, setVehicleOpen, vehicleSummary, year, setYear, make, handleMakeChange,
    model, setModel, vin, setVin, mileage, setMileage, autoFill, handleAutoFillToggle,
    notesOpen, setNotesOpen, notes, setNotes, isDeleting, isSubmitting, isChecking,
    dupMatches, handleDeleteRo, handleSaveAndNew, handleSave, handleDupEdit,
    handleDupLogNew, handleDupClose, laborTypeEnabled: laborTypeShown,
  } = useLogRoForm({
    initialOpCodes, existingEntry, onSave, onCreateOpCode, redirectTo,
    defaultLaborType, laborTypeEnabled,
  });

  return (
    <main className="mx-auto max-w-xl p-4 pb-32">

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
      <h1 className="sr-only">{isEdit ? `Edit RO #${existingEntry!.roNumber}` : "New repair order"}</h1>
      <div className="section-title" style={{ marginBottom: 16 }}>
        <span aria-hidden="true">{isEdit ? `Edit RO #${existingEntry!.roNumber}` : "New repair order"}</span>
        <label htmlFor="ro-date" className="sr-only">Date</label>
        <input
          id="ro-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          aria-required="true"
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
        <RoScanSection
          library={library}
          templates={roTemplates ?? []}
          onResult={handleScanResult}
        />
      )}

      {/* ---- Step 1: RO number ---- */}
      <div className="step-card active">
        <div className="step-head" style={{ cursor: "default" }}>
          <div className="step-num">1</div>
          <div className="step-title">RO number</div>
          <div className="step-summary">required</div>
        </div>
        <div className="step-body">
          <label htmlFor="ro-number" className="sr-only">RO number</label>
          <div className="ro-hero">
            <span className="hash" aria-hidden="true">#</span>
            <input
              id="ro-number"
              ref={roInputRef}
              type="text"
              value={roNumber}
              onChange={(e) => setRoNumber(e.target.value)}
              required
              aria-required="true"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "ro-save-error" : undefined}
              inputMode="numeric"
              placeholder="12345"
            />
          </div>
        </div>
      </div>

      {/* ---- Step 2: Op codes ---- */}
      <OpCodeLines
        library={library}
        lines={lines}
        search={search}
        setSearch={setSearch}
        pickerOpen={pickerOpen}
        setPickerOpen={setPickerOpen}
        pickerRef={pickerRef}
        filteredLibrary={filteredLibrary}
        totalFlag={totalFlag}
        quickChips={quickChips}
        customOpen={customOpen}
        setCustomOpen={setCustomOpen}
        newLibraryOpen={newLibraryOpen}
        setNewLibraryOpen={setNewLibraryOpen}
        newLibraryPending={newLibraryPending}
        subPickerOc={subPickerOc}
        setSubPickerOc={setSubPickerOc}
        addFromLibrary={addFromLibrary}
        confirmSubPick={confirmSubPick}
        addCustomLine={addCustomLine}
        addNewLibraryLine={addNewLibraryLine}
        updateLine={updateLine}
        removeLine={removeLine}
        laborTypeEnabled={laborTypeShown}
      />

      {/* ---- Step 3: Vehicle (collapsible) ---- */}
      <VehicleFields
        isEdit={isEdit}
        vehicleOpen={vehicleOpen}
        setVehicleOpen={setVehicleOpen}
        vehicleSummary={vehicleSummary}
        year={year}
        setYear={setYear}
        make={make}
        handleMakeChange={handleMakeChange}
        model={model}
        setModel={setModel}
        vin={vin}
        setVin={setVin}
        mileage={mileage}
        setMileage={setMileage}
        autoFill={autoFill}
        handleAutoFillToggle={handleAutoFillToggle}
      />

      {/* ---- Step 4: Notes (collapsible) ---- */}
      <div className={`step-card${notesOpen ? " active" : " collapsed"}`}>
        <button
          type="button"
          className="step-head"
          onClick={() => setNotesOpen((v) => !v)}
          aria-expanded={notesOpen}
          aria-controls="notes-step-body"
        >
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
        </button>

        {notesOpen && (
          <div className="step-body" id="notes-step-body">
            <label htmlFor="ro-notes" className="sr-only">Notes</label>
            <textarea
              id="ro-notes"
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
        <div
          id="ro-save-error"
          role="alert"
          style={{
            borderRadius: 8,
            border: "1px solid color-mix(in oklab, var(--bad) 40%, transparent)",
            background: "color-mix(in oklab, var(--bad) 10%, transparent)",
            padding: "8px 12px",
            fontSize: 13,
            color: "var(--bad)",
            marginBottom: 12,
          }}
        >
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
            <button
              type="button"
              onClick={handleDeleteRo}
              disabled={isDeleting || isSubmitting}
              className="btn btn-sm"
              style={{ color: "#fca5a5", borderColor: "rgba(153,27,27,0.5)", background: "transparent", marginRight: "auto" }}
            >
              <Trash2 style={{ width: 14, height: 14 }} />
              {isDeleting ? "Deleting…" : "Delete RO"}
            </button>
          )}
          {isEdit && (
            <Link href="/dashboard" className="btn btn-ghost btn-sm">
              Cancel
            </Link>
          )}
          {!isEdit && (
            <button
              type="button"
              onClick={handleSaveAndNew}
              disabled={isSubmitting || isChecking}
              className="btn btn-ghost btn-sm"
            >
              Save & New
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={isSubmitting || isChecking}
            className="btn btn-primary btn-sm"
          >
            {isChecking ? "Checking…" : isSubmitting ? "Saving…" : isEdit ? "Save Changes" : "Save RO"}
          </button>
        </div>
      </div>

      {/* ---- Duplicate-RO dialog ---- */}
      {dupMatches && (
        <DuplicateRoDialog
          roNumber={roNumber.trim()}
          matches={dupMatches}
          onEdit={handleDupEdit}
          onLogNew={handleDupLogNew}
          onClose={handleDupClose}
        />
      )}
    </main>
  );
}
