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
  // null = implicitly untyped (predates the labor-type feature) — earnings fall
  // back to the customer_pay rate. "untyped" = the user explicitly chose
  // Untyped in the form — the line is unpriced and shows no dollars.
  laborType: LaborType | "untyped" | null;
  // Flag hours the shop ACTUALLY paid on this job. null = not yet reconciled.
  // Written by the pay-period reconciliation UI, never by the log form (which
  // only passes it through on edit). Optional so line literals that predate the
  // reconciliation feature still typecheck; the DB mapper always populates it.
  paidHours?: number | null;
  // This line is unpaid rework — a comeback. Line-level rather than entry-level
  // because the shop writes comebacks BOTH ways: a fresh RO (every line is a
  // comeback) and lines appended to the original ticket (only the new ones are).
  //
  // A comeback line ALWAYS flags zero, enforced by the DB CHECK
  // `entry_op_codes_comeback_zero_flag` — not by this type and not by the form.
  // Optional so line literals predating Phase 2 still typecheck; the DB mapper
  // always populates it.
  isComeback?: boolean;
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
  // The original job this RO is a redo of, when the comeback was written as a
  // NEW ticket. null for the appended-to-the-original shape (the lines carry the
  // marking instead) and for a comeback on another tech's work, which has no
  // original RO in this user's data at all. Optional so Entry literals predating
  // Phase 2 still typecheck; the DB mapper always populates it.
  comebackOfEntryId?: string | null;
  // Whose comeback this is. null when the RO has no comeback lines. NOT
  // derivable from comebackOfEntryId being null — that one null covers "my work
  // but the original was never logged", "another tech's work", and "same-visit
  // rework", which are three different facts.
  comebackKind?: ComebackKind | null;
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

// A block of time the tech was at the shop and earned nothing for. The other
// half of the pay picture from `Bonus`: money paid outside flag hours vs. hours
// worked outside flag pay.
//
// Both entry links are nullable and that is load-bearing, not laziness — a
// comeback on ANOTHER tech's work has no original RO in this user's data,
// same-visit rework has no ticket at all, and waiting on parts has no RO to
// hang off when nothing got logged that day.
export type UnpaidTimeKind =
  | "comeback_own" // redoing your own prior job, unpaid
  | "comeback_other" // cleaning up another tech's work
  | "rework_same_visit" // caught it before the car left; no ticket
  | "wait_parts"
  | "wait_approval"
  | "shop_time"; // meetings, cleanup, dispatch limbo

export const UNPAID_TIME_KINDS: readonly UnpaidTimeKind[] = [
  "comeback_own",
  "comeback_other",
  "rework_same_visit",
  "wait_parts",
  "wait_approval",
  "shop_time",
];

// Display labels for every kind, for surfaces that report the ledger back to
// the user (Phase 3). Capture UIs keep their own wording where the context is
// already narrowed — a zero-day picker can say "Comeback — my work" because the
// reader is looking at one day, while a period report needs the label to stand
// on its own.
export const UNPAID_TIME_KIND_LABELS: Record<UnpaidTimeKind, string> = {
  comeback_own: "Comeback — my own work",
  comeback_other: "Comeback — another tech's work",
  rework_same_visit: "Same-visit rework",
  wait_parts: "Waiting on parts",
  wait_approval: "Waiting on approval",
  shop_time: "Shop time",
};

export function isUnpaidTimeKind(v: unknown): v is UnpaidTimeKind {
  return typeof v === "string" && (UNPAID_TIME_KINDS as readonly string[]).includes(v);
}

// The three kinds that can describe a comeback logged as an RO. A strict subset
// of UnpaidTimeKind on purpose — RO-side and ledger-side comebacks then share
// one vocabulary and aggregate without a translation table. The wait_* and
// shop_time kinds are ledger-only; they never describe a repair order.
export type ComebackKind = Extract<
  UnpaidTimeKind,
  "comeback_own" | "comeback_other" | "rework_same_visit"
>;

export const COMEBACK_KINDS: readonly ComebackKind[] = [
  "comeback_own",
  "comeback_other",
  "rework_same_visit",
];

export const COMEBACK_KIND_LABELS: Record<ComebackKind, string> = {
  comeback_own: "My own work",
  comeback_other: "Another tech's work",
  rework_same_visit: "Same-visit rework",
};

export function isComebackKind(v: unknown): v is ComebackKind {
  return typeof v === "string" && (COMEBACK_KINDS as readonly string[]).includes(v);
}

/** How the row got here. `timer` rows are written automatically when a slot's
 * hold time is banked; `zero_day` rows come from resolving an empty scheduled
 * day as "worked — unpaid". */
export type UnpaidTimeSource = "manual" | "timer" | "zero_day";

export type UnpaidTime = {
  id: string;
  userId: string;
  date: string; // "YYYY-MM-DD"
  hours: number;
  kind: UnpaidTimeKind;
  entryId: string | null; // the RO this time was spent ON, if any
  originalEntryId: string | null; // for comeback_own: the job being redone
  source: UnpaidTimeSource;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type NewUnpaidTime = {
  date: string;
  hours: number;
  kind: UnpaidTimeKind;
  entryId?: string | null;
  originalEntryId?: string | null;
  source?: UnpaidTimeSource;
  note?: string;
};

export type UnpaidTimePatch = Partial<NewUnpaidTime>;

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
  // Timer state used to live here as three columns. It moved to its own
  // `active_timers` table when the timer went to 3 concurrent slots — see
  // src/lib/db/timers.ts.
  updatedAt: string;
  roTemplates: RoTemplate[];
  defaultLaborType: LaborType | null; // seeds the per-line selector in the log form; null = no default
  // User-entered reference hourly rate (e.g. their local minimum wage) for the
  // pay-period Pay Check-Up comparison. null = unset (no comparison shown). We do
  // NOT store a statutory figure — wage floors change yearly and vary by locale.
  referenceHourlyRate: number | null;
  // Per-tag colour overrides for the op code library: lowercased tag → hue
  // slot index (0-7, the --tag-hue-N theme tokens). Tags not listed keep
  // their deterministic hash colour.
  tagColors: Record<string, number>;
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
  comebackOfEntryId?: string | null;
  comebackKind?: ComebackKind | null;
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
/** How an efficiency denominator was measured (schedule-based efficiency). */
export type DenomSource = "clocked" | "scheduled" | "mixed";

export type SnapshotStats = {
  roCount: number;
  totalFlagHours: number;
  // sum(actual) / sum(flag) over lines that have actual hours; null when
  // fewer than MIN_BOOK_LINES lines carry actuals (timer not used enough).
  avgVsBook: number | null;
  // Unpaid rework hours inside this snapshot's range. Reported separately
  // rather than folded into avgVsBook: a comeback has no book time to be
  // measured against, so mixing it in would answer a different question than
  // the one that ratio exists to answer. Absent on snapshots frozen before
  // Phase 2 — treat undefined as "not measured", not as zero.
  comebackHours?: number;
  photoCount: number;
  topOps: SnapshotTopOp[]; // up to 3, by line count
  firstDate: string; // "YYYY-MM-DD"
  lastDate: string;
  workDays: number; // distinct logged dates in range
  // Schedule-aware overall efficiency (flag ÷ clocked-or-scheduled hours)
  // over the snapshot's range, with how the denominator was measured.
  // Absent on snapshots frozen before the schedule feature existed.
  overallEfficiency?: number | null;
  efficiencySource?: DenomSource | null;
};

export type PortfolioSnapshot = {
  id: string;
  seq: number; // display number: Snapshot #seq
  roThreshold: number; // the RO-count line this snapshot marks
  stats: SnapshotStats;
  createdAt: string;
};

// ── Bug reports (Report a Bug) ─────────────────────────────────────────────────
// A user-submitted bug report. Triage fields (severity/category/status/notes) are
// admin-set and null until triaged. Context fields are silently auto-captured.
export type BugReport = {
  id: string;
  userId: string;
  description: string;
  pageUrl: string | null;
  userAgent: string | null;
  viewport: string | null;
  appBuild: string | null;
  severity: string | null;
  category: string | null;
  status: string;
  triageNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BugReportPhoto = {
  id: string;
  reportId: string;
  storagePath: string;
  byteSize: number;
  createdAt: string;
};

// ── Dispute Outcome Ledger ────────────────────────────────────────────────────
// What happened after a dispute pack went out. A Dispute is a FROZEN historical
// claim: every hours/dollars/label field is copied in at generation time and
// never recomputed from the live ROs, because the ROs move underneath it (a line
// gets reconciled, an RO gets edited or deleted, a rate changes). Recompute and
// the claim would silently shrink to nothing the moment the shop paid you.
//
// Recovered amounts are a SEPARATE ledger — never folded into period earnings or
// the flagged-vs-paid variance. When a short gets paid, that shows up naturally
// as the line's paidHours going up; counting it here too would double-count.
export type DisputeStatus =
  | "generated" // pack built/exported, not handed over yet
  | "submitted" // given to the service manager / payroll
  | "answered" // they responded: full, partial, or zero adjustment
  | "resolved" // closed out; recovered amounts are final
  | "withdrawn"; // dropped without a resolution

export const DISPUTE_STATUSES: readonly DisputeStatus[] = [
  "generated",
  "submitted",
  "answered",
  "resolved",
  "withdrawn",
];

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  generated: "Not sent yet",
  submitted: "Waiting on a response",
  answered: "They responded",
  resolved: "Closed",
  withdrawn: "Dropped",
};

// 'period' = aggregate claim from a standard pay stub (hours only — the stub
//            shows total clocked and flagged, not per-RO detail).
// 'lines'  = itemized claim, one DisputeLine per shorted RO line. Only possible
//            when the tech has the per-RO hours breakdown from payroll.
export type DisputeScope = "period" | "lines";

export const DISPUTE_SCOPE_LABELS: Record<DisputeScope, string> = {
  period: "Period total",
  lines: "Itemized by RO",
};

export type DisputeLine = {
  id: string;
  disputeId: string;
  // Navigation only, and both nullable: deleting an RO must never delete the
  // record that you disputed it.
  entryId: string | null;
  lineId: string | null;
  // Frozen identity, so the row still reads as a complete claim after the RO is
  // relabelled or deleted.
  roNumber: string;
  code: string;
  description: string;
  workDate: string | null; // "YYYY-MM-DD"
  flaggedHours: number;
  // null = the line was still pending (never reconciled) when the claim went
  // out. Different from "paid zero".
  paidHours: number | null;
  claimedHours: number;
  claimedDollars: number | null; // null when no rate applied to this line
  recoveredHours: number;
  recoveredDollars: number | null;
  // Whether a photo was on file when the claim went out. Frozen because the
  // photo can be deleted later — this is what answers "do claims with evidence
  // get paid more often?"
  hadPhoto: boolean;
  position: number;
};

export type Dispute = {
  id: string;
  userId: string;
  periodKey: string;
  periodLabel: string;
  scope: DisputeScope;
  status: DisputeStatus;
  claimedHours: number;
  // null = no labor rate was priced when the claim was raised, so the dollar
  // value is genuinely unknown. Never coerce to 0 — "unknown" and "zero" are
  // different answers and render differently.
  claimedDollars: number | null;
  recoveredHours: number;
  recoveredDollars: number | null;
  generatedAt: string;
  submittedAt: string | null;
  answeredAt: string | null;
  resolvedAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  // Populated only when the caller asked for lines (scope 'period' has none).
  lines: DisputeLine[];
};

export type NewDisputeLine = {
  entryId?: string | null;
  lineId?: string | null;
  roNumber: string;
  code: string;
  description?: string;
  workDate?: string | null;
  flaggedHours: number;
  paidHours?: number | null;
  claimedHours: number;
  claimedDollars?: number | null;
  hadPhoto?: boolean;
};

export type NewDispute = {
  periodKey: string;
  periodLabel?: string;
  scope: DisputeScope;
  claimedHours: number;
  claimedDollars?: number | null;
  note?: string;
  lines?: NewDisputeLine[];
};

export type DisputePatch = {
  status?: DisputeStatus;
  recoveredHours?: number;
  recoveredDollars?: number | null;
  note?: string;
};

export function isDisputeStatus(v: unknown): v is DisputeStatus {
  return (
    typeof v === "string" && (DISPUTE_STATUSES as readonly string[]).includes(v)
  );
}
