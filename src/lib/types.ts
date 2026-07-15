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
  // Flag hours the shop ACTUALLY paid on this job. null = not yet reconciled.
  // Written by the pay-period reconciliation UI, never by the log form (which
  // only passes it through on edit). Optional so line literals that predate the
  // reconciliation feature still typecheck; the DB mapper always populates it.
  paidHours?: number | null;
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

// A photographic record attached to an entry (RO ticket photo). captured_at is
// server-set and immutable — it's the integrity anchor the viewer displays.
// The binary lives in the private `ro-photos` storage bucket; only the path is
// stored here. Signed URLs are minted on demand, never persisted.
export type EntryPhoto = {
  id: string;
  entryId: string;
  storagePath: string;
  capturedAt: string; // ISO timestamp — never editable
  byteSize: number;
};

// A spiff / bonus: money paid outside flag hours. Dollar-denominated natively,
// so it needs no labor rates to be meaningful. `entryId` optionally links it to
// the RO it came from (a menu-sale spiff belongs to a specific job); the link is
// ON DELETE SET NULL — deleting the RO keeps the spiff, since the money was paid.
export type BonusCategory = "spiff" | "bonus" | "holiday" | "other";

export type Bonus = {
  id: string;
  userId: string;
  date: string; // "YYYY-MM-DD"
  amount: number;
  category: BonusCategory;
  source: string | null; // free text: "tire spiff", "CSI"
  note: string | null;
  entryId: string | null; // optional RO link
  createdAt: string;
  updatedAt: string;
};

// Input for creating/updating a bonus — omits server-controlled fields.
export type NewBonus = {
  date: string;
  amount: number;
  category: BonusCategory;
  source?: string | null;
  note?: string | null;
  entryId?: string | null;
};

export type BonusPatch = Partial<NewBonus>;

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
  // User-entered reference hourly rate (e.g. their local minimum wage) for the
  // pay-period Pay Check-Up comparison. null = unset (no comparison shown). We do
  // NOT store a statutory figure — wage floors change yearly and vary by locale.
  referenceHourlyRate: number | null;
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

// ------------------------------------------------------------------------
// Gamification Phase 1 (docs/gamification.md)
// ------------------------------------------------------------------------

// Explicit "don't expect me to log" range — vacation, injury. The streak
// treats every date inside as frozen.
export type DayOff = {
  id: string;
  startDate: string; // "YYYY-MM-DD", inclusive
  endDate: string; // inclusive
  createdAt: string;
};

export type SnapshotTopOp = { code: string; description: string; count: number };

// Stats frozen into a portfolio snapshot at generation time. Immutable —
// later RO edits never touch an issued snapshot.
export type SnapshotStats = {
  roCount: number;
  totalFlagHours: number;
  // sum(actual) / sum(flag) over lines that have actual hours; null when
  // fewer than MIN_BOOK_LINES lines carry actuals (timer not used enough).
  avgVsBook: number | null;
  photoCount: number;
  topOps: SnapshotTopOp[]; // up to 3, by line count
  firstDate: string; // "YYYY-MM-DD"
  lastDate: string;
  workDays: number; // distinct logged dates in range
};

export type PortfolioSnapshot = {
  id: string;
  seq: number; // display number: Snapshot #seq
  roThreshold: number; // the RO-count line this snapshot marks
  stats: SnapshotStats;
  createdAt: string;
};
