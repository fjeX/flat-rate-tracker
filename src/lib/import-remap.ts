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
  CareerMilestone,
  DailyClock,
  DayOff,
  Dispute,
  Entry,
  LaborRate,
  OpCode,
  PaidPeriod,
  PeriodOverride,
  PortfolioSnapshot,
  RoEvent,
  UnpaidTime,
} from "@/lib/types";
import type { ShiftOverrideMap, WorkSchedule } from "@/lib/schedule";

export type ImportBundle = {
  version: number;
  exportedAt: string;
  // v3 widened this from two fields to eight. The table has always had more
  // columns than the backup carried, so a migrated account came up with the
  // destination's goal, tag colours, templates and rate — or, on a fresh
  // account, the column defaults. shareLaborTimes was the worst of them: it
  // reverted to false and quietly un-enrolled a True Time contributor.
  //
  // is_admin is deliberately NOT here. A backup is a file the user can edit, so
  // a settings shape that accepts a privilege flag is a privilege escalation.
  settings: {
    splitDay: number;
    periodOverrides: Record<string, PeriodOverride>;
    goalHours?: number;
    tagColors?: Record<string, number>;
    referenceHourlyRate?: number | null;
    roTemplates?: unknown[] | null;
    defaultLaborType?: string | null;
    shareLaborTimes?: boolean;
    /** v4. Absent in v1–v3 files — "keep the destination's answer". */
    trackRoTime?: boolean;
  };
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
  // --- version 3 additions: the Schedule and Career features, absent from every
  // backup written before 2026-08-12. Same "absent is meaningful" rule as v2.
  //
  // work_schedules is the load-bearing one — it is the denominator the
  // efficiency engine divides by, so an account restored without it doesn't
  // show blanks, it shows DIFFERENT numbers.
  workSchedules?: WorkSchedule[];
  daysOff?: DayOff[];
  /** date -> shift, matching listShiftOverridesSafe's read shape. */
  shiftOverrides?: ShiftOverrideMap;
  /** Bare "YYYY-MM-DD" strings, matching listConfirmedZeroDaysSafe. */
  confirmedZeroDays?: string[];
  portfolioSnapshots?: PortfolioSnapshot[];
  careerMilestones?: CareerMilestone[];
  // --- version 5 addition: Open Ticket timelines. Absent from every backup
  // written before 2026-09-12. Same "absent is meaningful" rule; the hours side
  // of an open ticket rides inside unpaidTime (kind open_work) and needs no key.
  roEvents?: RoEvent[];
};

// CareerMilestone lives in @/lib/types with the other domain shapes. The
// dashboard's listCareerMilestones returns a bare number[]; the backup needs the
// date as well, so it reads through listCareerMilestonesForBackupSafe.

/**
 * v3 (2026-08-12) carries the Schedule and Career tables and every user_settings
 * column. v1 and v2 files still restore — the RPC replaces a table only when the
 * payload names its key, so an older file leaves what it never described alone.
 *
 * v4 (2026-08-16) adds three COLUMNS rather than tables: entries.logged_time,
 * entry_op_codes.is_upsell and user_settings.track_ro_time. Older files simply
 * don't carry those keys, and the builder below fills each with the value that
 * means "nobody said" — null, false, and omitted-so-keep-the-destination's.
 *
 * v5 (2026-09-12) adds entries.status (NOT NULL — a pre-v5 file fills
 * 'closed', which is what every RO that predates open tickets is) and the
 * ro_events table under `roEvents`. An unpaid_time row of kind `open_work` is
 * just a row; it needed no format change.
 */
export const CURRENT_BACKUP_VERSION = 5;
export const SUPPORTED_BACKUP_VERSIONS = [1, 2, 3, 4, 5];

/** Row payload handed to import_replace_account(). Keys are table names. */
export type ImportPayload = {
  settings: {
    split_day: number;
    period_overrides: Record<string, PeriodOverride>;
    // Optional on purpose, and the RPC must treat a missing key as "leave the
    // destination's value alone" rather than "write the default". Restoring a
    // v1/v2 file that predates these columns must not reset the goal and tag
    // colours of the account being restored into.
    goal_hours?: number;
    tag_colors?: Record<string, number>;
    reference_hourly_rate?: number | null;
    ro_template?: unknown[] | null;
    default_labor_type?: string | null;
    share_labor_times?: boolean;
    track_ro_time?: boolean;
  };
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
  work_schedules?: Record<string, unknown>[];
  days_off?: Record<string, unknown>[];
  work_shift_overrides?: Record<string, unknown>[];
  confirmed_zero_days?: Record<string, unknown>[];
  portfolio_snapshots?: Record<string, unknown>[];
  career_milestones?: Record<string, unknown>[];
  ro_events?: Record<string, unknown>[];
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

/**
 * Whether an unpaid_time row from a backup file may be restored.
 *
 * WHY THIS EXISTS
 * On 2026-08-24 the timer stopped ledgering sub-30-second holds
 * (`MIN_LEDGERED_HOLD_MS` / `isLedgerableHold` in @/lib/timer, called per hold
 * kind from saveTimerAction). Restore never learned that rule: it hands rows to
 * `import_replace_account()`, which is a bare INSERT ... jsonb_populate_recordset
 * with no validation at all. So restoring any backup taken before that date
 * re-injects every "Waiting on parts 0m" phantom row verbatim — onto the dispute
 * pack and the Insights leak board, exactly where they were removed from.
 *
 * WHY THE PREDICATE IS `hours <= 0` AND NOT `hours <= 0.01`
 * A backup carries `hours`, never the raw ms the timer gate tests. msToHours is
 * `round(ms / 3_600_000 * 100) / 100`, so the hours domain is quantised to
 * hundredths and the two populations OVERLAP:
 *
 *     hold ms        hours     ledgerable today?
 *     0 – 18s        0.00      no  (phantom)
 *     18 – 30s       0.01      no  (phantom)
 *     30 – 54s       0.01      YES (a real 45-second hold)
 *     54s+           0.02+     YES
 *
 * `hours === 0.01` is therefore genuinely ambiguous — a naive `hours <= 0.01`
 * filter would DELETE a legitimate 30-to-54-second hold on restore. Losing a
 * tech's real unpaid time is strictly worse than the bug being fixed, so the
 * filter stops at the band that cannot be anything but a phantom: hours of zero
 * means ms < 18s, which is below the 30s gate under every rounding.
 *
 * The 18-to-30-second phantoms (hours 0.01) survive on purpose. They are NOT
 * separable in the hours domain by any predicate, here or in SQL — the
 * discriminating value (raw ms) was never written to the database or the backup.
 *
 * SCOPE: timer-sourced rows only. `manual` rows are typed in by hand and
 * `zero_day` rows come from resolving an empty scheduled day (schedule.ts) —
 * neither ever passed through the 30-second gate, and a hand-entered 0-hour note
 * is the user's own record to keep.
 *
 * `Number(...)` and the `> 0` phrasing are deliberate: a hand-edited backup can
 * carry a string or NaN there, and NaN must be KEPT (every comparison is false)
 * so a weird value fails loudly downstream instead of being silently dropped.
 */
function isRestorableUnpaidTime(u: UnpaidTime): boolean {
  if (u.source !== "timer") return true;
  const hours = Number(u.hours);
  return !(hours <= 0);
}

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
  // Read through a narrowed alias so a hand-edited backup carrying extra keys
  // (is_admin being the one that matters) can't reach the payload — only the
  // fields named on ImportBundle["settings"] are ever consulted.
  const s = bundle.settings;

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
      // Spread-if-present, never defaulted: an older backup that predates these
      // columns leaves them out, and the RPC reads a missing key as "keep what
      // the destination account already has". Writing a default here would let
      // restoring a v2 file silently reset the goal hours of the account being
      // restored into — trading one silent loss for another.
      ...(s.goalHours !== undefined ? { goal_hours: s.goalHours } : {}),
      ...(s.tagColors !== undefined ? { tag_colors: s.tagColors } : {}),
      ...(s.referenceHourlyRate !== undefined
        ? { reference_hourly_rate: s.referenceHourlyRate }
        : {}),
      ...(s.roTemplates !== undefined
        ? { ro_template: s.roTemplates && s.roTemplates.length > 0 ? s.roTemplates : null }
        : {}),
      ...(s.defaultLaborType !== undefined
        ? { default_labor_type: s.defaultLaborType }
        : {}),
      // A consent flag, so it is carried verbatim when present and never
      // inferred. Its old behaviour — silently reverting to false — un-enrolled
      // a True Time contributor without telling them.
      ...(s.shareLaborTimes !== undefined
        ? { share_labor_times: s.shareLaborTimes }
        : {}),
      ...(s.trackRoTime !== undefined ? { track_ro_time: s.trackRoTime } : {}),
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
      // Nullable, so `?? null` is the whole story: a pre-v4 file never carried
      // it, and "this RO has no time recorded" is exactly right for those.
      logged_time: e.loggedTime ?? null,
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
      // NOT NULL in the database, and the RPC populates rows against a null
      // base — so a pre-v5 file without this key would write NULL and fail the
      // whole import. Every RO from before open tickets existed is a finished
      // one, so 'closed' is both the correct reading and the fix.
      status: e.status ?? "closed",
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
        // Rides with the hours. Restoring an estimate as a bare actual would
        // silently promote it to a measurement — and, worse, make it eligible
        // for the shared True Time pool it was deliberately kept out of.
        actual_source: line.actualHours === null ? null : (line.actualSource ?? null),
        // The reconciliation state. Dropping this was the worst of the silent
        // losses — it is the answer to "did the shop actually pay me for this?"
        paid_hours: line.paidHours ?? null,
        is_comeback: line.isComeback ?? false,
        // NOT NULL in the database, and the RPC populates rows against a null
        // base — so a pre-v4 file without this key would write NULL and fail the
        // whole import. `?? false` is both the correct reading and the fix.
        // Comeback wins if a hand-edited file claims both, mirroring the db layer.
        is_upsell: line.isComeback ? false : (line.isUpsell ?? false),
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
    payload.unpaid_time = bundle.unpaidTime.filter(isRestorableUnpaidTime).map((u) => ({
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

  // --- v3 sections: Schedule + Career. None of these tables is referenced by
  // anything else in the bundle, so ids are simply minted fresh rather than
  // tracked in an IdMap — there is no reference for a stale id to break.

  if (bundle.workSchedules) {
    payload.work_schedules = bundle.workSchedules.map((s) => ({
      id: newId(),
      effective_from: s.effectiveFrom,
      rotation_weeks: s.rotationWeeks,
      // anchor_monday is normally derived server-side from effective_from, but
      // it is carried verbatim here on purpose: it fixes which week of the
      // rotation is "week A". Re-deriving it on import would land a 2-week
      // rotation half a cycle out of phase and quietly change every scheduled
      // hour — and scheduled hours are the efficiency denominator.
      anchor_monday: s.anchorMonday,
      weeks: s.weeks,
      created_at: s.createdAt,
    }));
  }

  if (bundle.daysOff) {
    payload.days_off = bundle.daysOff.map((d) => ({
      id: newId(),
      // A range, not a day — one row covers a whole vacation.
      start_date: d.startDate,
      end_date: d.endDate,
      created_at: d.createdAt,
    }));
  }

  if (bundle.shiftOverrides) {
    // Read shape is a date -> shift map; the table is one row per date.
    payload.work_shift_overrides = Object.entries(bundle.shiftOverrides).map(
      ([date, shift]) => ({ date, shift, created_at: now }),
    );
  }

  if (bundle.confirmedZeroDays) {
    payload.confirmed_zero_days = bundle.confirmedZeroDays.map((date) => ({
      date,
      created_at: now,
    }));
  }

  if (bundle.portfolioSnapshots) {
    payload.portfolio_snapshots = bundle.portfolioSnapshots.map((s) => ({
      id: newId(),
      seq: s.seq,
      ro_threshold: s.roThreshold,
      // Frozen at generation and never recomputed, like a dispute — so the
      // stats travel verbatim rather than being rebuilt from the imported ROs.
      stats: s.stats,
      created_at: s.createdAt,
    }));
  }

  if (bundle.careerMilestones) {
    payload.career_milestones = bundle.careerMilestones.map((m) => ({
      threshold: m.threshold,
      // When you hit it, not when you imported it. Re-stamping would compress a
      // multi-year career into a single afternoon.
      achieved_at: m.achievedAt,
    }));
  }

  // --- v5: Open Ticket timelines. entry_id is NOT NULL, so an event whose
  // ticket is not in the bundle cannot be imported at all — dropped, like a
  // variant with no parent, rather than crashing or pointing at a stranger's
  // row. Ids are minted fresh; nothing references an event.
  if (bundle.roEvents) {
    payload.ro_events = bundle.roEvents
      .map((ev) => ({
        id: newId(),
        entry_id: entryIds.get(ev.entryId),
        date: ev.date,
        time: ev.time ?? null,
        kind: ev.kind,
        note: ev.note ?? "",
        created_at: ev.createdAt,
        updated_at: ev.updatedAt,
      }))
      .filter((ev) => ev.entry_id !== null);
  }

  return payload;
}
