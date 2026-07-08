"use client";

import { createContext, useContext, useEffect, useReducer } from "react";
import type { Entry, NewEntry, OpCode, UserSettings } from "@/lib/types";
import type { OpCodeDraft } from "@/components/forms/OpCodeModals";
import { STARTER_OP_CODES } from "@/lib/starter-opcodes";

const STORAGE_KEY = "frt_guest";

type GuestState = {
  entries: Entry[];
  opCodes: OpCode[];
  timerStartTime: number | null;   // Date.now() ms timestamp when started, null if not running
  timerAccumulated: number;        // ms accumulated before current start
  timerRoId: string | null;        // ID of attached guest Entry
  timerLineId: string | null;      // ID of the specific EntryOpCode line being timed
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
  | { type: "TIMER_START"; startTime: number }
  | { type: "TIMER_PAUSE"; accumulated: number }
  | { type: "TIMER_RESET" }
  | { type: "TIMER_SET_RO"; roId: string | null; lineId: string | null }
  | { type: "UPDATE_ENTRY_HOURS"; entryId: string; lineId: string; actualHours: number }
  | { type: "SET_RATE"; hourlyRate: number | null }
  | { type: "DELETE_ENTRY"; id: string };

const defaultSettings: UserSettings = {
  userId: "guest",
  splitDay: 15,
  goalHours: 88,
  periodOverrides: {},
  timerRoId: null,
  timerStartTime: null,
  timerAccumulated: 0,
  updatedAt: new Date().toISOString(),
  roTemplates: [],
  defaultLaborType: null,
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
  timerStartTime: null,
  timerAccumulated: 0,
  timerRoId: null,
  timerLineId: null,
  hourlyRate: null,
};

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
    case "TIMER_START":
      return { ...state, timerStartTime: action.startTime };
    case "TIMER_PAUSE":
      return { ...state, timerStartTime: null, timerAccumulated: action.accumulated };
    case "TIMER_RESET":
      return { ...state, timerStartTime: null, timerAccumulated: 0, timerRoId: null, timerLineId: null };
    case "TIMER_SET_RO":
      return { ...state, timerRoId: action.roId, timerLineId: action.lineId };
    case "UPDATE_ENTRY_HOURS": {
      const entries = state.entries.map((entry) => {
        if (entry.id !== action.entryId) return entry;
        return {
          ...entry,
          opCodes: entry.opCodes.map((line) => {
            if (line.id !== action.lineId) return line;
            return { ...line, actualHours: action.actualHours };
          }),
        };
      });
      return { ...state, entries };
    }
    case "SET_RATE":
      return { ...state, hourlyRate: action.hourlyRate };
    case "DELETE_ENTRY":
      return { ...state, entries: state.entries.filter((e) => e.id !== action.id) };
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
  startGuestTimer: () => void;
  pauseGuestTimer: () => void;
  resetGuestTimer: () => void;
  setGuestTimerRo: (roId: string | null, lineId: string | null) => void;
  updateEntryHours: (entryId: string, lineId: string, actualHours: number) => void;
  hourlyRate: number | null;
  setGuestRate: (hourlyRate: number | null) => void;
  deleteGuestEntry: (id: string) => void;
  timerState: {
    startTime: number | null;
    accumulated: number;
    roId: string | null;
    lineId: string | null;
  };
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
            timerStartTime: parsed.timerStartTime ?? null,
            timerAccumulated: parsed.timerAccumulated ?? 0,
            timerRoId: parsed.timerRoId ?? null,
            timerLineId: parsed.timerLineId ?? null,
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
      opCodes: input.opCodes.map((oc, i) => ({
        id: crypto.randomUUID(),
        opCodeId: oc.opCodeId,
        custom: oc.custom,
        customCode: oc.customCode,
        customDescription: oc.customDescription,
        flagHours: oc.flagHours,
        actualHours: oc.actualHours,
        notes: oc.notes,
        position: i,
        subOpCodeId: oc.subOpCodeId ?? null,
        laborType: oc.laborType ?? null,
        paidHours: oc.paidHours ?? null,
      })),
      flagHours: input.opCodes.reduce((s, oc) => s + (oc.flagHours || 0), 0),
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

  function startGuestTimer(): void {
    dispatch({ type: "TIMER_START", startTime: Date.now() });
  }

  function pauseGuestTimer(): void {
    const accumulated =
      state.timerAccumulated +
      (state.timerStartTime ? Date.now() - state.timerStartTime : 0);
    dispatch({ type: "TIMER_PAUSE", accumulated });
  }

  function resetGuestTimer(): void {
    dispatch({ type: "TIMER_RESET" });
  }

  function setGuestTimerRo(roId: string | null, lineId: string | null): void {
    dispatch({ type: "TIMER_SET_RO", roId, lineId });
  }

  function updateEntryHours(entryId: string, lineId: string, actualHours: number): void {
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
        startGuestTimer,
        pauseGuestTimer,
        resetGuestTimer,
        setGuestTimerRo,
        updateEntryHours,
        hourlyRate: state.hourlyRate,
        setGuestRate,
        deleteGuestEntry,
        timerState: {
          startTime: state.timerStartTime,
          accumulated: state.timerAccumulated,
          roId: state.timerRoId,
          lineId: state.timerLineId,
        },
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
