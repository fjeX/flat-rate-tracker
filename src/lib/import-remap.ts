// Turns a parsed backup file into the row payload `import_replace_account()`
// writes, giving every record a fresh primary key along the way.
//
// WHY THIS EXISTS
// op_codes.id, entries.id, entry_op_codes.id and bonuses.id are database-wide
// primary keys, not per-user ones. Import used to reinsert the backup's ORIGINAL
// ids while deleting only the importing user's rows, so on a shared database the
// source account's rows still held those ids and the insert died on 23505
// (duplicate key on op_codes_pkey). Migrating to a second account could never
// succeed. Remapping makes a backup portable between accounts and databases.
//
// THE LOAD-BEARING RULE
// A reference that does not resolve INSIDE the bundle becomes null. Passing an
// unresolved id through would leave a row pointing at a STRANGER'S record on a
// shared database — a cross-account link is far worse than a missing one.
//
// SHAPE CONTRACT
// Every object here must carry every column of its table. The RPC populates rows
// with jsonb_populate_recordset against a null base, so an omitted key lands as
// NULL rather than the column default (the same trap documented for PostgREST
// bulk inserts). NOT NULL columns fail loudly and roll back; nullable ones would
// silently import as empty — which is the exact class of bug this file fixes.
// `user_id` is the deliberate exception: the RPC stamps it from auth.uid() so a
// crafted payload cannot write into someone else's account.

import type {
  Bonus,
  DailyClock,
  Dispute,
  Entry,
  LaborRate,
  OpCode,
  PaidPeriod,
  PeriodOverride,
  UnpaidTime,
} from "@/lib/types";

export type ImportBundle = {
  version: number;
  exportedAt: string;
  settings: { splitDay: number; periodOverrides: Record<string, PeriodOverride> };
  entries: Entry[];
  opCodes: OpCode[];
  dailyClocks: DailyClock[];
  paidPeriods: PaidPeriod[];
  // Photo metadata only — the binaries live in storage and aren't in the JSON,
  // so import ignores this key entirely.
  entryPhotos?: unknown[];
  // Spiffs/bonuses — optional (older backups predate the feature).
  bonuses?: Bonus[];
  // --- version 2 additions. Absent in v1 backups, and "absent" is meaningful:
  // the RPC replaces a table only when the payload carries its key, so restoring
  // a v1 file leaves these alone instead of deleting records it never held.
  laborRates?: LaborRate[];
  disputes?: Dispute[];
  unpaidTime?: UnpaidTime[];
};

export const CURRENT_BACKUP_VERSION = 2;
export const SUPPORTED_BACKUP_VERSIONS = [1, 2];

/** Row payload handed to import_replace_account(). Keys are table names. */
export type ImportPayload = {
  settings: { split_day: number; period_overrides: Record<string, PeriodOverride> };
  op_codes: Record<string, unknown>[];
  op_code_variants: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  entry_op_codes: Record<string, unknown>[];
  bonuses: Record<string, unknown>[];
  daily_clock_hours: Record<string, unknown>[];
  paid_period_hours: Record<string, unknown>[];
  labor_rates?: Record<string, unknown>[];
  disputes?: Record<string, unknown>[];
  dispute_lines?: Record<string, unknown>[];
  unpaid_time?: Record<string, unknown>[];
};

/**
 * Assigns a fresh id per source id and resolves references against them.
 * `get` returns null for anything never registered, which is what turns an
 * out-of-bundle reference into a null column instead of a dangling pointer.
 */
class IdMap {
  private readonly map = new Map<string, string>();
  constructor(private readonly newId: () => string) {}

  mint(oldId: string): string {
    const existing = this.map.get(oldId);
    if (existing) return existing;
    const fresh = this.newId();
    this.map.set(oldId, fresh);
    return fresh;
  }

  get(oldId: string | null | undefined): string | null {
    if (!oldId) return null;
    return this.map.get(oldId) ?? null;
  }
}

export type BuildPayloadOptions = {
  /** Injectable so tests get deterministic ids. */
  newId?: () => string;
  /** Timestamp for rows whose type carries none (labor rates). */
  now?: string;
};

export function buildImportPayload(
  bundle: ImportBundle,
  opts: BuildPayloadOptions = {},
): ImportPayload {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? new Date().toISOString();

  const opCodeIds = new IdMap(newId);
  const variantIds = new IdMap(newId);
  const entryIds = new IdMap(newId);
  const lineIds = new IdMap(newId);

  const opCodes = bundle.opCodes ?? [];
  const entries = bundle.entries ?? [];

  // Mint every id up front. References are resolved in a second pass because a
  // comeback can point at an RO logged later in the file, and a bonus can point
  // at any RO at all — neither is safe to resolve while still walking the list.
  for (const oc of opCodes) {
    opCodeIds.mint(oc.id);
    for (const sub of oc.subOpCodes ?? []) variantIds.mint(sub.id);
  }
  for (const e of entries) {
    entryIds.mint(e.id);
    for (const line of e.opCodes ?? []) lineIds.mint(line.id);
  }

  const payload: ImportPayload = {
    settings: {
      split_day: bundle.settings.splitDay,
      period_overrides: bundle.settings.periodOverrides ?? {},
    },

    op_codes: opCodes.map((oc) => ({
      id: opCodeIds.mint(oc.id),
      code: oc.code,
      description: oc.description ?? "",
      flag_hours: oc.flagHours,
      sort_order: oc.sortOrder,
      created_at: oc.createdAt,
      notes: oc.notes ?? "",
      tags: oc.tags ?? [],
    })),

    op_code_variants: opCodes.flatMap((oc) =>
      (oc.subOpCodes ?? []).map((sub) => ({
        id: variantIds.mint(sub.id),
        // A variant whose parent somehow isn't in the file can't be imported at
        // all — op_code_id is NOT NULL. Dropped below rather than crashing.
        op_code_id: opCodeIds.get(sub.opCodeId),
        code: sub.code,
        description: sub.description ?? "",
        flag_hours: sub.flagHours,
        sort_order: sub.sortOrder,
        created_at: sub.createdAt,
      })),
    ).filter((v) => v.op_code_id !== null),

    entries: entries.map((e) => ({
      id: entryIds.mint(e.id),
      date: e.date,
      ro_number: e.roNumber,
      vehicle_year: e.vehicle?.year ?? "",
      vehicle_make: e.vehicle?.make ?? "",
      vehicle_model: e.vehicle?.model ?? "",
      vehicle_vin: e.vehicle?.vin ?? "",
      vehicle_mileage: e.vehicle?.mileage ?? "",
      // Recomputed by the entry_op_codes trigger once the lines land; carried
      // anyway so an RO with no lines still reports its own total.
      flag_hours: e.flagHours,
      notes: e.notes ?? "",
      // A comeback pointing outside the bundle loses the link, not the marking:
      // comeback_kind below still records that this WAS rework.
      comeback_of_entry_id: entryIds.get(e.comebackOfEntryId),
      comeback_kind: e.comebackKind ?? null,
      created_at: e.createdAt,
      updated_at: e.updatedAt,
    })),

    entry_op_codes: entries.flatMap((e) =>
      (e.opCodes ?? []).map((line) => ({
        id: lineIds.mint(line.id),
        entry_id: entryIds.mint(e.id),
        op_code_id: opCodeIds.get(line.opCodeId),
        sub_op_code_id: variantIds.get(line.subOpCodeId),
        custom: line.custom,
        custom_code: line.customCode,
        custom_description: line.customDescription,
        flag_hours: line.flagHours,
        actual_hours: line.actualHours,
        // The reconciliation state. Dropping this was the worst of the silent
        // losses — it is the answer to "did the shop actually pay me for this?"
        paid_hours: line.paidHours ?? null,
        is_comeback: line.isComeback ?? false,
        labor_type: line.laborType ?? null,
        notes: line.notes ?? "",
        position: line.position,
      })),
    ),

    bonuses: (bundle.bonuses ?? []).map((b) => ({
      id: newId(),
      date: b.date,
      amount: b.amount,
      category: b.category,
      source: b.source,
      note: b.note,
      entry_id: entryIds.get(b.entryId),
      created_at: b.createdAt,
      updated_at: b.updatedAt,
    })),

    // Composite-keyed on (user_id, date) / (user_id, period_key) — no surrogate
    // id, so nothing to remap and no cross-account collision to begin with.
    daily_clock_hours: (bundle.dailyClocks ?? []).map((c) => ({
      date: c.date,
      hours: c.hours,
    })),

    paid_period_hours: (bundle.paidPeriods ?? []).map((p) => ({
      period_key: p.periodKey,
      paid_flag_hours: p.paidFlagHours,
    })),
  };

  // --- v2 sections. Only attached when the backup actually carries them, so a
  // v1 restore leaves these tables untouched rather than emptying them.
  if (bundle.laborRates) {
    payload.labor_rates = bundle.laborRates.map((r) => ({
      id: newId(),
      labor_type: r.laborType,
      hourly_rate: r.hourlyRate,
      created_at: now,
      updated_at: now,
    }));
  }

  if (bundle.disputes) {
    const disputeIds = new IdMap(newId);
    payload.disputes = bundle.disputes.map((d) => ({
      id: disputeIds.mint(d.id),
      period_key: d.periodKey,
      period_label: d.periodLabel ?? "",
      scope: d.scope,
      status: d.status,
      claimed_hours: d.claimedHours,
      claimed_dollars: d.claimedDollars ?? null,
      recovered_hours: d.recoveredHours,
      recovered_dollars: d.recoveredDollars ?? null,
      generated_at: d.generatedAt,
      submitted_at: d.submittedAt,
      answered_at: d.answeredAt,
      resolved_at: d.resolvedAt,
      note: d.note ?? "",
      created_at: d.createdAt,
      updated_at: d.updatedAt,
    }));

    // A dispute is a frozen claim: the hours, dollars and labels are copied in
    // at generation time and never recomputed. So a line whose RO isn't in the
    // bundle still imports intact — it just loses the drill-down link, exactly
    // as it would if the RO were deleted in place (FK is ON DELETE SET NULL).
    payload.dispute_lines = bundle.disputes.flatMap((d) =>
      (d.lines ?? []).map((l) => ({
        id: newId(),
        dispute_id: disputeIds.mint(d.id),
        entry_id: entryIds.get(l.entryId),
        line_id: lineIds.get(l.lineId),
        ro_number: l.roNumber ?? "",
        code: l.code ?? "",
        description: l.description ?? "",
        work_date: l.workDate,
        flagged_hours: l.flaggedHours,
        paid_hours: l.paidHours ?? null,
        claimed_hours: l.claimedHours,
        claimed_dollars: l.claimedDollars ?? null,
        recovered_hours: l.recoveredHours,
        recovered_dollars: l.recoveredDollars ?? null,
        had_photo: l.hadPhoto,
        position: l.position,
        // DisputeLine carries no timestamps of its own — the read mapper never
        // needed them — but both columns are NOT NULL. A line is created and
        // amended with its claim, so the parent's stamps are the honest values,
        // and omitting them would write NULL rather than the column default.
        created_at: d.createdAt,
        updated_at: d.updatedAt,
      })),
    );
  }

  if (bundle.unpaidTime) {
    payload.unpaid_time = bundle.unpaidTime.map((u) => ({
      id: newId(),
      date: u.date,
      hours: u.hours,
      kind: u.kind,
      entry_id: entryIds.get(u.entryId),
      original_entry_id: entryIds.get(u.originalEntryId),
      source: u.source,
      note: u.note ?? "",
      created_at: u.createdAt,
      updated_at: u.updatedAt,
    }));
  }

  return payload;
}
