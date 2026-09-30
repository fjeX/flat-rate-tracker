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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RetroTimePrompt } from "@/components/forms/RetroTimePrompt";
import type { Entry, LaborType, NewEntry, OpCode, RoTemplate } from "@/lib/types";
import type { OpCodeDraft } from "./OpCodeModals";
import { Button } from "@/components/ui/Button";
import { Zone } from "@/components/ui/Zone";
import { Field } from "@/components/ui/Field";
import { withPt } from "@/components/ui/Figure";
import { PillInput } from "@/components/ui/PillInput";
import { Switch } from "@/components/ui/Switch";
import { DuplicateRoDialog } from "./DuplicateRoDialog";
import { useLogRoForm } from "./useLogRoForm";
import { RoScanSection } from "./RoScanSection";
import { OpCodeLines } from "./OpCodeLines";
import { ComebackSection } from "./ComebackSection";
import { VehicleFields } from "./VehicleFields";
import { LogIcon } from "./logParts";
import { StatusField } from "@/components/ui/StatusField";
import { roBlockedStatus } from "@/lib/ro-number";
import { CLOSE_DEFAULTS_TIMEOUT_MS, reloadPage } from "./closeDefaultsStall";
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

// This page is server-rendered (no `ssr: false`), and `useLayoutEffect` warns
// on the server ("does nothing on the server") — it only actually runs in the
// browser either way, so fall back to `useEffect` there and take the warning
// off the table. No shared isomorphic-layout-effect helper exists in this
// repo yet; this one mirror doesn't warrant adding one.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
  // The exact sentence THIS component last threw into the hook's `error` slot.
  // The error banner is shared with save/delete failures, so "is the warning on
  // screen still mine?" is answered by identity, not by a substring guess.
  const openDupErrorRef = useRef<string | null>(null);
  // Same idea, different sentence: the "your number moved, so the check I got
  // back answers a question you're no longer asking" abort. Kept in its own ref
  // so it clears on the next RO edit exactly like the warning does, without
  // borrowing the dup ref — that one also gates the two buttons under the
  // sentence, and this message must never show them.
  const openStaleErrorRef = useRef<string | null>(null);
  // What the RO field reads RIGHT NOW. findOpenRoAction is async and nothing
  // cancels it, so the closure that awaits it is already stale by the time the
  // answer lands — a ref is the only way to ask "is this still the number the
  // tech is typing?". Kept in sync by the onChange below (synchronously, so the
  // answer is right even before React commits) and by the effect under the hook
  // (which covers the programmatic setters: scan results, edit-load).
  const roNumberRef = useRef("");
  // Monotonic request id: only the newest open-check may act on its result, so
  // two overlapping checks can't have the older one win the race.
  const openDupCheckRef = useRef(0);

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
  // The other half of the flag timestamp (keep-flag-date-restamps-time). A
  // KEEP keeps the date AND the time the first close stored — the time is a
  // wall clock read relative to the date, so keeping one and re-stamping the
  // other to "now" writes a moment that never happened. "" when the first
  // close recorded no time: an empty pill honestly says "no time recorded",
  // where filling in now would invent one (and on the OLD flag day, at that).
  const [currentFlagTime, setCurrentFlagTime] = useState("");
  // Client-only (grep: it is read nowhere but the two radios' `checked` below —
  // closeTicketAction is handed `input.date` and nothing else). So it is a
  // DESCRIPTION of the date pill, never a second source of truth for it, and it
  // has to follow the pill when the tech edits the pill directly. "custom" is
  // the third state that state of affairs needs: a date that is neither the
  // ticket's flag date nor today leaves BOTH radios unchecked, which is the
  // honest reading — the tech picked something the two options don't describe.
  // The alternative (force-checking "move" for any non-keep date) would put a
  // radio labelled "Move to today (Sep 16)" next to a pill reading Sep 12.
  const [dateChoice, setDateChoice] = useState<"keep" | "move" | "custom">("keep");
  // --- close: have the defaults landed? ------------------------------------
  // Everything above (reopened, the flag date and time, the prefill) arrives
  // from ONE async fetch, and until it lands the form is showing a FIRST
  // close's defaults: today, and now. On a reopened ticket that is precisely
  // the silent move of paid hours decision 11 exists to prevent — and it used
  // to be one fast tap (or one swallowed fetch error) away. So a close cannot
  // be saved until the fetch has answered for THIS ticket. A first close waits
  // too, because "it's a first close" is itself part of the answer; the fetch
  // is one round trip, and the tech still has op codes to add before Close
  // means anything, so the wait is invisible in practice.
  //
  // Stored WITH the id it describes, so "ready" can never be read off a
  // different ticket's fetch. No result for this id ⇒ still loading.
  const closeEntryId = closing && existingEntry ? existingEntry.id : null;
  // `stalled`: a "failed" that came from the timeout, not from an answer. The
  // request is still hanging, and Next queues server actions one at a time,
  // so "Try again" would queue behind it and hang too — the copy offers a
  // reload instead (see closeDefaultsStall.ts).
  const [closeDefaultsResult, setCloseDefaultsResult] = useState<{
    id: string;
    status: "ready" | "failed";
    stalled?: boolean;
  } | null>(null);
  const closeDefaultsStalled =
    closeDefaultsResult?.id === closeEntryId && closeDefaultsResult?.stalled === true;
  // Bumped by "Try again": the fetch effect's only trigger besides the id.
  const [closeDefaultsAttempt, setCloseDefaultsAttempt] = useState(0);
  const closeDefaultsState: "idle" | "loading" | "ready" | "failed" =
    closeEntryId === null
      ? "idle"
      : closeDefaultsResult?.id === closeEntryId
        ? closeDefaultsResult.status
        : "loading";
  const closeBlocked = closing && closeDefaultsState !== "ready";
  // The date/time pills are read-only until the defaults land. On a reopened
  // close the fetch below REPLACES both (keep the flag date, restore its
  // stored time), so anything typed before it answered was silently thrown
  // away — Save was already blocked, but the typing wasn't. Every close waits,
  // not just a reopened one, because "reopened?" is what the fetch answers.
  // Never stuck: a failed fetch is "failed", not "loading", and unlocks the
  // pills (Save stays blocked behind "Try again"). So is one that never
  // answers — CLOSE_DEFAULTS_TIMEOUT_MS turns it into a stalled "failed".
  // Idle outside close mode.
  const dateTimeLocked = closing && closeDefaultsState === "loading";
  // The entry id the defaults were last APPLIED for. The seeding (keep the
  // flag date, restore the stored time) is a starting point, not a rule: once
  // it has run, everything on screen is the tech's. See the fetch effect.
  const closeSeededForRef = useRef<string | null>(null);

  // What the hook persists with, per mode. Declared before the hook so the
  // closure reads the CURRENT mode on every save — performSave is rebuilt each
  // render, so it always sees the latest of these.
  const ticketSave = ticketMode || closing
    ? async (input: NewEntry) => {
        if (openCreate) {
          const ro = input.roNumber.trim();
          if (!openDupAcknowledged) {
            const checkId = ++openDupCheckRef.current;
            const open = await findOpenRoAction(ro);
            // A late answer is inert. If the tech corrected the number while
            // the check was in flight, this result describes an RO that is no
            // longer on screen — posting it would put the same stale sentence
            // (and its two buttons) over a field reading something else.
            //
            // But the answer expiring does NOT mean the save may proceed. Every
            // value in `input` — the RO number above all — was captured when
            // Save was clicked, so continuing would write a ticket under the
            // OLD number with the duplicate check skipped, and then navigate
            // away as if it worked. That is exactly the double-open-ticket the
            // check exists to prevent. So: abort, write nothing, go nowhere.
            // performSave treats a plain `return` as success and pushes the
            // redirect, so the abort has to be a throw — it lands in the same
            // error slot, and the next keystroke on the RO field clears it.
            const stale =
              checkId !== openDupCheckRef.current || roNumberRef.current.trim() !== ro;
            if (stale) {
              const message =
                "The RO number changed while FRT was checking it — press Open ticket again.";
              openStaleErrorRef.current = message;
              throw new Error(message);
            }
            if (open.length > 0) {
              setOpenDup(open[0]);
              const message = `RO ${ro} is already open. View it, or open another ticket under the same number.`;
              openDupErrorRef.current = message;
              throw new Error(message);
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
          // Belt and braces with the disabled button: never close on the
          // placeholder defaults (see closeDefaultsState). A throw, not a
          // return — performSave treats a return as success and navigates away.
          if (closeDefaultsState !== "ready") {
            throw new Error(
              "This ticket's close details haven't loaded yet — nothing was saved.",
            );
          }
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
    isEdit, savedRoNumber, abandonedRoNumber, date, setDate, roNumber, setRoNumber, error, setError, roInputRef,
    loggedTime, setLoggedTime, trackRoTime: timeFieldShown,
    library, handleScanResult, lines, search, setSearch, pickerOpen, setPickerOpen,
    pickerRef, filteredLibrary, totalFlag, quickChips, roState, customOpen, setCustomOpen,
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
    // (seeded through the existingEntry override above — plan risk #3). A
    // REOPENED close then swaps in the stored time once the defaults land.
    trackRoTime, defaultLoggedTime, timeZone,
  });
  // A cleared date pill leaves dateChoice where it was (the date onChange
  // returns early on ""), so retyping the same day doesn't restamp the time.
  // But the radios must not SHOW that stale choice: Keep ticked beside an
  // empty pill is a lie, and a click on an already-checked radio fires no
  // onChange — so Keep couldn't restore the date. Render both unchecked while
  // the pill is empty; either click then restores its date and time.
  const dateCleared = date === "";

  // Fetches the close defaults (decision 6's prefill, decision 11's reopened
  // flag). Below the hook call, not above, because a reopened ticket's
  // default is `setDate(d.currentDate)` — overriding the today the hook just
  // seeded the field with — and `setDate` doesn't exist until the hook runs.
  // Mirrors the RO field into the ref the async open-check compares against.
  useEffect(() => {
    roNumberRef.current = roNumber;
  }, [roNumber]);

  // Same mirror-into-a-ref move for the close-defaults effect below: it only
  // READS this at seed time (inside the async callback, after the fetch
  // answers), so it doesn't need to be a dependency that reruns the effect.
  // Making it one used to be an actual bug — see the ref's own comment.
  //
  // Mirrored in a LAYOUT effect, not a passive one: the async callback below
  // resumes on a microtask (the line after `await getCloseDefaultsAction(...)`),
  // and a passive effect is scheduled as a macrotask — it can still be sitting
  // unflushed when that microtask runs. If a `trackRoTime` prop flip commits
  // in the very render whose fetch settles, a passive-effect mirror would
  // read the PREVIOUS render's value here: false→true would skip seeding the
  // now-visible time field with the stored time, so Save falls back to "now"
  // — exactly the bug the keep-close-time fix (09-27) targets. Layout effects
  // flush synchronously right after commit, before the browser (and any
  // already-queued microtask) gets a turn, so the ref is always current by
  // the time that continuation reads it. (Render-time assignment was tried
  // first — `react-hooks/refs` rejects writing a ref during render outright.)
  const timeFieldShownRef = useRef(timeFieldShown);
  useIsomorphicLayoutEffect(() => {
    timeFieldShownRef.current = timeFieldShown;
  }, [timeFieldShown]);

  // Keyed on the entry ID, not the existingEntry object. The page hands this
  // component a fresh object on every server re-render (adding a new library
  // op code revalidates /log mid-close), and keying on identity re-ran the
  // seeding each time — snapping the date, the radio and a hand-typed time
  // back to the defaults under the tech's fingers. The ref makes "once per
  // ticket" hold even if some other dep here ever changes; a FAILED fetch
  // never sets it, so "Try again" still seeds.
  //
  // `timeFieldShown` (the trackRoTime prop) is read via a ref, not listed as
  // a dep, on purpose — it used to be a dep, and that was a real bug: if it
  // flipped while a fetch was STALLED (not yet seeded, so the guard above
  // doesn't stop the effect), this whole block re-ran as a second attempt
  // with a fresh `stalled = false`. The first attempt's late answer is inert
  // (the cleanup below sets its `cancelled`), but the second attempt's own
  // fetch could then land inside ITS 15s window and seed for real — silently
  // overwriting whatever the tech had typed into the now-unlocked pills,
  // exactly like the answer this effect exists to keep out. This value is
  // only ever consulted at seed time (inside the async callback, after the
  // fetch answers), so a ref gets the current value there without making it
  // a trigger for re-running the fetch at all.
  useEffect(() => {
    if (closeEntryId === null) return;
    if (closeSeededForRef.current === closeEntryId) return;
    // `cancelled`: this attempt is over because the effect re-ran ("Try again"
    // bumped the attempt, or the ticket changed) or the form unmounted. Each
    // attempt is its own effect run with its own flag, so attempt N's late
    // answer can never land on attempt N+1.
    let cancelled = false;
    // `stalled`: the timeout already answered "failed" for THIS attempt. The
    // pills are unlocked and the tech may be typing in them, so a late answer
    // must not seed anything — the seeding below overwrites both pills.
    let stalled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      stalled = true;
      setCloseDefaultsResult({ id: closeEntryId, status: "failed", stalled: true });
    }, CLOSE_DEFAULTS_TIMEOUT_MS);
    (async () => {
      try {
        const d = await getCloseDefaultsAction(closeEntryId);
        if (cancelled) return;
        if (stalled) {
          // Late, and inert: none of it is applied. But the request HAS now
          // settled, which frees Next's action queue — so an in-place retry
          // works again. Downgrade the reload prompt to plain "Try again".
          setCloseDefaultsResult({ id: closeEntryId, status: "failed" });
          return;
        }
        clearTimeout(timer);
        closeSeededForRef.current = closeEntryId;
        setPrefill(d.prefill);
        setPrefillHours(d.prefill.actualHours > 0 ? String(d.prefill.actualHours) : "");
        setReopened(d.reopened);
        setCurrentFlagDate(d.currentDate);
        if (d.reopened) {
          // Never move paid hours silently (decision 11): default to KEEP,
          // overriding the today the hook otherwise seeds a close with.
          setDateChoice("keep");
          setDate(d.currentDate);
          // Same override for the time the hook seeded with now — but only
          // when the time field is on screen. With the setting off the hook
          // never sends a time at all, so there is nothing to restore.
          //
          // This lands after the form mounts, and it overwrites both pills.
          // That is safe only because the date and time pills are DISABLED
          // while closeDefaultsState is "loading" (see dateTimeLocked below):
          // nothing the tech could have typed exists yet to be overwritten.
          const stored = d.currentTime ?? "";
          setCurrentFlagTime(stored);
          if (timeFieldShownRef.current) setLoggedTime(stored);
        }
        setCloseDefaultsResult({ id: closeEntryId, status: "ready" });
      } catch {
        // NOT silent any more. Without this answer the form can't know whether
        // the ticket was reopened, so saving would fall back to today + now —
        // the silent move. Block the close, say so, offer a retry (which
        // re-runs this whole seeding, prefill included).
        // A late rejection after the timeout lands here too: same plain
        // "failed", now without the stall (the queue is free again).
        if (cancelled) return;
        clearTimeout(timer);
        setCloseDefaultsResult({ id: closeEntryId, status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [closeEntryId, closeDefaultsAttempt, setDate, setLoggedTime]);

  const title = openCreate
    ? "Open a ticket"
    : closing
      ? `Close ticket #${existingEntry!.roNumber}`
      : editingOpen
        ? `Edit ticket #${existingEntry!.roNumber}`
        : isEdit
          ? `Edit RO #${existingEntry!.roNumber}`
          : "New repair order";

  // Retracts the "already open" warning once it no longer describes the form —
  // the tech changed the number, or took the "open another anyway" override.
  // ONLY that sentence: `error` also carries save and delete failures, and
  // wiping one of those because the tech edited a field would hide a message
  // they still need. Identity check, so a save failure that landed AFTER the
  // warning survives too.
  // Also retracts the stale-check abort, for the same reason: it says "press
  // Open ticket again", and typing a new number is the tech doing precisely
  // that groundwork — leaving it up would scold them for the edit they just
  // made. Both sentences are cleared by identity only.
  function clearOpenDupWarning() {
    for (const ref of [openDupErrorRef, openStaleErrorRef]) {
      const mine = ref.current;
      if (mine === null) continue;
      ref.current = null;
      if (error === mine) setError(null);
    }
  }

  // Step numbers are POSITIONS, derived from the steps that actually render.
  // The op-code step is hidden in ticket mode, so hard-coded numerals made the
  // tech read "1, 3, 4". `steps` is the single source of truth — add a step
  // here and to the JSX in the same order and the numbering stays right in
  // every mode. (Unpaid rework is not in the list on purpose: its badge is an
  // icon, not a number.)
  const steps: string[] = ["ro", ...(ticketMode ? [] : ["opCodes"]), "vehicle", "notes"];
  const stepNum = (id: string) => steps.indexOf(id) + 1;

  const saveLabel = isChecking
    ? "Checking…"
    : isSubmitting
      ? "Saving…"
      : closing && closeDefaultsState === "loading"
        ? "Loading ticket…"
        : openCreate
        ? "Open ticket"
        : closing
          ? "Close ticket"
          : editingOpen
            ? "Save ticket"
            : isEdit
              ? "Save Changes"
              : "Save RO";

  // "Four steps. Only the RO number is required." — the count follows the steps
  // that actually render (ticket mode drops the op-code step). New RO only:
  // an edit has no such promise to make.
  const STEP_WORDS = ["", "One step", "Two steps", "Three steps", "Four steps"];
  const subtitle = !isEdit
    ? `${STEP_WORDS[steps.length] ?? `${steps.length} steps`}. Only the RO number is required.`
    : null;

  // The "Before you start" zone holds what is set up before the RO itself:
  // date and time, the open-ticket switch, the close details, the scan. It is
  // left out when none of them apply (editing an open ticket).
  const showWhen = !ticketMode;
  const showOpenToggle = !isEdit && openTicketEnabled;
  const showScan = !isEdit && !openCreate;
  const hasBefore = showWhen || showOpenToggle || closing || showScan;

  // Empty or non-digit RO blocks Save (and Save & New). The status text says which.
  const roBlocked = roBlockedStatus(roState);

  const vehicleTail = vehicleSummary ? ` · ${vehicleSummary}` : "";

  return (
    <main className="log-page">
      {/* ---- Save & New confirmation ---- */}
      {savedRoNumber && (
        <StatusField tag="Saved" className="log-flow is-top">
          <p>RO #{savedRoNumber} saved ✓</p>
        </StatusField>
      )}

      {/* ---- Page title ---- */}
      <div className="log-head">
        <div className="log-head-txt">
          <h1 id="log-h1">{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>

      <div className={`log-grid${hasBefore ? "" : " is-solo"}`}>
        {hasBefore && (
          <Zone name="Before you start" className="log-before">
            {/* No date on a ticket: the opened day is the server's today and the
                flag day is chosen at close. In close mode this IS the flag day. */}
            {showWhen && (
              <div className="log-when">
                <Field label={closing ? "Close date" : "Date"} htmlFor="ro-date">
                  <PillInput
                    id="ro-date"
                    type="date"
                    value={date}
                    disabled={dateTimeLocked}
                    aria-describedby={dateTimeLocked ? "close-defaults-loading" : undefined}
                    onChange={(e) => {
                      setDate(e.target.value);
                      // An empty value is not a choice. A date input reports "" both
                      // when cleared and while a typed date is incomplete, and
                      // reading that as "custom" meant clear-then-retype the flag
                      // date went custom → keep: a "change" of choice that restamped
                      // the stored time over one the tech had typed by hand. Leave
                      // the choice (and the time) where it was until there's a date.
                      if (e.target.value === "") return;
                      // On a reopened close the radios are on screen beside this
                      // pill, and the pill is what actually gets saved. Editing it
                      // used to leave a radio checked that contradicted the saved
                      // date ("Keep flag date Sep 12" ticked over a pill reading Sep
                      // 16). Keep the radios honest about the date instead.
                      // Keep wins a tie: if the ticket was reopened and closed again
                      // the same day, "keep" is the default and the safer reading.
                      const next =
                        e.target.value === currentFlagDate
                          ? "keep"
                          : e.target.value === today
                            ? "move"
                            : "custom";
                      // Typing a date that lands on one of the radios IS choosing
                      // that radio, so it carries that radio's time too. Otherwise
                      // Move (time = now) then typing the flag date back by hand
                      // ticked Keep while saving the flag day at NOW — the original
                      // half-a-keep bug through a side door.
                      //
                      // Only when the choice actually CHANGES: re-typing the date the
                      // choice already describes must not wipe a time the tech typed.
                      // And "custom" leaves the time alone: neither the stored time
                      // (a moment on the flag day) nor now (a moment on today) is
                      // known to belong to an arbitrary third day, and the tech is
                      // looking at the time pill right beside the date they just
                      // typed — whatever it reads is the least surprising thing to
                      // save. Reopened only: on a first close the radios aren't
                      // shown and currentFlagTime was never loaded.
                      if (reopened && timeFieldShown && next !== dateChoice) {
                        if (next === "keep") setLoggedTime(currentFlagTime);
                        else if (next === "move") setLoggedTime(defaultLoggedTime);
                      }
                      setDateChoice(next);
                    }}
                    required
                    aria-required="true"
                  />
                </Field>
                {/* Sits beside the date because it IS part of the date — a wall-clock
                    time on that day, not an independent fact. Not `required`: clearing
                    it is a legitimate answer ("I don't remember when"), and an empty box
                    saves as no time rather than blocking the RO. */}
                {timeFieldShown && (
                  <Field label="Time" htmlFor="ro-time">
                    <PillInput
                      id="ro-time"
                      type="time"
                      value={loggedTime}
                      disabled={dateTimeLocked}
                      aria-describedby={dateTimeLocked ? "close-defaults-loading" : undefined}
                      onChange={(e) => setLoggedTime(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            )}

            {/* ---- Close-mode prefill banner ---- */}
            {closing && (
              <div className="log-tool is-stack" data-testid="close-prefill">
                <div className="log-tool-txt">
                  <p className="log-lead">Closing this ticket</p>
                  <p className="log-sub">
                    Add the op codes and flag hours below. The flag lands on the close
                    date above.
                  </p>
                </div>
                {/* Second close (decision 11): keep the flag date the first close
                    set, or move it to today. KEEP is the default — a reopen must
                    never silently move paid hours off the day they were paid. The
                    date pill above stays editable either way; these just pick
                    which day it starts on. */}
                {reopened && currentFlagDate && today && (
                  <fieldset className="log-fieldset log-tool-row" data-testid="reopen-date-choice">
                    <legend className="log-sub log-legend">
                      This ticket was reopened. Keep the flag date, or move it to today?
                    </legend>
                    <div className="log-opts">
                      <label className="log-opt">
                        <input
                          type="radio"
                          name="close-date-choice"
                          // Unchecked while the date pill is empty (see dateCleared).
                          checked={!dateCleared && dateChoice === "keep"}
                          onChange={() => {
                            setDateChoice("keep");
                            setDate(currentFlagDate);
                            // The whole flag timestamp, not just its day.
                            if (timeFieldShown) setLoggedTime(currentFlagTime);
                          }}
                        />
                        <span className="log-opt-box">
                          <span className="log-opt-txt">
                            <span className="log-opt-name">Keep flag date {formatDateLong(currentFlagDate)}</span>
                          </span>
                          <LogIcon name="check" small className="log-opt-check" />
                        </span>
                      </label>
                      <label className="log-opt">
                        <input
                          type="radio"
                          name="close-date-choice"
                          checked={!dateCleared && dateChoice === "move"}
                          onChange={() => {
                            setDateChoice("move");
                            setDate(today);
                            // A moved flag is a fresh close: the same now-time a
                            // first close opens with.
                            if (timeFieldShown) setLoggedTime(defaultLoggedTime);
                          }}
                        />
                        <span className="log-opt-box">
                          <span className="log-opt-txt">
                            <span className="log-opt-name">Move to today ({formatDateLong(today)})</span>
                          </span>
                          <LogIcon name="check" small className="log-opt-check" />
                        </span>
                      </label>
                    </div>
                  </fieldset>
                )}
                {closeDefaultsState === "failed" ? (
                  // Replaces the prefill text, which would otherwise claim "no
                  // hours were logged" — the fetch that failed is the one that
                  // carries the hours, so the honest statement is "unknown".
                  <StatusField
                    tone="bad"
                    tag="Fix"
                    inset
                    id="close-defaults-error"
                    role="alert"
                    className="log-tool-row"
                  >
                    <p>
                      Couldn&apos;t load this ticket&apos;s close details, so closing is
                      paused — FRT can&apos;t tell yet whether it was reopened.
                      {closeDefaultsStalled && (
                        // Not "Try again": the stuck request still holds Next's
                        // server-action queue, so a retry would wait behind it.
                        <>
                          {" "}The connection stopped answering, and FRT can&apos;t ask
                          again until the page reloads. Reloading clears anything
                          typed on this form.
                        </>
                      )}
                    </p>
                    <div className="sfield-act">
                      {closeDefaultsStalled ? (
                        <Button variant="line" size="sm" onClick={reloadPage}>
                          Reload page
                        </Button>
                      ) : (
                        <Button
                          variant="line"
                          size="sm"
                          onClick={() => {
                            // No result for this id ⇒ "loading" again; then refetch.
                            setCloseDefaultsResult(null);
                            setCloseDefaultsAttempt((n) => n + 1);
                          }}
                        >
                          Try again
                        </Button>
                      )}
                    </div>
                  </StatusField>
                ) : closeDefaultsState === "loading" ? (
                  <p id="close-defaults-loading" role="status" className="log-sub log-tool-row">
                    Loading this ticket&apos;s timeline…
                  </p>
                ) : prefill && prefill.actualHours > 0 ? (
                  <div className="log-prefill log-tool-row">
                    <div className="log-sub">
                      Timeline says <b>{fmtHours(prefill.actualHours)}h</b> worked
                      {prefill.actualSource === "estimate" && (
                        <span> (typed, so it&apos;s an estimate)</span>
                      )}
                      . Put it on:
                    </div>
                    <div className="log-prefill-fields">
                      <label className="field">
                        <span className="field-label">Line</span>
                        <select
                          className="input"
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
                      <label className="field">
                        <span className="field-label">Actual hours</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          inputMode="decimal"
                          className="input mono"
                          value={prefillHours}
                          onChange={(e) => setPrefillHours(e.target.value)}
                          aria-label="Actual hours to put on that line"
                        />
                      </label>
                    </div>
                    {prefill.excludedHoldHours > 0 && (
                      <p className="log-sub">
                        Waiting isn&apos;t wrenching: {fmtHours(prefill.excludedHoldHours)}h of hold time on this
                        ticket is not in that figure.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="log-sub log-tool-row">
                    No hours were logged on this ticket&apos;s timeline, so nothing is prefilled.
                  </p>
                )}
              </div>
            )}

            {/* ---- Open-ticket toggle (new RO, signed in) ---- */}
            {showOpenToggle && (
              <div className="log-tool">
                <div className="log-tool-txt">
                  <p className="log-lead">Open ticket — no op codes yet</p>
                  <p className="log-sub">
                    For a job that spans days. Log the hours per day; flag it when the codes are known.
                  </p>
                </div>
                <Switch
                  checked={openToggle}
                  onChange={setOpenToggle}
                  // MUST match the visible label word for word (WCAG 2.5.3).
                  label="Open ticket — no op codes yet"
                />
              </div>
            )}

            {/* ---- Scan (new RO only) ---- */}
            {showScan && (
              <RoScanSection
                library={library}
                templates={roTemplates ?? []}
                onResult={handleScanResult}
                onPhotoCaptured={photosEnabled ? handlePhotoCaptured : undefined}
                photoAttached={photosEnabled && photoAttached}
                onPhotoRemove={photosEnabled ? clearCapturedPhoto : undefined}
              />
            )}
          </Zone>
        )}

        <Zone name={ticketMode ? "Open ticket" : "Repair order"} className="log-steps">
          <div className="log-panel">
          {/* ---- RO number (step 1 in every mode) ---- */}
          <div className="log-step">
            <div className="log-step-head">
              <span className="log-step-no">{stepNum("ro")}</span>
              <h3 className="log-step-title">Enter the RO number</h3>
              <span className="log-step-aside">required</span>
            </div>
            <div className="log-step-body">
              <label htmlFor="ro-number" className="sr-only">RO number</label>
              <div className="log-ro">
                <span aria-hidden="true">#</span>
                <input
                  id="ro-number"
                  ref={roInputRef}
                  type="text"
                  value={roNumber}
                  onChange={(e) => {
                    // Synchronously, ahead of the state update: an open-check that
                    // resolves before React commits must still see the new number.
                    roNumberRef.current = e.target.value;
                    setRoNumber(e.target.value);
                    // A new number is a new question — including the sentence, not
                    // just the buttons under it. The warning names the OLD RO, so
                    // leaving it up accuses a number the tech is no longer typing.
                    setOpenDup(null);
                    setOpenDupAcknowledged(false);
                    clearOpenDupWarning();
                  }}
                  required
                  aria-required="true"
                  aria-invalid={roState === "invalid" || Boolean(error)}
                  aria-describedby={
                    roState === "invalid" ? "ro-digits-error" : error ? "ro-save-error" : undefined
                  }
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="12345"
                  className="input mono"
                />
              </div>
              {/* The FIX state, directly under the field (mock #ro-err). role=alert
                  is announced when it mounts. Digits only: lib/ro-number.ts. */}
              {roState === "invalid" && (
                <StatusField tag="Fix" inset id="ro-digits-error" role="alert">
                  <p>RO numbers are digits only. Take out the letters, then save.</p>
                </StatusField>
              )}
            </div>
          </div>

          {/* ---- Op codes (hidden while the ticket is open, which renumbers what follows) ---- */}
          {!ticketMode && (
            <OpCodeLines
              step={stepNum("opCodes")}
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

          {/* ---- Vehicle (collapsible) ---- */}
          <VehicleFields
            step={stepNum("vehicle")}
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

          {/* ---- Notes (collapsible) ---- */}
          <div className={`log-step is-fold${notesOpen ? " is-open" : ""}`}>
            <button
              type="button"
              className="log-step-head"
              onClick={() => setNotesOpen((v) => !v)}
              aria-expanded={notesOpen}
              aria-controls="notes-step-body"
            >
              <span className="log-step-no">{stepNum("notes")}</span>
              <span className="log-step-title">Write notes</span>
              <span className="log-step-aside">
                {notes && !notesOpen ? <span className="log-step-sum">{notes}</span> : "optional"}
                <LogIcon name="chev" small className="chev" />
              </span>
            </button>

            {notesOpen && (
              <div className="log-step-body" id="notes-step-body">
                <label htmlFor="ro-notes" className="sr-only">Notes</label>
                <textarea
                  id="ro-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Customer concern, parts ordered, follow-up needed…"
                  className="input"
                />
              </div>
            )}
          </div>
          </div>
        </Zone>
      </div>

      {/* ---- Error ---- */}
      {error && (
        <StatusField tag="Fix" id="ro-save-error" role="alert" className="log-flow">
          <p>{error}</p>
          {/* The "already open" warning offers the jump and the override the
              plan asks for. Both sit inside the alert so a screen reader hears
              the choice with the sentence. */}
          {openCreate && openDup && (
            <div className="sfield-act">
              <Button variant="line" size="sm" onClick={() => setViewDup(true)}>
                View open ticket
              </Button>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => {
                  setOpenDupAcknowledged(true);
                  setOpenDup(null);
                  // Same staleness as the RO-number edit: taking the override
                  // answers the warning, so the sentence goes with the buttons.
                  clearOpenDupWarning();
                }}
              >
                Open another under #{openDup.roNumber}
              </Button>
            </div>
          )}
        </StatusField>
      )}

      {/* ---- Backed out of the duplicate prompt: the RO was NOT saved ----
           Sits directly above the save bar because that is where the tech is
           looking when they expect the confirmation. A NOTE, not a FIX: nothing
           failed, but nothing was written either. ---- */}
      {abandonedRoNumber && (
        <StatusField tag="Note" role="status" className="log-flow">
          <p>
            Not saved — RO #{abandonedRoNumber} already exists. Save again to pick
            Edit or Log as new, or change the RO number.
          </p>
        </StatusField>
      )}

      {/* ---- Save bar ---- */}
      <div className={`save-bar${isEdit ? " is-edit" : ""}`}>
        <div className="summary" aria-live="polite">
          {roBlocked === null ? (
            ticketMode ? (
              <>
                <b>{openCreate ? "Open ticket" : "Ticket"}</b>
                <span>RO <span className="num">#{roNumber}</span>{vehicleTail}</span>
              </>
            ) : (
              <>
                <b>
                  <span className="num">{withPt(`${fmtHours(totalFlag)}h`)}</span> · {lines.length} line{lines.length !== 1 ? "s" : ""}
                </b>
                <span>RO <span className="num">#{roNumber}</span>{vehicleTail}</span>
              </>
            )
          ) : (
            roBlocked
          )}
        </div>
        {isEdit && (
          <Button
            variant="danger"
            size="sm"
            onClick={handleDeleteRo}
            disabled={isDeleting || isSubmitting}
            className="log-del"
          >
            {isDeleting ? "Deleting…" : editingOpen ? "Delete ticket" : "Delete RO"}
          </Button>
        )}
        {isEdit && (
          <Link href="/dashboard" className="btn btn-quiet btn-sm">
            Cancel
          </Link>
        )}
        {!isEdit && !openCreate && (
          <Button
            variant="line"
            size="sm"
            onClick={handleSaveAndNew}
            disabled={isSubmitting || isChecking || roState !== "ok"}
          >
            Save & New
          </Button>
        )}
        <Button
          variant="go"
          size="sm"
          onClick={() => handleSave()}
          // closeBlocked: see closeDefaultsState. Same `disabled` idiom as
          // the in-flight states, plus aria-busy while the fetch runs and a
          // pointer to the reason when it failed.
          disabled={isSubmitting || isChecking || closeBlocked || roState !== "ok"}
          busy={closing && closeDefaultsState === "loading"}
          aria-describedby={
            closing && closeDefaultsState === "failed" ? "close-defaults-error" : undefined
          }
          data-testid="ro-save"
        >
          {saveLabel}
        </Button>
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
