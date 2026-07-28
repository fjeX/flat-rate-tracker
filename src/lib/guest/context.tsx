"use client";

import { createContext, useContext, useEffect, useReducer } from "react";
import type { Entry, NewEntry, OpCode, UserSettings } from "@/lib/types";
import type { OpCodeDraft } from "@/components/forms/OpCodeModals";
import { STARTER_OP_CODES } from "@/lib/starter-opcodes";
import {
  bucketFor,
  flushAccumulators,
  msToHours,
  nextFreeSlot,
  type TimerSlot,
  type TimerStatus,
} from "@/lib/timer";

const STORAGE_KEY = "frt_guest";

type GuestState = {
  entries: Entry[];
  opCodes: OpCode[];
  // Mirrors the signed-in `active_timers` table, in memory. Guest mode gets the
  // same 3 concurrent slots and the same statuses — it's the clearest demo of
  // what the app does — but NOT the unpaid-time ledger. Waiting time shows
  // while the tab is open and then evaporates, matching how every other pay
  // feature (bonuses, reconciliation, wage-check) is signed-in-only.
  timers: TimerSlot[];
  // Guest mode gets ONE flat rate, no labor types — just enough to preview the
  // dollar figures a signed-in user unlocks with per-type rates. null = unset.
  hourlyRate: number | null;
};

type GuestAction =
  | { type: "ADD"; entry: Entry }
  | { type: "ADD_OPCODE"; opCode: OpCode }
  | { type: "DELETE_OPCODE"; id: string }
  | { type: "EDIT_OPCODE"; id: string; patch: Pick<OpCode, "code" | "description" | "flagHours" | "notes" | "tags"> }
  | { type: "HYDRATE"; state: GuestState }
  | { type: "TIMER_ATTACH"; id: string; slot: number; entryId: string; lineId: string | null; now: number }
  | { type: "TIMER_SET_STATUS"; id: string; status: TimerStatus; now: number }
  | { type: "TIMER_SET_LINE"; id: string; lineId: string | null }
  | { type: "TIMER_RESET"; id: string; now: number }
  | { type: "TIMER_RELEASE"; id: string }
  | { type: "TIMER_SAVE"; id: string; lineId: string; now: number }
  | { type: "UPDATE_ENTRY_HOURS"; entryId: string; lineId: string; actualHours: number }
  | { type: "SET_RATE"; hourlyRate: number | null }
  | { type: "DELETE_ENTRY"; id: string };

const defaultSettings: UserSettings = {
  userId: "guest",
  splitDay: 15,
  goalHours: 88,
  periodOverrides: {},
  updatedAt: new Date().toISOString(),
  roTemplates: [],
  defaultLaborType: null,
  referenceHourlyRate: null,
  tagColors: {},
};

// Demo tags so the guest library shows off grouping out of the box.
const GUEST_SAMPLE_TAGS: Record<string, string[]> = {
  OIL: ["Fluids", "Quick"],
  DIAG: ["Diagnostics"],
  INSP: ["Inspection", "Quick"],
  "TIRE-ROT": ["Tires", "Quick"],
  "ALN-4": ["Tires"],
  "BRK-FR": ["Brakes"],
  "BRK-RR": ["Brakes"],
  "BRK-FL": ["Brakes", "Fluids"],
  "AC-RCH": ["A/C"],
  "COOL-FL": ["Fluids"],
  "TRANS-FL": ["Fluids"],
  "SUSP-STR": ["Suspension"],
};

export const GUEST_SAMPLE_OPCODES: OpCode[] = STARTER_OP_CODES.map((s, i) => ({
  id: `g-${i + 1}`,
  userId: "guest",
  code: s.code,
  description: s.description,
  flagHours: s.flagHours,
  notes: "",
  tags: GUEST_SAMPLE_TAGS[s.code] ?? [],
  sortOrder: i,
  createdAt: "",
  subOpCodes: [],
}));

const initialState: GuestState = {
  entries: [],
  opCodes: GUEST_SAMPLE_OPCODES,
  timers: [],
  hourlyRate: null,
};

/** Bank a slot's in-flight time and stop its clock. Guest mode has no work
 * schedule, so there's no auto-stop cap to apply. */
function banked(slot: TimerSlot, now: number): TimerSlot {
  return {
    ...slot,
    ...flushAccumulators(slot, now),
    status: "paused",
    startTime: null,
  };
}

/** Only one slot may be `working` — same rule as the server, same reason: one
 * pair of hands can't bank two streams of productive time at once. */
function pauseOtherWorking(
  timers: TimerSlot[],
  exceptId: string,
  now: number,
): TimerSlot[] {
  return timers.map((t) =>
    t.id !== exceptId && t.status === "working" ? banked(t, now) : t,
  );
}

function reducer(state: GuestState, action: GuestAction): GuestState {
  switch (action.type) {
    case "ADD":
      return { ...state, entries: [action.entry, ...state.entries] };
    case "ADD_OPCODE":
      return { ...state, opCodes: [...state.opCodes, action.opCode] };
    case "DELETE_OPCODE":
      return { ...state, opCodes: state.opCodes.filter((op) => op.id !== action.id) };
    case "EDIT_OPCODE":
      return {
        ...state,
        opCodes: state.opCodes.map((op) =>
          op.id === action.id ? { ...op, ...action.patch } : op,
        ),
      };
    case "HYDRATE":
      return action.state;

    case "TIMER_ATTACH": {
      const timers = pauseOtherWorking(state.timers, action.id, action.now);
      return {
        ...state,
        timers: [
          ...timers,
          {
            id: action.id,
            slot: action.slot,
            entryId: action.entryId,
            lineId: action.lineId,
            status: "working" as const,
            startTime: action.now,
            workAccumulated: 0,
            holdPartsAccumulated: 0,
            holdApprovalAccumulated: 0,
          },
        ].sort((a, b) => a.slot - b.slot),
      };
    }

    case "TIMER_SET_STATUS": {
      const base =
        action.status === "working"
          ? pauseOtherWorking(state.timers, action.id, action.now)
          : state.timers;
      return {
        ...state,
        timers: base.map((t) =>
          t.id !== action.id
            ? t
            : {
                ...t,
                ...flushAccumulators(t, action.now),
                status: action.status,
                // Paused banks nothing, so it carries no clock.
                startTime: bucketFor(action.status) === null ? null : action.now,
              },
        ),
      };
    }

    case "TIMER_SET_LINE":
      return {
        ...state,
        timers: state.timers.map((t) =>
          t.id === action.id ? { ...t, lineId: action.lineId } : t,
        ),
      };

    case "TIMER_RESET":
      return {
        ...state,
        timers: state.timers.map((t) =>
          t.id !== action.id
            ? t
            : {
                ...t,
                workAccumulated: 0,
                holdPartsAccumulated: 0,
                holdApprovalAccumulated: 0,
                startTime: bucketFor(t.status) === null ? null : action.now,
              },
        ),
      };

    case "TIMER_RELEASE":
      return { ...state, timers: state.timers.filter((t) => t.id !== action.id) };

    case "TIMER_SAVE": {
      const slot = state.timers.find((t) => t.id === action.id);
      if (!slot) return state;
      const { workAccumulated } = flushAccumulators(slot, action.now);
      const addHours = msToHours(workAccumulated);
      const entries = state.entries.map((entry) => {
        if (entry.id !== slot.entryId) return entry;
        return {
          ...entry,
          opCodes: entry.opCodes.map((line) => {
            if (line.id !== action.lineId) return line;
            // Additive, same as the signed-in path — a job picked back up the
            // next day should total, not overwrite.
            const total =
              Math.round(((line.actualHours ?? 0) + addHours) * 100) / 100;
            return { ...line, actualHours: total };
          }),
        };
      });
      return {
        ...state,
        entries,
        timers: state.timers.filter((t) => t.id !== action.id),
      };
    }

    // Absolute set, from the RO detail modal's blur-to-save input. Distinct
    // from TIMER_SAVE, which is additive — one is a human typing the number
    // they mean, the other is a measurement being appended.
    case "UPDATE_ENTRY_HOURS": {
      const entries = state.entries.map((entry) => {
        if (entry.id !== action.entryId) return entry;
        return {
          ...entry,
          opCodes: entry.opCodes.map((line) =>
            line.id === action.lineId
              ? { ...line, actualHours: action.actualHours }
              : line,
          ),
        };
      });
      return { ...state, entries };
    }

    case "SET_RATE":
      return { ...state, hourlyRate: action.hourlyRate };
    case "DELETE_ENTRY":
      return {
        ...state,
        entries: state.entries.filter((e) => e.id !== action.id),
        // A timer pointing at a deleted RO would render "RO no longer
        // available" forever; the signed-in side gets this from the FK's
        // ON DELETE SET NULL, so mirror it here.
        timers: state.timers.map((t) =>
          t.entryId === action.id ? { ...t, entryId: null, lineId: null } : t,
        ),
      };
    default:
      return state;
  }
}

type GuestContextValue = {
  entries: Entry[];
  opCodes: OpCode[];
  settings: UserSettings;
  addEntry: (input: NewEntry) => Entry;
  makeOpCode: (draft: OpCodeDraft) => OpCode;
  addGuestOpCode: (draft: OpCodeDraft) => OpCode;
  editGuestOpCode: (id: string, draft: OpCodeDraft) => void;
  deleteGuestOpCode: (id: string) => void;
  hourlyRate: number | null;
  setGuestRate: (hourlyRate: number | null) => void;
  deleteGuestEntry: (id: string) => void;
  updateEntryHours: (entryId: string, lineId: string, actualHours: number) => void;
  // Timers — same slot model as the signed-in app, in memory.
  timers: TimerSlot[];
  /** Returns an error message when all slots are taken or the RO is already on
   * one, mirroring the server action's refusals. */
  attachGuestTimer: (entryId: string, lineId: string | null) => string | null;
  setGuestTimerStatus: (id: string, status: TimerStatus) => void;
  setGuestTimerLine: (id: string, lineId: string | null) => void;
  resetGuestTimer: (id: string) => void;
  releaseGuestTimer: (id: string) => void;
  saveGuestTimer: (id: string, lineId: string) => void;
};

const GuestContext = createContext<GuestContextValue | null>(null);

export function GuestStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GuestState>;
        dispatch({
          type: "HYDRATE",
          state: {
            entries: parsed.entries ?? [],
            opCodes: parsed.opCodes ?? GUEST_SAMPLE_OPCODES,
            // A session stored before the multi-timer change has no `timers`
            // key; starting empty is the honest fallback (the old single
            // timer's shape can't be mapped without guessing a status).
            timers: parsed.timers ?? [],
            hourlyRate: parsed.hourlyRate ?? null,
          },
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  function addEntry(input: NewEntry): Entry {
    const now = new Date().toISOString();
    const entry: Entry = {
      id: crypto.randomUUID(),
      userId: "guest",
      createdAt: now,
      updatedAt: now,
      date: input.date,
      roNumber: input.roNumber,
      vehicle: input.vehicle,
      notes: input.notes,
      comebackOfEntryId: input.comebackOfEntryId ?? null,
      comebackKind: input.comebackKind ?? null,
      opCodes: input.opCodes.map((oc, i) => ({
        id: crypto.randomUUID(),
        opCodeId: oc.opCodeId,
        custom: oc.custom,
        customCode: oc.customCode,
        customDescription: oc.customDescription,
        // Mirrors the DB CHECK the signed-in path gets for free. Guest mode has
        // no database to enforce it, so the invariant has to hold here or the
        // sample data would contradict the rule the real app guarantees.
        flagHours: oc.isComeback ? 0 : oc.flagHours,
        actualHours: oc.actualHours,
        notes: oc.notes,
        position: i,
        subOpCodeId: oc.subOpCodeId ?? null,
        laborType: oc.laborType ?? null,
        paidHours: oc.paidHours ?? null,
        isComeback: oc.isComeback ?? false,
      })),
      flagHours: input.opCodes.reduce(
        (s, oc) => s + (oc.isComeback ? 0 : oc.flagHours || 0),
        0,
      ),
    };
    dispatch({ type: "ADD", entry });
    return entry;
  }

  function makeOpCode(draft: OpCodeDraft): OpCode {
    return {
      id: crypto.randomUUID(),
      userId: "guest",
      code: draft.code,
      description: draft.description,
      flagHours: draft.flagHours,
      notes: draft.notes ?? "",
      tags: draft.tags ?? [],
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      subOpCodes: [],
    };
  }

  function addGuestOpCode(draft: OpCodeDraft): OpCode {
    const opCode: OpCode = {
      id: crypto.randomUUID(),
      userId: "guest",
      code: draft.code,
      description: draft.description,
      flagHours: draft.flagHours,
      notes: draft.notes ?? "",
      tags: draft.tags ?? [],
      sortOrder: state.opCodes.length,
      createdAt: new Date().toISOString(),
      subOpCodes: [],
    };
    dispatch({ type: "ADD_OPCODE", opCode });
    return opCode;
  }

  function editGuestOpCode(id: string, draft: OpCodeDraft): void {
    dispatch({
      type: "EDIT_OPCODE",
      id,
      patch: {
        code: draft.code,
        description: draft.description,
        flagHours: draft.flagHours,
        notes: draft.notes ?? "",
        tags: draft.tags ?? [],
      },
    });
  }

  function deleteGuestOpCode(id: string): void {
    dispatch({ type: "DELETE_OPCODE", id });
  }

  function attachGuestTimer(entryId: string, lineId: string | null): string | null {
    if (state.timers.some((t) => t.entryId === entryId)) {
      return "That RO is already on a timer.";
    }
    const slot = nextFreeSlot(state.timers);
    if (slot === null) return "All 3 timers are in use. Save or clear one first.";
    dispatch({
      type: "TIMER_ATTACH",
      id: crypto.randomUUID(),
      slot,
      entryId,
      lineId,
      now: Date.now(),
    });
    return null;
  }

  function setGuestTimerStatus(id: string, status: TimerStatus): void {
    dispatch({ type: "TIMER_SET_STATUS", id, status, now: Date.now() });
  }

  function setGuestTimerLine(id: string, lineId: string | null): void {
    dispatch({ type: "TIMER_SET_LINE", id, lineId });
  }

  function resetGuestTimer(id: string): void {
    dispatch({ type: "TIMER_RESET", id, now: Date.now() });
  }

  function releaseGuestTimer(id: string): void {
    dispatch({ type: "TIMER_RELEASE", id });
  }

  function saveGuestTimer(id: string, lineId: string): void {
    dispatch({ type: "TIMER_SAVE", id, lineId, now: Date.now() });
  }

  function updateEntryHours(
    entryId: string,
    lineId: string,
    actualHours: number,
  ): void {
    dispatch({ type: "UPDATE_ENTRY_HOURS", entryId, lineId, actualHours });
  }

  function deleteGuestEntry(id: string): void {
    dispatch({ type: "DELETE_ENTRY", id });
  }

  function setGuestRate(hourlyRate: number | null): void {
    dispatch({ type: "SET_RATE", hourlyRate });
  }

  return (
    <GuestContext.Provider
      value={{
        entries: state.entries,
        opCodes: state.opCodes,
        settings: defaultSettings,
        addEntry,
        makeOpCode,
        addGuestOpCode,
        editGuestOpCode,
        deleteGuestOpCode,
        hourlyRate: state.hourlyRate,
        setGuestRate,
        deleteGuestEntry,
        updateEntryHours,
        timers: state.timers,
        attachGuestTimer,
        setGuestTimerStatus,
        setGuestTimerLine,
        resetGuestTimer,
        releaseGuestTimer,
        saveGuestTimer,
      }}
    >
      {children}
    </GuestContext.Provider>
  );
}

export function useGuestStore() {
  const ctx = useContext(GuestContext);
  if (!ctx) throw new Error("useGuestStore called outside GuestStoreProvider");
  return ctx;
}
