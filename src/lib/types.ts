// Domain types used throughout the app.
// These are camelCase on purpose; the DB uses snake_case and mappers
// in src/lib/db/* convert between the two.

// ── RO Template ───────────────────────────────────────────────────────────────
export type FieldId = "roNumber" | "vehicle" | "vin" | "opCodes";

export type FieldRegion = {
  field: FieldId;
  x: number;      // 0–100 % of image width
  y: number;      // 0–100 % of image height
  width: number;  // 0–100 %
  height: number; // 0–100 %
};

export type RoTemplate = {
  id: string;
  name: string;
  imageStoragePath: string; // Supabase Storage path: "{userId}/template_{id}"
  regions: FieldRegion[];
};

export type Vehicle = {
  year: string;
  make: string;
  model: string;
  vin: string;
  mileage: string;
};

// The five pay categories a flat-rate tech's time falls into. Warranty time is
// where techs get bled — it usually pays a lower rate than customer pay — which
// is why rates are keyed per type instead of a single flat rate.
export type LaborType =
  | "customer_pay"
  | "warranty"
  | "internal"
  | "used_car"
  | "other";

// A user's pay rate for one labor type. There is at most one row per (user, type);
// a missing row means that type is unpriced. V1 stores only the CURRENT rate —
// historical accuracy (rate at time of RO) would need an effective_from column.
export type LaborRate = {
  laborType: LaborType;
  hourlyRate: number;
};

export type EntryOpCode = {
  id: string; // entry_op_codes.id (so we can update/delete a line)
  opCodeId: string | null; // reference to library op code, null for custom
  custom: boolean;
  customCode: string | null;
  customDescription: string | null;
  flagHours: number;
  actualHours: number | null;
  notes: string;
  position: number;
  subOpCodeId: string | null; // reference to a sub op code (variant), null if none selected
  laborType: LaborType | null; // null = untyped (historical); earnings fall back to customer_pay rate
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

export type SubOpCode = {
  id: string;
  opCodeId: string;
  userId: string;
  code: string;
  description: string;
  flagHours: number;
  sortOrder: number;
  createdAt: string;
};

export type OpCode = {
  id: string;
  userId: string;
  code: string;
  description: string;
  flagHours: number;
  notes: string;
  tags: string[]; // freeform groupings, e.g. ["Brakes", "Warranty"]; empty when none
  sortOrder: number;
  createdAt: string;
  subOpCodes: SubOpCode[]; // empty array when none defined
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
  goalHours: number; // flag hour target per pay period
  periodOverrides: Record<string, PeriodOverride>;
  timerRoId: string | null;
  timerStartTime: number | null; // epoch ms, null = paused or not running
  timerAccumulated: number; // ms accumulated while paused
  updatedAt: string;
  roTemplates: RoTemplate[];
  defaultLaborType: LaborType | null; // seeds the per-line selector in the log form; null = no default
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

// Slim summary of an existing entry that shares an RO number — used by the
// duplicate-RO prompt to let the user tell repeat RO numbers apart.
export type RoMatch = {
  id: string;
  date: string; // "YYYY-MM-DD"
  vehicleSummary: string; // "2018 Toyota Camry", or "" when no vehicle was recorded
};

export type NewOpCode = {
  code: string;
  description: string;
  flagHours: number;
  notes?: string;
  tags?: string[];
  sortOrder?: number; // optional — appended to end of library if omitted
};

export type OpCodePatch = Partial<Omit<NewOpCode, "sortOrder">>;
