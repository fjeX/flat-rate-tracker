"use client";

// Log / edit a repair order. This component is the STATE OWNER: it calls
// useLogRoForm once and threads slices of that state down into the section
// components (RoScanSection, OpCodeLines, VehicleFields). The shell here owns
// only the surrounding layout — title, RO#/notes steps, save bar, dialogs.
//
// OPEN TICKETS (docs/plans/PLAN-open-tickets.md) add three modes on top of the
// ordinary new/edit RO, all handled here by swapping what `onSave` does and
// which sections render — the hook and the section components are untouched:
//
//   open-create — "Open ticket — no op codes yet" toggle on a new RO. The RO
//                 number is the only required field (decision 2); the op-code
//                 step is hidden; save calls createOpenEntryAction.
//   open-edit   — /log?edit=<open ticket>. Vehicle and notes are progressive,
//                 so this edits them; still no op codes; save calls
//                 updateOpenEntryAction.
//   close       — /log?edit=<open ticket>&close=1. The FULL line editor (the
//                 plan's "existing line editor, same validation"), the close
//                 date defaulting to today (decision 9), the actual-hours
//                 prefill from the ticket's timeline (decision 6); save calls
//                 closeTicketAction. Reusing this form rather than a second
//                 line editor inside the modal is deliberate: labor types,
//                 sub op codes, custom lines and new-library codes all come
//                 for free, and there is one place the line rules live.
import Link from "next/link";
import { useEffect, useState } from "react";
import { RetroTimePrompt } from "@/components/forms/RetroTimePrompt";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { Entry, LaborType, NewEntry, OpCode, RoTemplate } from "@/lib/types";
import type { OpCodeDraft } from "./OpCodeModals";
import { PillInput } from "@/components/ui/PillInput";
import { Switch } from "@/components/ui/Switch";
import { DuplicateRoDialog } from "./DuplicateRoDialog";
import { useLogRoForm } from "./useLogRoForm";
import { RoScanSection } from "./RoScanSection";
import { OpCodeLines } from "./OpCodeLines";
import { ComebackSection } from "./ComebackSection";
import { VehicleFields } from "./VehicleFields";
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import { fmtHours } from "@/lib/stats";
import { formatDateLong } from "@/lib/periods";
import { defaultPrefillLineIndex, type ClosePrefill } from "@/lib/open-tickets";
import {
  closeTicketAction,
  createOpenEntryAction,
  findOpenRoAction,
  getCloseDefaultsAction,
  updateOpenEntryAction,
} from "@/app/actions/open-tickets";

export function LogRoForm({
  initialOpCodes,
  existingEntry,
  roTemplates,
  onSave,
  onCreateOpCode,
  redirectTo = "/dashboard",
  defaultLaborType = null,
  laborTypeEnabled = false,
  checkDuplicates,
  trackRoTime = false,
  defaultLoggedTime = "",
  timeZone = "",
  today = "",
  openTicketEnabled = false,
  closeMode = false,
}: {
  initialOpCodes: OpCode[];
  existingEntry?: Entry;
  roTemplates?: RoTemplate[];
  onSave?: (input: NewEntry) => void | Promise<void>;
  onCreateOpCode?: (draft: OpCodeDraft) => OpCode;
  redirectTo?: string;
  defaultLaborType?: LaborType | null;
  laborTypeEnabled?: boolean;
  checkDuplicates?: boolean;
  trackRoTime?: boolean;
  defaultLoggedTime?: string;
  timeZone?: string;
  /** Today in the user's timezone, server-computed. The close date default. */
  today?: string;
  /** Signed-in only (decision 12): the guest page never sets this. */
  openTicketEnabled?: boolean;
  /** /log?edit=<open ticket>&close=1 — the close flow. */
  closeMode?: boolean;
}) {
  const editingOpen = Boolean(existingEntry && existingEntry.status === "open");
  const closing = editingOpen && closeMode;
  // The toggle for a NEW ticket. Only a signed-in new-RO form ever offers it.
  const [openToggle, setOpenToggle] = useState(false);
  const openCreate = !existingEntry && openTicketEnabled && openToggle;
  // "Ticket mode": the op-code step is hidden and save goes to the ticket
  // actions. Closing is NOT ticket mode — it is the moment the codes arrive.
  const ticketMode = openCreate || (editingOpen && !closing);

  // --- open-create: the "already open" warning --------------------------
  // Compared against OPEN tickets only (plan risk #4). A match against a
  // closed RO is a recycled number and stays silent.
  const [openDup, setOpenDup] = useState<Entry | null>(null);
  const [openDupAcknowledged, setOpenDupAcknowledged] = useState(false);
  const [viewDup, setViewDup] = useState(false);

  // --- close: the actual-hours prefill ------------------------------------
  const [prefill, setPrefill] = useState<ClosePrefill | null>(null);
  const [prefillHours, setPrefillHours] = useState("");
  const [prefillLine, setPrefillLine] = useState<number | null>(null);
  // --- close: keep-or-move the flag date, Phase 2 / decision 11 -----------
  // A SECOND close (after a reopen) must never silently move paid hours off
  // the day they were paid — so on a reopened ticket the date does NOT
  // default to today the way a first close's does; it defaults to the date
  // the ticket already carries, and the tech has to actively choose "move".
  const [reopened, setReopened] = useState(false);
  const [currentFlagDate, setCurrentFlagDate] = useState<string | null>(null);
  const [dateChoice, setDateChoice] = useState<"keep" | "move">("keep");

  // What the hook persists with, per mode. Declared before the hook so the
  // closure reads the CURRENT mode on every save — performSave is rebuilt each
  // render, so it always sees the latest of these.
  const ticketSave = ticketMode || closing
    ? async (input: NewEntry) => {
        if (openCreate) {
          const ro = input.roNumber.trim();
          if (!openDupAcknowledged) {
            const open = await findOpenRoAction(ro);
            if (open.length > 0) {
              setOpenDup(open[0]);
              throw new Error(`RO ${ro} is already open. View it, or open another ticket under the same number.`);
            }
          }
          const res = await createOpenEntryAction({
            roNumber: ro,
            vehicle: input.vehicle,
            notes: input.notes,
          });
          if (res.error) throw new Error(res.error);
          return;
        }
        if (!existingEntry) return;
        if (closing) {
          // Put the timeline's hours on the chosen line — unless the tech
          // already typed an actual on it, which wins.
          const hours = prefillHours.trim() === "" ? null : Number(prefillHours);
          const idx =
            prefillLine ?? (input.opCodes.length > 0 ? defaultPrefillLineIndex(input.opCodes) : 0);
          const opCodes = input.opCodes.map((line, i) =>
            i === idx && hours !== null && hours > 0 && line.actualHours === null
              ? { ...line, actualHours: hours, actualSource: prefill?.actualSource ?? "estimate" }
              : line,
          );
          const res = await closeTicketAction({
            entryId: existingEntry.id,
            date: input.date,
            loggedTime: input.loggedTime,
            opCodes,
          });
          if (res.error) throw new Error(res.error);
          return;
        }
        const res = await updateOpenEntryAction({
          entryId: existingEntry.id,
          roNumber: input.roNumber.trim(),
          vehicle: input.vehicle,
          notes: input.notes,
          loggedTime: input.loggedTime,
        });
        if (res.error) throw new Error(res.error);
      }
    : onSave;

  // Destructure into locals rather than reading `x` in JSX: the hook returns
  // refs, and the react-compiler lint rule otherwise taints every `x` read as
  // "accessing a ref during render".
  const {
    isEdit, savedRoNumber, abandonedRoNumber, date, setDate, roNumber, setRoNumber, error, roInputRef,
    loggedTime, setLoggedTime, trackRoTime: timeFieldShown,
    library, handleScanResult, lines, search, setSearch, pickerOpen, setPickerOpen,
    pickerRef, filteredLibrary, totalFlag, quickChips, customOpen, setCustomOpen,
    newLibraryOpen, setNewLibraryOpen, newLibraryPending, subPickerOc, setSubPickerOc,
    addFromLibrary, confirmSubPick, addCustomLine, addNewLibraryLine, updateLine, removeLine,
    hasComebackLines, comebackKind, comebackOfEntryId, selectedOriginal,
    originalRoSearch, setOriginalRoSearch, originalRoMatches, isFindingOriginal,
    toggleLineComeback, changeComebackKind, findOriginalRo, chooseOriginalRo,
    clearOriginalRo,
    vehicleOpen, setVehicleOpen, vehicleSummary, year, setYear, make, handleMakeChange,
    model, setModel, vin, setVin, mileage, setMileage, autoFill, handleAutoFillToggle,
    notesOpen, setNotesOpen, notes, setNotes, isDeleting, isSubmitting, isChecking,
    dupMatches, retroCandidates, submitRetro, skipRetro,
    handleDeleteRo, handleSaveAndNew, handleSave, handleDupEdit,
    handleDupLogNew, handleDupClose, laborTypeEnabled: laborTypeShown,
    photosEnabled, photoAttached, handlePhotoCaptured, clearCapturedPhoto,
  } = useLogRoForm({
    initialOpCodes,
    // In close mode the date field is the CLOSE date, defaulting to today
    // (decision 9) — not the opened-day placeholder the row still carries. The
    // hook seeds `date` from existingEntry, so the override goes in here.
    existingEntry:
      closing && existingEntry && today
        ? { ...existingEntry, date: today, loggedTime: defaultLoggedTime || null }
        : existingEntry,
    onSave: ticketSave, onCreateOpCode, redirectTo,
    defaultLaborType, laborTypeEnabled, checkDuplicates,
    // The close form re-defaults the time from the setting like a fresh RO
    // (seeded through the existingEntry override above — plan risk #3).
    trackRoTime, defaultLoggedTime, timeZone,
  });

  // Fetches the close defaults (decision 6's prefill, decision 11's reopened
  // flag). Below the hook call, not above, because a reopened ticket's
  // default is `setDate(d.currentDate)` — overriding the today the hook just
  // seeded the field with — and `setDate` doesn't exist until the hook runs.
  useEffect(() => {
    if (!closing || !existingEntry) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await getCloseDefaultsAction(existingEntry.id);
        if (cancelled) return;
        setPrefill(d.prefill);
        setPrefillHours(d.prefill.actualHours > 0 ? String(d.prefill.actualHours) : "");
        setReopened(d.reopened);
        setCurrentFlagDate(d.currentDate);
        if (d.reopened) {
          // Never move paid hours silently (decision 11): default to KEEP,
          // overriding the today the hook otherwise seeds a close with.
          setDateChoice("keep");
          setDate(d.currentDate);
        }
      } catch {
        // Non-fatal: the tech can still close and type actuals by hand.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [closing, existingEntry, setDate]);

  const title = openCreate
    ? "Open a ticket"
    : closing
      ? `Close ticket #${existingEntry!.roNumber}`
      : editingOpen
        ? `Edit ticket #${existingEntry!.roNumber}`
        : isEdit
          ? `Edit RO #${existingEntry!.roNumber}`
          : "New repair order";

  const saveLabel = isChecking
    ? "Checking…"
    : isSubmitting
      ? "Saving…"
      : openCreate
        ? "Open ticket"
        : closing
          ? "Close ticket"
          : editingOpen
            ? "Save ticket"
            : isEdit
              ? "Save Changes"
              : "Save RO";

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
      <h1 className="sr-only">{title}</h1>
      <div className="section-title" style={{ marginBottom: 16 }}>
        <span aria-hidden="true">{title}</span>
        {/* No date on a ticket: the opened day is the server's today and the
            flag day is chosen at close. In close mode this IS the flag day. */}
        {!ticketMode && (
          <>
            <label htmlFor="ro-date" className="sr-only">{closing ? "Close date" : "Date"}</label>
            <PillInput
              id="ro-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              aria-required="true"
            />
          </>
        )}
        {/* Sits beside the date because it IS part of the date — a wall-clock
            time on that day, not an independent fact. Not `required`: clearing
            it is a legitimate answer ("I don't remember when"), and an empty box
            saves as no time rather than blocking the RO. */}
        {timeFieldShown && !ticketMode && (
          <>
            <label htmlFor="ro-time" className="sr-only">Time</label>
            <PillInput
              id="ro-time"
              type="time"
              value={loggedTime}
              onChange={(e) => setLoggedTime(e.target.value)}
            />
          </>
        )}
      </div>

      {/* ---- Open-ticket toggle (new RO, signed in) ---- */}
      {!isEdit && openTicketEnabled && (
        <div className="step-card active" style={{ marginBottom: 12 }}>
          <div className="step-body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div className="step-title">Open ticket — no op codes yet</div>
              <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>
                For a job that spans days. Log the hours per day; flag it when the codes are known.
              </div>
            </div>
            <Switch
              checked={openToggle}
              onChange={setOpenToggle}
              // MUST match the visible label word for word (WCAG 2.5.3).
              label="Open ticket — no op codes yet"
            />
          </div>
        </div>
      )}

      {/* ---- Close-mode prefill banner ---- */}
      {closing && (
        <div className="step-card active" style={{ marginBottom: 12 }} data-testid="close-prefill">
          <div className="step-body">
            <div className="step-title">Closing this ticket</div>
            <p style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 4 }}>
              Add the op codes and flag hours below. The flag lands on the close
              date above.
            </p>
            {/* Second close (decision 11): keep the flag date the first close
                set, or move it to today. KEEP is the default — a reopen must
                never silently move paid hours off the day they were paid. The
                date pill above stays editable either way; these just pick
                which day it starts on. */}
            {reopened && currentFlagDate && today && (
              <div
                style={{ marginTop: 8, display: "grid", gap: 6 }}
                data-testid="reopen-date-choice"
              >
                <div style={{ fontSize: 13 }}>
                  This ticket was reopened. Keep the flag date, or move it to today?
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="radio"
                    name="close-date-choice"
                    checked={dateChoice === "keep"}
                    onChange={() => {
                      setDateChoice("keep");
                      setDate(currentFlagDate);
                    }}
                  />
                  Keep flag date {formatDateLong(currentFlagDate)}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="radio"
                    name="close-date-choice"
                    checked={dateChoice === "move"}
                    onChange={() => {
                      setDateChoice("move");
                      setDate(today);
                    }}
                  />
                  Move to today ({formatDateLong(today)})
                </label>
              </div>
            )}
            {prefill && prefill.actualHours > 0 ? (
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                <div style={{ fontSize: 13 }}>
                  Timeline says <b>{fmtHours(prefill.actualHours)}h</b> worked
                  {prefill.actualSource === "estimate" && (
                    <span style={{ color: "var(--fg-3)" }}> (typed, so it&apos;s an estimate)</span>
                  )}
                  . Put it on:
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ fontSize: 12, color: "var(--fg-3)" }}>
                    Line
                    <select
                      className="input"
                      style={{ marginLeft: 6 }}
                      value={prefillLine ?? (lines.length > 0 ? defaultPrefillLineIndex(lines) : 0)}
                      onChange={(e) => setPrefillLine(Number(e.target.value))}
                      disabled={lines.length === 0}
                      aria-label="Line to receive the timeline hours"
                    >
                      {lines.length === 0 ? (
                        <option value={0}>add an op code first</option>
                      ) : (
                        lines.map((l, i) => (
                          <option key={i} value={i}>
                            {i + 1}. {(l.custom ? l.customCode : library.find((oc) => oc.id === l.opCodeId)?.code) || "line"} · {fmtHours(l.flagHours)}h flag
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <label style={{ fontSize: 12, color: "var(--fg-3)" }}>
                    Actual hours
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      inputMode="decimal"
                      className="input mono tabular"
                      style={{ marginLeft: 6, width: 90 }}
                      value={prefillHours}
                      onChange={(e) => setPrefillHours(e.target.value)}
                      aria-label="Actual hours to put on that line"
                    />
                  </label>
                </div>
                {prefill.excludedHoldHours > 0 && (
                  <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                    Waiting isn&apos;t wrenching: {fmtHours(prefill.excludedHoldHours)}h of hold time on this
                    ticket is not in that figure.
                  </div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 6 }}>
                No hours were logged on this ticket&apos;s timeline, so nothing is prefilled.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- Scan banner (new RO only) ---- */}
      {!isEdit && !openCreate && (
        <RoScanSection
          library={library}
          templates={roTemplates ?? []}
          onResult={handleScanResult}
          onPhotoCaptured={photosEnabled ? handlePhotoCaptured : undefined}
          photoAttached={photosEnabled && photoAttached}
          onPhotoRemove={photosEnabled ? clearCapturedPhoto : undefined}
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
              onChange={(e) => {
                setRoNumber(e.target.value);
                // A new number is a new question.
                setOpenDup(null);
                setOpenDupAcknowledged(false);
              }}
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

      {/* ---- Step 2: Op codes (hidden while the ticket is open) ---- */}
      {!ticketMode && (
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
          toggleLineComeback={toggleLineComeback}
          laborTypeEnabled={laborTypeShown}
        />
      )}

      {/* Appears only once a line is marked — a normal paid RO never sees it. */}
      {!ticketMode && hasComebackLines && (
        <ComebackSection
          comebackKind={comebackKind}
          comebackOfEntryId={comebackOfEntryId}
          selectedOriginal={selectedOriginal}
          originalRoSearch={originalRoSearch}
          setOriginalRoSearch={setOriginalRoSearch}
          originalRoMatches={originalRoMatches}
          isFindingOriginal={isFindingOriginal}
          changeComebackKind={changeComebackKind}
          findOriginalRo={findOriginalRo}
          chooseOriginalRo={chooseOriginalRo}
          clearOriginalRo={clearOriginalRo}
        />
      )}

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
          {/* The "already open" warning offers the jump and the override the
              plan asks for. Both sit inside the alert so a screen reader hears
              the choice with the sentence. */}
          {openCreate && openDup && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm" onClick={() => setViewDup(true)}>
                View open ticket
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setOpenDupAcknowledged(true);
                  setOpenDup(null);
                }}
              >
                Open another under #{openDup.roNumber}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---- Backed out of the duplicate prompt: the RO was NOT saved ----
           Sits directly above the save bar because that is where the tech is
           looking when they expect the green banner. Warn, not error: nothing
           failed, but nothing was written either. ---- */}
      {abandonedRoNumber && (
        <div
          role="status"
          style={{
            borderRadius: 8,
            border: "1px solid color-mix(in oklab, var(--warn) 40%, transparent)",
            background: "var(--warn-bg)",
            padding: "8px 12px",
            fontSize: 13,
            color: "var(--warn)",
            marginBottom: 12,
          }}
        >
          Not saved — RO #{abandonedRoNumber} already exists. Save again to pick
          Edit or Log as new, or change the RO number.
        </div>
      )}

      {/* ---- Sticky save bar ---- */}
      <div className="save-bar">
        <div className="summary">
          {roNumber ? (
            ticketMode ? (
              <>{openCreate ? "Open ticket" : "Ticket"} <b>#{roNumber}</b>{vehicleSummary ? ` · ${vehicleSummary}` : ""}</>
            ) : (
              <>RO <b>#{roNumber}</b>{vehicleSummary ? ` · ${vehicleSummary}` : ""}{lines.length > 0 ? ` · ${lines.length} op code${lines.length !== 1 ? "s" : ""}` : ""}</>
            )
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
              className="btn btn-sm btn-danger"
              style={{ marginRight: "auto" }}
            >
              <Trash2 style={{ width: 14, height: 14 }} />
              {isDeleting ? "Deleting…" : editingOpen ? "Delete ticket" : "Delete RO"}
            </button>
          )}
          {isEdit && (
            <Link href="/dashboard" className="btn btn-ghost btn-sm">
              Cancel
            </Link>
          )}
          {!isEdit && !openCreate && (
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
            data-testid="ro-save"
          >
            {saveLabel}
          </button>
        </div>
      </div>

      {/* ---- "How long did that take?" — fires only for 2h+ lines, after the
           RO is already persisted. See lib/retro-capture.ts. ---- */}
      <RetroTimePrompt
        open={retroCandidates.length > 0}
        candidates={retroCandidates}
        onSubmit={submitRetro}
        onSkip={skipRetro}
      />

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

      {/* ---- "Already open" — jump to the open ticket ---- */}
      {viewDup && openDup && (
        <RoDetailModal
          entry={openDup}
          library={library}
          onClose={() => setViewDup(false)}
        />
      )}
    </main>
  );
}
