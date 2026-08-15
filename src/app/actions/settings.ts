"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { addDays, formatDateLong, getNeighborPeriodKeys } from "@/lib/periods";
import {
  buildImportPayload,
  SUPPORTED_BACKUP_VERSIONS,
  type ImportBundle,
} from "@/lib/import-remap";
import { buildBackupBundle } from "@/lib/backup-bundle";
import { reportServerError } from "@/lib/report-error-server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { validate } from "@/lib/validation/core";
import {
  goalHoursSchema,
  importBundleSchema,
  periodKeySchema,
  periodOverrideSchema,
  referenceRateSchema,
  shareLaborTimesSchema,
  splitDaySchema,
  timezoneSchema,
  weekStartDaySchema,
} from "@/lib/validation/actions";
import type { Json } from "@/lib/supabase/database.types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function revalidatePeriodScreens() {
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/history");
  revalidatePath("/");
}

function revalidateAll() {
  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/log");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/timer");
  revalidatePath("/op-codes");
  revalidatePath("/settings");
}

export async function setPeriodOverrideAction(
  periodKeyArg: string,
  startArg: string,
  endArg: string,
): Promise<void> {
  const {
    periodKey,
    start,
    end,
  } = validate(periodOverrideSchema, {
    periodKey: periodKeyArg,
    start: startArg,
    end: endArg,
  });

  const supabase = await createClient();
  const settings = await db.getSettings(supabase);

  // Periods are a chain (see the header in lib/periods.ts). Moving one period's
  // boundary is allowed to move its neighbors' — that's what makes the day after
  // an early close roll into the next period on its own. What isn't allowed is
  // opening a hole against a neighbor the tech has already pinned down by hand:
  // those days would belong to no period, and no resolver can invent an answer.
  const neighbors = getNeighborPeriodKeys(periodKey);
  if (neighbors) {
    const prev = settings.periodOverrides[neighbors.prev];
    if (prev && start > addDays(prev.end, 1)) {
      throw new Error(
        `${orphanedDays(addDays(prev.end, 1), addDays(start, -1))} would belong to no pay period. The previous one ends ${formatDateLong(prev.end)}, so this one has to start ${formatDateLong(addDays(prev.end, 1))} or earlier.`,
      );
    }
    const next = settings.periodOverrides[neighbors.next];
    if (next && end < addDays(next.start, -1)) {
      throw new Error(
        `${orphanedDays(addDays(end, 1), addDays(next.start, -1))} would belong to no pay period. The next one starts ${formatDateLong(next.start)}, so this one has to end ${formatDateLong(addDays(next.start, -1))} or later.`,
      );
    }
  }

  const next = {
    ...settings.periodOverrides,
    [periodKey]: { start, end },
  };
  await db.updateSettings(supabase, { periodOverrides: next });

  revalidatePeriodScreens();
}

// "Jul 31" for a one-day hole, "Jul 31 – Aug 2" for a longer one.
function orphanedDays(from: string, to: string): string {
  return from === to
    ? formatDateLong(from)
    : `${formatDateLong(from)} – ${formatDateLong(to)}`;
}

export async function clearPeriodOverrideAction(
  periodKeyArg: string,
): Promise<void> {
  const periodKey = validate(periodKeySchema, periodKeyArg);

  const supabase = await createClient();
  const settings = await db.getSettings(supabase);
  if (!settings.periodOverrides[periodKey]) return;

  const next = { ...settings.periodOverrides };
  delete next[periodKey];
  await db.updateSettings(supabase, { periodOverrides: next });

  revalidatePeriodScreens();
}

// ---------------------------------------------------------------------------
// Settings screen actions
// ---------------------------------------------------------------------------

export async function setGoalHoursAction(goalHours: number): Promise<void> {
  const clean = validate(goalHoursSchema, goalHours);
  const supabase = await createClient();
  await db.updateSettings(supabase, { goalHours: clean });
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/history");
}

// The user-entered reference hourly rate for the pay-period Pay Check-Up.
// null clears it (no comparison shown). This is NOT a statutory figure — it's
// whatever number the user chooses to measure their effective pay against.
export async function setReferenceRateAction(
  rate: number | null,
): Promise<void> {
  const clean = validate(referenceRateSchema, rate);
  const supabase = await createClient();
  await db.updateSettings(supabase, { referenceHourlyRate: clean });
  revalidatePath("/settings");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
}

// True Time opt-in. Turning it OFF also purges the user's stored observations.
//
// The aggregation function already filters on this flag, so flipping it false is
// enough to stop the user being counted. But leaving their raw rows behind would
// mean "stop sharing" deleted nothing, which is not what that phrase means to a
// person — and it would silently resume contributing the moment they toggled it
// back on, including measurements from a period they thought was private.
export async function setShareLaborTimesAction(
  share: boolean,
): Promise<void> {
  const clean = validate(shareLaborTimesSchema, share);
  const supabase = await createClient();
  await db.updateSettings(supabase, { shareLaborTimes: clean });
  if (!clean) {
    // Tolerates a pre-migration DB — revoking consent must never error out.
    await db.clearAllLaborTimeObservations(supabase);
  }
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function setSplitDayAction(splitDay: number): Promise<void> {
  const clean = validate(splitDaySchema, splitDay);
  const supabase = await createClient();
  await db.updateSettings(supabase, { splitDay: clean });
  revalidatePeriodScreens();
  revalidatePath("/settings");
}

export async function setWeekStartDayAction(day: 0 | 1): Promise<void> {
  const clean = validate(weekStartDaySchema, day);
  const cookieStore = await cookies();
  cookieStore.set("frt_week_start", String(clean), {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });
  revalidatePath("/", "layout");
}

export async function setTimezoneAction(tz: string): Promise<void> {
  // Shape first, then existence: the schema decides this is a plausible zone
  // name, Intl decides whether it is a real one.
  const clean = validate(timezoneSchema, tz);
  try {
    Intl.DateTimeFormat(undefined, { timeZone: clean });
  } catch {
    throw new Error("Invalid timezone.");
  }
  const cookieStore = await cookies();
  cookieStore.set("frt_timezone", clean, {
    maxAge: 60 * 60 * 24 * 365 * 10,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportDataAction(): Promise<string> {
  const supabase = await createClient();

  // The heaviest read in the app: every table the user owns, serialised in one
  // go. Nobody backs up ten times an hour, and an ungated loop is a free way to
  // pin the database.
  await enforceRateLimit(
    "export-data",
    await db.getCurrentUserId(supabase),
    LIMITS.exportData,
    "Too many exports in a short time — please wait a few minutes.",
  );

  const [
    settings,
    entries,
    opCodes,
    dailyClocks,
    paidPeriods,
    entryPhotos,
    bonuses,
    laborRates,
    disputes,
    unpaidTime,
    workSchedules,
    daysOff,
    shiftOverrides,
    confirmedZeroDays,
    portfolioSnapshots,
    careerMilestones,
  ] = await Promise.all([
    db.getSettings(supabase),
    db.listEntries(supabase),
    db.listOpCodes(supabase),
    db.listDailyClocks(supabase),
    db.listPaidPeriods(supabase),
    db.listAllEntryPhotos(supabase),
    db.listBonuses(supabase),
    db.listLaborRates(supabase),
    // Safe variants: migrations are applied by hand on the VM, so a build can
    // legitimately run against a DB without these tables. They return null
    // there, and the key is then omitted below — which import reads as "this
    // backup does not describe disputes", leaving them untouched on restore.
    db.listDisputesSafe(supabase),
    db.listUnpaidTimeSafe(supabase),
    // v3. Same safe-variant rule as above — each returns null on a pre-migration
    // DB and its key is then omitted, which import reads as "this backup does
    // not describe the schedule" rather than "the schedule is empty".
    db.listWorkSchedulesSafe(supabase),
    db.listDaysOffSafe(supabase),
    db.listShiftOverridesSafe(supabase),
    db.listConfirmedZeroDaysSafe(supabase),
    db.listSnapshotsSafe(supabase),
    db.listCareerMilestonesForBackupSafe(supabase),
  ]);

  // Assembly lives in @/lib/backup-bundle so it can be tested without a
  // database. BackupParts requires a property per carried table, so forgetting
  // to fetch one above fails tsc right here rather than shipping a backup that
  // looks complete and isn't.
  return JSON.stringify(
    buildBackupBundle(
      {
        settings,
        entries,
        opCodes,
        dailyClocks,
        paidPeriods,
        entryPhotos,
        bonuses,
        laborRates,
        disputes,
        unpaidTime,
        workSchedules,
        daysOff,
        shiftOverrides,
        confirmedZeroDays,
        portfolioSnapshots,
        careerMilestones,
      },
      new Date().toISOString(),
    ),
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

// NOTE: never RE-EXPORT a type from this file — `export type { ImportBundle }`
// shipped `ReferenceError: ImportBundle is not defined` and took down every
// render that loads this module, including saving an RO.
//
// Next.js enumerates a "use server" module's exports to build the server-action
// registry and emits a runtime binding for each one. A re-exported type has no
// runtime value (it came in via a type-only import), so the emitted binding
// dangles. Declaring a type inline is fine and several sibling actions do it
// (`export type TimerSaveResult = {...}`) — an alias is erased outright; it is
// the re-export form that leaves a reference behind.
//
// tsc, eslint AND `next build` all pass on this; only loading the built page
// catches it. src/app/actions/use-server-exports.test.ts guards the pattern.
// Consumers import ImportBundle from @/lib/import-remap directly.
export async function importDataAction(bundle: ImportBundle): Promise<void> {
  // Shape check before anything reads a field off this. A backup is a FILE the
  // user chose, so it is the one input here that arrives hand-editable by
  // design — every other action is at least shaped by the app that called it.
  //
  // The parsed value is deliberately NOT used downstream. `buildImportPayload`
  // is the whitelist for what reaches the database (field by field, is_admin
  // excluded on purpose, and tested), and re-shaping a user's backup through a
  // schema on the way there could only subtract from it.
  //
  // Version first, so an old file still hears why it was refused rather than
  // being told which key inside it is the wrong type.
  if (!SUPPORTED_BACKUP_VERSIONS.includes(bundle?.version)) {
    throw new Error(`Unsupported backup version ${bundle?.version}.`);
  }
  validate(importBundleSchema, bundle);

  const supabase = await createClient();

  // Gated AFTER the shape checks, deliberately: a malformed file is refused for
  // free and never costs the user a slot in their own hourly budget. Same order
  // the auth actions use.
  await enforceRateLimit(
    "import-data",
    await db.getCurrentUserId(supabase),
    LIMITS.importData,
    "Too many imports in a short time — please wait a few minutes.",
  );

  // Validate dates up front purely to give a readable message. The import
  // itself is atomic now, so a bad value further in would roll the whole thing
  // back rather than half-apply — but "Invalid date in clock record" beats a raw
  // Postgres cast error in the UI.
  for (const e of bundle.entries) {
    if (!DATE_RE.test(e.date)) throw new Error(`Invalid date in entry RO#${e.roNumber}.`);
  }
  for (const c of bundle.dailyClocks) {
    if (!DATE_RE.test(c.date)) throw new Error("Invalid date in clock record.");
  }
  for (const b of bundle.bonuses ?? []) {
    if (!DATE_RE.test(b.date)) throw new Error("Invalid date in bonus record.");
  }
  for (const u of bundle.unpaidTime ?? []) {
    if (!DATE_RE.test(u.date)) throw new Error("Invalid date in unpaid time record.");
  }

  // Read the photo paths BEFORE the replace: the rows are about to go with the
  // entries cascade, so this is the last chance to learn which binaries the
  // account owned. Nothing is removed here — the purge runs only after the DB
  // transaction commits, so a failed import leaves the files where they are.
  const oldPhotoPaths = await db.listAllUserPhotoPaths(supabase);

  // Fresh ids for every record, all internal references re-pointed. Without
  // this the insert collides with the SOURCE account's rows on a shared
  // database (23505) and importing into a second account can never succeed.
  const payload = buildImportPayload(bundle);

  // One call, one transaction. The wipe and the restore either both land or
  // neither does — the old sequence of separate deletes and inserts could wipe
  // an account and then fail to refill it.
  const { error } = await supabase.rpc("import_replace_account", {
    payload: payload as unknown as Json,
  });
  if (error) throw error;

  // Past the point of no return: the account has been replaced. These binaries
  // belong to rows that no longer exist, so failing to remove them leaks storage
  // but corrupts nothing. Report it rather than throwing — an error here would
  // tell the user the import failed when it actually succeeded.
  if (oldPhotoPaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("ro-photos")
      .remove(oldPhotoPaths);
    if (storageError) {
      await reportServerError(storageError, { url: "importDataAction:purge-photos" });
    }
  }

  revalidateAll();
}


// ---------------------------------------------------------------------------
// Clear all data
// ---------------------------------------------------------------------------

export async function clearAllDataAction(): Promise<void> {
  const supabase = await createClient();
  const userId = await db.getCurrentUserId(supabase);

  // The most destructive action in the app. The limit is not really about load
  // — it is a brake: three wipes an hour is already far past deliberate, and a
  // scripted loop of this against a hijacked session is the worst thing a
  // signed-in caller can do to a tech's pay history.
  await enforceRateLimit(
    "clear-all-data",
    userId,
    LIMITS.clearAllData,
    "Too many data resets in a short time — please wait a while.",
  );

  // Purge photo storage objects first — deleting entries cascades the DB rows,
  // but Supabase storage doesn't cascade, so paths would otherwise be orphaned.
  const photoPaths = await db.listAllUserPhotoPaths(supabase);
  if (photoPaths.length > 0) {
    await supabase.storage.from("ro-photos").remove(photoPaths);
  }

  await supabase.from("bonuses").delete().eq("user_id", userId);
  await supabase.from("entries").delete().eq("user_id", userId);
  await supabase.from("op_codes").delete().eq("user_id", userId);
  await supabase.from("daily_clock_hours").delete().eq("user_id", userId);
  await supabase.from("paid_period_hours").delete().eq("user_id", userId);

  await db.updateSettings(supabase, { splitDay: 15, periodOverrides: {} });
  // All three tolerate a pre-migration DB — a data wipe must not be blocked by a
  // table that doesn't exist yet.
  await db.clearAllTimerSlots(supabase);
  await db.clearAllUnpaidTime(supabase);
  await db.clearAllDisputes(supabase);
  await db.clearAllLaborTimeObservations(supabase);

  revalidateAll();
}
