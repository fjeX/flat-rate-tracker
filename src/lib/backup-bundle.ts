// Assembles the exported backup file from data already fetched.
//
// WHY THIS IS NOT INSIDE exportDataAction
// Backup/import is a hand-typed mirror of the schema in four places: this file,
// ImportBundle, buildImportPayload, and the import_replace_account RPC.
// backup-manifest.ts already binds the last three together — a table marked
// `carry` that buildImportPayload forgets fails the manifest test.
//
// The EXPORT end had no such binding, and that is the end that actually broke.
// Six tables were missing from every backup written before 2026-08-12 not
// because the payload builder dropped them, but because nothing ever fetched
// them. A test cannot catch that while the fetch and the assembly live inside a
// "use server" action that needs a Supabase client, next/headers and a live DB
// to call at all — so the assembly moved here, where it is a pure function of
// its inputs and a test can hand it one row per table.
//
// TWO GUARDS, DELIBERATELY DIFFERENT IN KIND
//   * BackupParts requires a property per carried table, so an export that
//     forgets to FETCH one fails tsc at the call site.
//   * backup-bundle.test.ts walks BACKUP_MANIFEST and asserts every carried
//     table's bundleKey is present in the built bundle, so an export that
//     fetches a table and forgets to EMIT it fails the suite.
//
// Neither catches the other's case, which is why both exist.

import { CURRENT_BACKUP_VERSION, type ImportBundle } from "@/lib/import-remap";
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
  PortfolioSnapshot,
  UnpaidTime,
  UserSettings,
} from "@/lib/types";
import type { ShiftOverrideMap, WorkSchedule } from "@/lib/schedule";

/**
 * Everything a backup is built from. Every property is REQUIRED — that is the
 * point of the type. Tables read through a `…Safe` variant are typed
 * `T[] | null` because migrations are applied by hand on the VM and a build can
 * legitimately run against a database that predates the table; null means "this
 * backup does not describe that table", which import reads as "leave it alone"
 * rather than "it is empty".
 */
export type BackupParts = {
  settings: UserSettings;
  entries: Entry[];
  opCodes: OpCode[];
  dailyClocks: DailyClock[];
  paidPeriods: PaidPeriod[];
  /** Metadata only; the binaries live in the private ro-photos bucket. */
  entryPhotos: unknown[];
  bonuses: Bonus[];
  laborRates: LaborRate[];
  disputes: Dispute[] | null;
  unpaidTime: UnpaidTime[] | null;
  workSchedules: WorkSchedule[] | null;
  daysOff: DayOff[] | null;
  shiftOverrides: ShiftOverrideMap | null;
  confirmedZeroDays: string[] | null;
  portfolioSnapshots: PortfolioSnapshot[] | null;
  careerMilestones: CareerMilestone[] | null;
};

export function buildBackupBundle(parts: BackupParts, exportedAt: string): ImportBundle {
  const s = parts.settings;

  return {
    version: CURRENT_BACKUP_VERSION,
    exportedAt,

    // v3 widened this from two fields to eight. The other six were silently
    // dropped by every backup written before 2026-08-12, so a migrated account
    // came up with the DESTINATION's goal, tag colours, templates and rate.
    // shareLaborTimes was the worst: it reverted to false and quietly
    // un-enrolled a True Time contributor.
    //
    // is_admin is absent because getSettings never reads it — a backup is a file
    // the user can edit, and a settings shape that accepts a privilege flag is a
    // privilege escalation. The RPC refuses it independently.
    settings: {
      splitDay: s.splitDay,
      periodOverrides: s.periodOverrides,
      goalHours: s.goalHours,
      tagColors: s.tagColors,
      referenceHourlyRate: s.referenceHourlyRate,
      roTemplates: s.roTemplates,
      defaultLaborType: s.defaultLaborType,
      shareLaborTimes: s.shareLaborTimes,
      // v4. Entry-level logged_time and line-level is_upsell need no mention
      // here — they ride inside parts.entries, which is carried whole.
      trackRoTime: s.trackRoTime,
    },

    entries: parts.entries,
    opCodes: parts.opCodes,
    dailyClocks: parts.dailyClocks,
    paidPeriods: parts.paidPeriods,
    // Photo METADATA only (paths + capture timestamps). The image binaries are
    // NOT in this JSON — restoring them needs a separate media export, and the
    // import preflight warns with a count.
    entryPhotos: parts.entryPhotos,
    // Spiffs/bonuses — real dollar data, fully restored on import (unlike photo
    // metadata, which has no binary to restore).
    bonuses: parts.bonuses,
    // v2. Pay rates price every dollar figure in the app; without them a
    // migrated account reads as $0 across the board until they're re-entered.
    laborRates: parts.laborRates,

    // Omitted-when-null, and the omission is MEANINGFUL: the RPC replaces a
    // table only when the payload carries its key.
    ...(parts.disputes ? { disputes: parts.disputes } : {}),
    ...(parts.unpaidTime ? { unpaidTime: parts.unpaidTime } : {}),

    // v3 — Schedule and Career. workSchedules is the load-bearing one: it is the
    // denominator the efficiency engine divides by, so an account restored
    // without it doesn't show blanks, it shows DIFFERENT numbers.
    ...(parts.workSchedules ? { workSchedules: parts.workSchedules } : {}),
    ...(parts.daysOff ? { daysOff: parts.daysOff } : {}),
    ...(parts.shiftOverrides ? { shiftOverrides: parts.shiftOverrides } : {}),
    ...(parts.confirmedZeroDays ? { confirmedZeroDays: parts.confirmedZeroDays } : {}),
    ...(parts.portfolioSnapshots ? { portfolioSnapshots: parts.portfolioSnapshots } : {}),
    ...(parts.careerMilestones ? { careerMilestones: parts.careerMilestones } : {}),
  };
}
