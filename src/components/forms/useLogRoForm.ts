"use client";

// All of LogRoForm's state and behavior, lifted out of the JSX so the form
// component stays a thin layout shell (and so QuickAddModal can converge on the
// same logic later). LogRoForm remains the state OWNER — it calls this hook once
// and passes slices down to VehicleFields / OpCodeLines / RoScanSection.
//
// This is a mechanical extraction: the logic below is moved verbatim from the
// original single-file component. No behavior change.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStored, writeStored } from "@/lib/client-storage";
import { DEFAULT_MAKE_KEY, deriveAutoFill, deriveMake } from "@/lib/default-make";
import type {
  ComebackKind,
  Entry,
  LaborType,
  NewEntry,
  NewEntryOpCode,
  OpCode,
  RoMatch,
  SubOpCode,
} from "@/lib/types";
import { isoDate } from "@/lib/periods";
import {
  saveEntry,
  deleteEntryAction,
  findDuplicateRos,
  setLineActualHoursAction,
} from "@/app/actions/entries";
import { retroCandidates, type RetroCandidate } from "@/lib/retro-capture";
import { createLibraryOpCode } from "@/app/actions/op-codes";
import { uploadEntryPhoto } from "@/app/actions/entry-photos";
import { downscaleImage } from "@/lib/image";
import type { OpCodeDraft } from "./OpCodeModals";
import type { OcrResult } from "@/lib/ocr";
import { decodeVin, isValidVin } from "@/lib/vin";
import { tap } from "@/lib/haptics";

export type LineDraft = NewEntryOpCode & {
  key: string;
  // Flag hours from before the comeback toggle zeroed them, so un-toggling a
  // misclick restores the book time instead of leaving a silent 0. Form-only —
  // never sent to the server.
  flagBeforeComeback?: number;
};

// useStored wants a parser; this value is already the string we want.
const keepRaw = (raw: string) => raw;

function linesFromEntry(entry: Entry | undefined): LineDraft[] {
  if (!entry) return [];
  return entry.opCodes.map((oc) => ({
    key: oc.id,
    id: oc.id, // DB line id — threaded back to updateEntry so it diffs instead of wiping
    opCodeId: oc.opCodeId,
    custom: oc.custom,
    customCode: oc.customCode,
    customDescription: oc.customDescription,
    flagHours: oc.flagHours,
    actualHours: oc.actualHours,
    notes: oc.notes,
    position: oc.position,
    subOpCodeId: oc.subOpCodeId,
    laborType: oc.laborType,
    // Carry reconciliation data through edit mode. Without this, saving an RO
    // edit would drop paid_hours from the NewEntryOpCode and — even though the
    // diff-based update no longer deletes-and-reinserts — the value would fall
    // out of the round-trip. Pure pass-through: the form never edits it.
    paidHours: oc.paidHours ?? null,
    // Form-owned, unlike paidHours — the toggle below edits this directly.
    isComeback: oc.isComeback ?? false,
  }));
}

export type UseLogRoForm = ReturnType<typeof useLogRoForm>;

export function useLogRoForm({
  initialOpCodes,
  existingEntry,
  onSave,
  onCreateOpCode,
  redirectTo = "/dashboard",
  defaultLaborType = null,
  laborTypeEnabled = false,
  checkDuplicates = !onSave,
}: {
  initialOpCodes: OpCode[];
  existingEntry?: Entry;
  onSave?: (input: NewEntry) => void | Promise<void>;
  onCreateOpCode?: (draft: OpCodeDraft) => OpCode;
  redirectTo?: string;
  // When the user has priced at least one rate (or set a default), the log form
  // shows a per-line labor-type selector. Off by default so the form is
  // unchanged for anyone who hasn't touched pay rates.
  defaultLaborType?: LaborType | null;
  laborTypeEnabled?: boolean;
  // Warn before saving an RO number that already exists. Defaults off when a
  // custom onSave is provided (guest mode has no DB to check) — DB-backed
  // embedders like the timer's Log RO modal must opt back in explicitly.
  checkDuplicates?: boolean;
}) {
  const router = useRouter();
  const isEdit = Boolean(existingEntry);

  const [date, setDate] = useState(existingEntry?.date ?? isoDate());
  const [roNumber, setRoNumber] = useState(existingEntry?.roNumber ?? "");
  const [year, setYear] = useState(existingEntry?.vehicle.year ?? "");
  // null = "the user has not touched this field", which is what lets the saved
  // default fill in below. Distinct from "" — clearing the box must leave it
  // cleared, not re-seed it from storage on the next render.
  const [makeInput, setMakeInput] = useState<string | null>(existingEntry?.vehicle.make ?? null);
  const [model, setModel] = useState(existingEntry?.vehicle.model ?? "");
  const [vin, setVin] = useState(existingEntry?.vehicle.vin ?? "");
  const [mileage, setMileage] = useState(existingEntry?.vehicle.mileage ?? "");
  // Autofill and the default make are one fact stored in one place: a saved
  // make MEANS autofill is on. Reading it through the store rather than seeding
  // state in a mount effect keeps `make` out of the SSR HTML, which matters
  // because it renders straight into an <input value>, and a value the server
  // could not know is the #418 hydration mismatch this app has hit twice.
  const savedMake = useStored(DEFAULT_MAKE_KEY, keepRaw, "", "");
  const [autoFillChoice, setAutoFillChoice] = useState<boolean | null>(null);
  const autoFill = deriveAutoFill(autoFillChoice, isEdit, savedMake);
  const make = deriveMake(makeInput, autoFill, savedMake);
  const setMake = setMakeInput;
  const [notes, setNotes] = useState(existingEntry?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    linesFromEntry(existingEntry),
  );
  const [library, setLibrary] = useState<OpCode[]>(initialOpCodes);

  // --- comeback (unpaid rework) -----------------------------------------
  // Kind and the "redo of" link are ENTRY-level; which lines were free is
  // LINE-level (lines[].isComeback). Both are needed because the shop writes
  // comebacks two ways — a fresh RO, or extra lines on the original ticket.
  const [comebackKind, setComebackKind] = useState<ComebackKind | null>(
    existingEntry?.comebackKind ?? null,
  );
  const [comebackOfEntryId, setComebackOfEntryId] = useState<string | null>(
    existingEntry?.comebackOfEntryId ?? null,
  );
  // "Redo of…" original-RO lookup, reusing the duplicate-RO search.
  const [originalRoSearch, setOriginalRoSearch] = useState("");
  const [originalRoMatches, setOriginalRoMatches] = useState<RoMatch[] | null>(null);
  const [isFindingOriginal, setIsFindingOriginal] = useState(false);
  // The picked original, for display. Null in edit mode even when
  // comebackOfEntryId is set — we have the id but not the summary, and
  // re-fetching it just to render a label isn't worth a round trip. The UI
  // says "linked to an earlier RO" in that case rather than inventing detail.
  const [selectedOriginal, setSelectedOriginal] = useState<RoMatch | null>(null);

  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [newLibraryOpen, setNewLibraryOpen] = useState(false);
  const [newLibraryPending, setNewLibraryPending] = useState(false);
  const [subPickerOc, setSubPickerOc] = useState<OpCode | null>(null);

  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [savedRoNumber, setSavedRoNumber] = useState<string | null>(null);
  const [isSubmitting, startTransition] = useTransition();
  const [isDeleting, startDelete] = useTransition();

  // Photo evidence is only stored for authenticated users — guest mode (in-memory
  // onSave) can't hold binaries, so the scan flow never wires photo capture there.
  const photosEnabled = !onSave;
  // A scanned RO photo held in form state until the entry is saved, then uploaded
  // and linked. Kept regardless of OCR outcome — even a failed scan is evidence.
  const [capturedPhoto, setCapturedPhoto] = useState<Blob | null>(null);

  function handlePhotoCaptured(blob: Blob) {
    setCapturedPhoto(blob);
  }

  // Compress + upload the retained photo for a freshly-saved entry. Non-blocking:
  // a failed upload must not fail the save (the RO is already persisted).
  async function uploadCapturedPhoto(entryId: string, blob: Blob) {
    try {
      const compressed = await downscaleImage(blob);
      const fd = new FormData();
      fd.append("photo", compressed, "ro.jpg");
      await uploadEntryPhoto(entryId, fd);
    } catch {
      // Swallow — the entry saved fine; the photo just didn't attach.
    }
  }

  // Duplicate-RO prompt: when saving a NEW RO whose number already exists, we
  // pause and ask the user (edit existing vs. log a separate repair).
  const [dupMatches, setDupMatches] = useState<RoMatch[] | null>(null);
  // Retro capture. The RO is ALREADY SAVED before any of this renders — the
  // prompt defers navigation, it never gates the persist. If anything here
  // throws, the tech still keeps their ticket.
  const [retroCandidatesList, setRetroCandidatesList] = useState<RetroCandidate[]>([]);
  const retroAfterSave = useRef<(() => void) | undefined>(undefined);
  const [isChecking, setIsChecking] = useState(false);
  const pendingAfterSave = useRef<(() => void) | undefined>(undefined);
  // Synchronous guard against overlapping persists (see performSave).
  const inFlightRef = useRef(false);

  function handleDeleteRo() {
    if (!existingEntry) return;
    if (!window.confirm(`Delete RO #${existingEntry.roNumber}? This can't be undone.`)) return;
    startDelete(async () => {
      try {
        await deleteEntryAction(existingEntry.id);
        router.push("/dashboard");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete RO.");
      }
    });
  }

  const roInputRef = useRef<HTMLInputElement>(null);

  function handleMakeChange(value: string) {
    setMake(value);
    if (autoFill) {
      // Pin the choice: clearing the field writes "" to storage, and a bare
      // derivation would then read "no saved make" as "autofill is off" and
      // uncheck the box under the user mid-edit.
      setAutoFillChoice(true);
      writeStored(DEFAULT_MAKE_KEY, value);
    }
  }

  function handleAutoFillToggle(checked: boolean) {
    setAutoFillChoice(checked);
    // Turning it off drops the stored default, so freeze whatever is on screen
    // into local state first — otherwise the box the user is looking at would
    // empty itself as a side effect of unchecking a checkbox.
    if (!checked) setMakeInput(make);
    writeStored(DEFAULT_MAKE_KEY, checked ? make : null);
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

  function buildLineFromLibrary(oc: OpCode, sub?: SubOpCode): LineDraft {
    return {
      key: crypto.randomUUID(),
      opCodeId: oc.id,
      custom: false,
      customCode: null,
      customDescription: null,
      flagHours: sub ? sub.flagHours : oc.flagHours,
      actualHours: null,
      notes: "",
      position: lines.length,
      subOpCodeId: sub ? sub.id : null,
      laborType: defaultLaborType,
      paidHours: null, // brand-new line: not yet reconciled
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
    setLines((ls) => [...ls, { ...buildLineFromLibrary(oc), position: ls.length }]);
  }

  function confirmSubPick(sub: SubOpCode) {
    if (!subPickerOc) return;
    const oc = subPickerOc;
    setSubPickerOc(null);
    setLines((ls) => [...ls, { ...buildLineFromLibrary(oc, sub), position: ls.length }]);
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
        subOpCodeId: null,
        laborType: defaultLaborType,
        paidHours: null,
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

  // --- comeback handlers -------------------------------------------------

  const hasComebackLines = lines.some((l) => l.isComeback);

  function clearComebackMeta() {
    setComebackKind(null);
    setComebackOfEntryId(null);
    setSelectedOriginal(null);
    setOriginalRoSearch("");
    setOriginalRoMatches(null);
  }

  // Marking a line as a comeback ZEROES its flag hours in the same update.
  // This is the fix for the auto-fill trap: picking an op code auto-fills the
  // library's flag hours, so without this the natural way to log a comeback
  // claims paid hours for free work. The DB CHECK backs it up, but doing it
  // here means the running total on screen is right the instant you tap.
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
      // Default to the common case; the selector below can change it.
      if (comebackKind === null) setComebackKind("comeback_own");
      return;
    }
    // Unmarking the LAST comeback line used to wipe the entry-level metadata.
    // Nothing needed it to: LogRoForm hides ComebackSection on hasComebackLines,
    // and BOTH save paths already null the columns when no line is marked (the
    // payload below, and actions/entries.ts). The wipe was purely destructive —
    // re-marking a line could not bring the redo-of link back, and on an
    // EXISTING RO the next save wrote that null straight to
    // comeback_of_entry_id. Flag hours have always survived this round trip via
    // flagBeforeComeback; the link survives it now too.
    //
    // Only clearOriginalRo() removes a link, because only the user should.
    // resetForm() still calls clearComebackMeta — a NEW RO must never inherit
    // the saved one's link.
  }

  function changeComebackKind(kind: ComebackKind) {
    setComebackKind(kind);
    // Only your OWN comeback can point at an original RO in your data, so the
    // link must never be PERSISTED under another kind — and it can't be: the
    // payload below and actions/entries.ts both null it unless kind is
    // "comeback_own". It is not DISPLAYED either; ComebackSection renders the
    // redo-of panel only for comeback_own.
    //
    // So nulling the state here bought nothing, and it cost the user their link
    // on a My own work -> Another tech's -> My own work round trip, which then
    // saved as null. Drop the stale search results only.
    if (kind !== "comeback_own") setOriginalRoMatches(null);
  }

  function findOriginalRo() {
    const ro = originalRoSearch.trim();
    if (!ro) return;
    setIsFindingOriginal(true);
    findDuplicateRos(ro)
      .then((matches) => setOriginalRoMatches(matches))
      .catch(() => setOriginalRoMatches([]))
      .finally(() => setIsFindingOriginal(false));
  }

  function chooseOriginalRo(match: RoMatch) {
    setComebackOfEntryId(match.id);
    setSelectedOriginal(match);
    setOriginalRoMatches(null);
  }

  function clearOriginalRo() {
    setComebackOfEntryId(null);
    setSelectedOriginal(null);
    setOriginalRoMatches(null);
    setOriginalRoSearch("");
  }

  // --- OCR scan result --------------------------------------------------

  function handleScanResult(result: OcrResult) {
    if (result.roNumber) setRoNumber(result.roNumber);
    if (result.year) setYear(result.year);
    if (result.make) setMake(result.make);
    if (result.model) setModel(result.model);
    if (result.vin) setVin(result.vin);
    if (!result.roNumber) setTimeout(() => roInputRef.current?.focus(), 50);
    // If OCR pulled a plausible VIN, decode it and prefer the authoritative
    // year/make/model over OCR's guesses. Non-blocking, silent-degrades.
    if (result.vin && isValidVin(result.vin)) {
      decodeVin(result.vin)
        .then((decoded) => {
          if (!decoded) return;
          if (decoded.year) setYear(decoded.year);
          if (decoded.make) setMake(decoded.make);
          if (decoded.model) setModel(decoded.model);
        })
        .catch(() => {});
    }
    if (result.opCodeIds.length > 0) {
      const newLines: LineDraft[] = result.opCodeIds.flatMap((id) => {
        if (lines.some((l) => l.opCodeId === id)) return [];
        const oc = library.find((o) => o.id === id);
        if (!oc) return [];
        // OCR-matched codes with subs skip the picker and add without a sub selected.
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
          subOpCodeId: null,
          laborType: defaultLaborType,
          paidHours: null,
        }];
      });
      if (newLines.length > 0) setLines((ls) => [...ls, ...newLines]);
    }
  }

  // --- submit -----------------------------------------------------------

  function resetForm() {
    setDate(isoDate());
    setRoNumber("");
    setYear("");
    // Back to null (not "") when autofill is on, so the next RO picks the saved
    // default up again — same end state as the old "leave make alone" branch,
    // since handleMakeChange keeps that default equal to what was typed.
    setMake(autoFill ? null : "");
    setModel("");
    setVin("");
    setMileage("");
    setNotes("");
    setLines([]);
    clearComebackMeta();
    setError(null);
    setVehicleOpen(false);
    setNotesOpen(false);
    setCapturedPhoto(null);
    setTimeout(() => roInputRef.current?.focus(), 50);
  }

  // The actual persist. No duplicate check here — callers gate that upstream.
  function performSave(afterSave?: () => void) {
    // Re-entry lock. `isSubmitting` (the transition flag) isn't reliably true
    // yet on a fast double-tap or when reached via the async duplicate-check
    // path, so a bare pending check can let two persists race — one of which
    // navigates away as "saved" while the other is the one that actually wrote.
    // A ref flips synchronously and closes that window (the silent-save-fail).
    if (inFlightRef.current) return;
    inFlightRef.current = true;
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
          // Entry-level comeback metadata is only meaningful when at least one
          // line is actually marked. Sending it otherwise would label a normal
          // RO a comeback — e.g. after the user toggles a line on, picks a
          // kind, then toggles it back off.
          comebackKind: hasComebackLines ? comebackKind : null,
          comebackOfEntryId:
            hasComebackLines && comebackKind === "comeback_own"
              ? comebackOfEntryId
              : null,
          opCodes: lines.map((line, i) => ({
            id: line.id, // undefined for new lines; existing lines keep their DB id
            opCodeId: line.opCodeId,
            custom: line.custom,
            customCode: line.customCode,
            customDescription: line.customDescription,
            // Belt and braces with the DB CHECK: a comeback line flags zero no
            // matter what the input held before it was toggled.
            flagHours: line.isComeback ? 0 : line.flagHours,
            actualHours: line.actualHours,
            notes: line.notes,
            position: i,
            subOpCodeId: line.subOpCodeId,
            laborType: line.laborType,
            paidHours: line.paidHours ?? null, // pass-through so edits never wipe it
            isComeback: line.isComeback ?? false,
          })),
        };
        if (onSave) {
          await onSave(input);
        } else {
          const saved = await saveEntry(input, existingEntry?.id);
          // Never navigate away as though the RO was saved unless the persist
          // came back with a real row. If it didn't, surface it and keep the
          // form intact so the work isn't silently lost.
          if (!saved?.id) {
            throw new Error("Save didn't confirm — please try again.");
          }
          // Attach the scanned photo now that the entry has an id. Only new-RO
          // saves carry a capturedPhoto (the scan banner is hidden in edit mode).
          if (photosEnabled && capturedPhoto) {
            await uploadCapturedPhoto(saved.id, capturedPhoto);
            setCapturedPhoto(null);
          }
          // Ask about the big jobs on this ticket, once, before leaving. Only
          // the persisted entry can be asked — the candidates carry real line
          // ids, which the pre-save form lines do not have.
          const candidates = retroCandidates(saved, library);
          if (candidates.length > 0) {
            tap();
            retroAfterSave.current = afterSave;
            setRetroCandidatesList(candidates);
            return;
          }
        }
        tap();
        if (afterSave) {
          afterSave();
        } else {
          router.push(redirectTo);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  function handleSave(afterSave?: () => void) {
    setError(null);
    const ro = roNumber.trim();
    // Edits skip the duplicate check (the number already belongs to this RO),
    // as do embedders that opted out (guest mode's in-memory onSave has no DB).
    // Empty RO# falls through too — performSave/server surfaces that error.
    if (isEdit || !checkDuplicates || !ro) {
      performSave(afterSave);
      return;
    }
    setIsChecking(true);
    findDuplicateRos(ro)
      .then((matches) => {
        if (matches.length > 0) {
          pendingAfterSave.current = afterSave;
          setDupMatches(matches);
        } else {
          performSave(afterSave);
        }
      })
      .catch(() => {
        // Don't let a failed check block saving — just proceed.
        performSave(afterSave);
      })
      .finally(() => setIsChecking(false));
  }

  function handleDupEdit(id: string) {
    setDupMatches(null);
    pendingAfterSave.current = undefined;
    router.push(`/log?edit=${id}`);
  }

  function handleDupLogNew() {
    const after = pendingAfterSave.current;
    pendingAfterSave.current = undefined;
    setDupMatches(null);
    performSave(after);
  }

  function handleDupClose() {
    pendingAfterSave.current = undefined;
    setDupMatches(null);
  }

  function handleSaveAndNew() {
    const savedRo = roNumber.trim();
    handleSave(() => {
      setSavedRoNumber(savedRo);
      resetForm();
      setTimeout(() => setSavedRoNumber(null), 3500);
    });
  }

  // Both paths finish the navigation the save deferred, and both clear the
  // prompt FIRST — a write that fails must not strand the tech in a modal with
  // their RO already saved behind it.
  function finishRetro() {
    const after = retroAfterSave.current;
    retroAfterSave.current = undefined;
    setRetroCandidatesList([]);
    if (after) after();
    else router.push(redirectTo);
  }

  function skipRetro() {
    finishRetro();
  }

  async function submitRetro(answers: Record<string, number>) {
    try {
      await Promise.all(
        Object.entries(answers).map(([lineId, hours]) =>
          setLineActualHoursAction(lineId, hours, "estimate"),
        ),
      );
    } catch {
      // Deliberately swallowed. The RO is saved; a failed estimate write is the
      // least important thing in this flow, and trapping the tech on a modal to
      // tell them about it would cost more than the number is worth.
    }
    finishRetro();
  }

  const vehicleSummary = [year, make, model].filter(Boolean).join(" ");

  return {
    // meta
    isEdit,
    existingEntry,
    // shell fields
    date, setDate,
    roNumber, setRoNumber,
    notes, setNotes,
    notesOpen, setNotesOpen,
    vehicleOpen, setVehicleOpen,
    error,
    savedRoNumber,
    isSubmitting,
    isDeleting,
    isChecking,
    dupMatches,
    retroCandidates: retroCandidatesList,
    submitRetro,
    skipRetro,
    roInputRef,
    vehicleSummary,
    // vehicle
    year, setYear,
    make, model, setModel,
    vin, setVin,
    mileage, setMileage,
    autoFill,
    handleMakeChange,
    handleAutoFillToggle,
    // op codes
    library,
    lines,
    search, setSearch,
    pickerOpen, setPickerOpen,
    customOpen, setCustomOpen,
    newLibraryOpen, setNewLibraryOpen,
    newLibraryPending,
    subPickerOc, setSubPickerOc,
    filteredLibrary,
    totalFlag,
    quickChips,
    pickerRef,
    // labor type
    laborTypeEnabled,
    addFromLibrary,
    confirmSubPick,
    addCustomLine,
    addNewLibraryLine,
    updateLine,
    removeLine,
    // comeback (unpaid rework)
    hasComebackLines,
    comebackKind,
    comebackOfEntryId,
    selectedOriginal,
    originalRoSearch, setOriginalRoSearch,
    originalRoMatches,
    isFindingOriginal,
    toggleLineComeback,
    changeComebackKind,
    findOriginalRo,
    chooseOriginalRo,
    clearOriginalRo,
    // scan / ocr
    handleScanResult,
    // photo evidence
    photosEnabled,
    photoAttached: capturedPhoto !== null,
    handlePhotoCaptured,
    clearCapturedPhoto: () => setCapturedPhoto(null),
    // save
    handleSave,
    handleSaveAndNew,
    handleDeleteRo,
    handleDupEdit,
    handleDupLogNew,
    handleDupClose,
  };
}
