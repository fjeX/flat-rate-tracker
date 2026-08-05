"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { addDays, formatDateLong, getNeighborPeriodKeys } from "@/lib/periods";
import {
  buildImportPayload,
  CURRENT_BACKUP_VERSION,
  SUPPORTED_BACKUP_VERSIONS,
  type ImportBundle,
} from "@/lib/import-remap";
import { reportServerError } from "@/lib/report-error-server";
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
  periodKey: string,
  start: string,
  end: string,
): Promise<void> {
  if (!periodKey) throw new Error("Period key is required.");
  if (!DATE_RE.test(start) || !DATE_RE.test(end))
    throw new Error("Dates must be in YYYY-MM-DD format.");
  if (start > end) throw new Error("Start date must be on or before end date.");

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
  periodKey: string,
): Promise<void> {
  if (!periodKey) throw new Error("Period key is required.");

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
  if (!Number.isInteger(goalHours) || goalHours < 1 || goalHours > 999) {
    throw new Error("Goal hours must be a whole number between 1 and 999.");
  }
  const supabase = await createClient();
  await db.updateSettings(supabase, { goalHours });
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
  if (
    rate !== null &&
    (!Number.isFinite(rate) || rate < 0 || rate > 9999)
  ) {
    throw new Error("Reference rate must be a number between 0 and 9999.");
  }
  const supabase = await createClient();
  await db.updateSettings(supabase, { referenceHourlyRate: rate });
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
  const supabase = await createClient();
  await db.updateSettings(supabase, { shareLaborTimes: share });
  if (!share) {
    // Tolerates a pre-migration DB — revoking consent must never error out.
    await db.clearAllLaborTimeObservations(supabase);
  }
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function setSplitDayAction(splitDay: number): Promise<void> {
  if (!Number.isInteger(splitDay) || splitDay < 1 || splitDay > 30) {
    throw new Error("Split day must be an integer between 1 and 30.");
  }
  const supabase = await createClient();
  await db.updateSettings(supabase, { splitDay });
  revalidatePeriodScreens();
  revalidatePath("/settings");
}

export async function setWeekStartDayAction(day: 0 | 1): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("frt_week_start", String(day), {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });
  revalidatePath("/", "layout");
}

export async function setTimezoneAction(tz: string): Promise<void> {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    throw new Error("Invalid timezone.");
  }
  const cookieStore = await cookies();
  cookieStore.set("frt_timezone", tz, {
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
  ]);

  return JSON.stringify(
    {
      version: CURRENT_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: {
        splitDay: settings.splitDay,
        periodOverrides: settings.periodOverrides,
      },
      entries,
      opCodes,
      dailyClocks,
      paidPeriods,
      // Photo METADATA only (paths + capture timestamps). The image binaries live
      // in the private ro-photos bucket and are NOT included in this JSON backup —
      // restoring photos would need a separate media export (follow-up: zip export).
      entryPhotos,
      // Spiffs/bonuses — real dollar data, fully restored on import (unlike photo
      // metadata, which has no binary to restore).
      bonuses,
      // v2. Pay rates price every dollar figure in the app; without them a
      // migrated account reads as $0 across the board until they're re-entered.
      laborRates,
      ...(disputes ? { disputes } : {}),
      ...(unpaidTime ? { unpaidTime } : {}),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type { ImportBundle };

export async function importDataAction(bundle: ImportBundle): Promise<void> {
  if (!SUPPORTED_BACKUP_VERSIONS.includes(bundle.version)) {
    throw new Error(`Unsupported backup version ${bundle.version}.`);
  }
  if (!Array.isArray(bundle.entries) || !Array.isArray(bundle.opCodes)) {
    throw new Error("Invalid backup format.");
  }

  const supabase = await createClient();

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
