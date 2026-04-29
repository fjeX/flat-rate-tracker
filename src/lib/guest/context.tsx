"use client";

import { createContext, useContext, useEffect, useReducer } from "react";
import type { Entry, NewEntry, OpCode, UserSettings } from "@/lib/types";
import type { OpCodeDraft } from "@/components/forms/OpCodeModals";

const STORAGE_KEY = "frt_guest";

type GuestState = { entries: Entry[] };

type GuestAction =
  | { type: "ADD"; entry: Entry }
  | { type: "HYDRATE"; state: GuestState };

const defaultSettings: UserSettings = {
  userId: "guest",
  splitDay: 15,
  periodOverrides: {},
  timerRoId: null,
  timerStartTime: null,
  timerAccumulated: 0,
  updatedAt: new Date().toISOString(),
  roTemplates: [],
};

export const GUEST_SAMPLE_OPCODES: OpCode[] = [
  { id: "g-1", userId: "guest", code: "100-1", description: "Engine Oil & Filter Change", flagHours: 0.3, notes: "", sortOrder: 0, createdAt: "" },
  { id: "g-2", userId: "guest", code: "600-5", description: "Brake Pads & Rotors — Front", flagHours: 1.8, notes: "", sortOrder: 1, createdAt: "" },
  { id: "g-3", userId: "guest", code: "600-6", description: "Brake Pads & Rotors — Rear", flagHours: 1.5, notes: "", sortOrder: 2, createdAt: "" },
  { id: "g-4", userId: "guest", code: "320-1", description: "Coolant System Flush", flagHours: 0.8, notes: "", sortOrder: 3, createdAt: "" },
  { id: "g-5", userId: "guest", code: "440-2", description: "A/C Recharge & Inspection", flagHours: 1.0, notes: "", sortOrder: 4, createdAt: "" },
  { id: "g-6", userId: "guest", code: "401-3", description: "Transmission Fluid Change", flagHours: 1.2, notes: "", sortOrder: 5, createdAt: "" },
];

function reducer(state: GuestState, action: GuestAction): GuestState {
  switch (action.type) {
    case "ADD":
      return { ...state, entries: [action.entry, ...state.entries] };
    case "HYDRATE":
      return action.state;
    default:
      return state;
  }
}

type GuestContextValue = {
  entries: Entry[];
  settings: UserSettings;
  addEntry: (input: NewEntry) => Entry;
  makeOpCode: (draft: OpCodeDraft) => OpCode;
};

const GuestContext = createContext<GuestContextValue | null>(null);

export function GuestStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { entries: [] });

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) dispatch({ type: "HYDRATE", state: JSON.parse(raw) as GuestState });
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
      sortOrder: 0,
      createdAt: new Date().toISOString(),
    };
  }

  return (
    <GuestContext.Provider value={{ entries: state.entries, settings: defaultSettings, addEntry, makeOpCode }}>
      {children}
    </GuestContext.Provider>
  );
}

export function useGuestStore() {
  const ctx = useContext(GuestContext);
  if (!ctx) throw new Error("useGuestStore called outside GuestStoreProvider");
  return ctx;
}
