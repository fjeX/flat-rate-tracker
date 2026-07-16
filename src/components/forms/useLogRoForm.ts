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
import type {
  Entry,
  LaborType,
  NewEntry,
  NewEntryOpCode,
  OpCode,
  RoMatch,
  SubOpCode,
} from "@/lib/types";
import { isoDate } from "@/lib/periods";
import { saveEntry, deleteEntryAction, findDuplicateRos } from "@/app/actions/entries";
import { createLibraryOpCode } from "@/app/actions/op-codes";
import { uploadEntryPhoto } from "@/app/actions/entry-photos";
import { downscaleImage } from "@/lib/image";
import type { OpCodeDraft } from "./OpCodeModals";
import type { OcrResult } from "@/lib/ocr";
import { decodeVin, isValidVin } from "@/lib/vin";
import { tap } from "@/lib/haptics";

export type LineDraft = NewEntryOpCode & { key: string };

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
  const [isChecking, setIsChecking] = useState(false);
  const pendingAfterSave = useRef<(() => void) | undefined>(undefined);

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
    if (!autoFill) setMake("");
    setModel("");
    setVin("");
    setMileage("");
    setNotes("");
    setLines([]);
    setError(null);
    setVehicleOpen(false);
    setNotesOpen(false);
    setCapturedPhoto(null);
    setTimeout(() => roInputRef.current?.focus(), 50);
  }

  // The actual persist. No duplicate check here — callers gate that upstream.
  function performSave(afterSave?: () => void) {
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
            id: line.id, // undefined for new lines; existing lines keep their DB id
            opCodeId: line.opCodeId,
            custom: line.custom,
            customCode: line.customCode,
            customDescription: line.customDescription,
            flagHours: line.flagHours,
            actualHours: line.actualHours,
            notes: line.notes,
            position: i,
            subOpCodeId: line.subOpCodeId,
            laborType: line.laborType,
            paidHours: line.paidHours ?? null, // pass-through so edits never wipe it
          })),
        };
        if (onSave) {
          await onSave(input);
        } else {
          const saved = await saveEntry(input, existingEntry?.id);
          // Attach the scanned photo now that the entry has an id. Only new-RO
          // saves carry a capturedPhoto (the scan banner is hidden in edit mode).
          if (photosEnabled && capturedPhoto) {
            await uploadCapturedPhoto(saved.id, capturedPhoto);
            setCapturedPhoto(null);
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
