// Domain types used throughout the app.
// These are camelCase on purpose; the DB uses snake_case and mappers
// in src/lib/db/* convert between the two.

export type Vehicle = {
  year: string;
  make: string;
  model: string;
  vin: string;
};

export type EntryOpCode = {
  id: string; // entry_op_codes.id (so we can update/delete a line)
  opCodeId: string | null; // reference to library op code, null for custom
  custom: boolean;
  customCode: string | null;
  customDescription: string | null;
  flagHours: number;
  actualHours: number | null;
  position: number;
};

export type Entry = {
  id: string;
  userId: string;
  createdAt: string; // ISO timestamp
  updatedAt: string;
  date: string; // "YYYY-MM-DD"
  roNumber: string;
  vehicle: Vehicle;
  opCodes: EntryOpCode[];
  flagHours: number; // denormalized sum of opCodes[].flagHours (DB trigger keeps this current)
  notes: string;
};

export type OpCode = {
  id: string;
  userId: string;
  code: string;
  description: string;
  flagHours: number;
  sortOrder: number;
  createdAt: string;
};

export type DailyClock = {
  userId: string;
  date: string; // "YYYY-MM-DD"
  hours: number;
};

export type PaidPeriod = {
  userId: string;
  periodKey: string; // "YYYY-MM-P1" or "YYYY-MM-P2"
  paidFlagHours: number;
};

export type PeriodOverride = { start: string; end: string };

export type UserSettings = {
  userId: string;
  splitDay: number; // 1..30
  periodOverrides: Record<string, PeriodOverride>;
  timerRoId: string | null;
  timerStartTime: number | null; // epoch ms, null = paused or not running
  timerAccumulated: number; // ms accumulated while paused
  updatedAt: string;
};

// ------------------------------------------------------------------------
// Input types for mutations — what callers provide when creating/updating.
// These omit server-controlled fields (id, userId, createdAt, updatedAt).
// ------------------------------------------------------------------------

export type NewEntryOpCode = Omit<EntryOpCode, "id"> & { id?: string };

export type NewEntry = {
  date: string;
  roNumber: string;
  vehicle: Vehicle;
  notes: string;
  opCodes: NewEntryOpCode[];
};

export type EntryPatch = Partial<NewEntry>;

export type NewOpCode = {
  code: string;
  description: string;
  flagHours: number;
  sortOrder?: number; // optional — appended to end of library if omitted
};

export type OpCodePatch = Partial<Omit<NewOpCode, "sortOrder">>;
