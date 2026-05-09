"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { Entry, OpCode, DailyClock, PaidPeriod, PeriodOverride } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function revalidatePeriodScreens() {
  revalidatePath("/pay-period");
  revalidatePath("/history");
  revalidatePath("/");
}

function revalidateAll() {
  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/log");
  revalidatePath("/history");
  revalidatePath("/pay-period");
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
  const next = {
    ...settings.periodOverrides,
    [periodKey]: { start, end },
  };
  await db.updateSettings(supabase, { periodOverrides: next });

  revalidatePeriodScreens();
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

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportDataAction(): Promise<string> {
  const supabase = await createClient();
  const [settings, entries, opCodes, dailyClocks, paidPeriods] = await Promise.all([
    db.getSettings(supabase),
    db.listEntries(supabase),
    db.listOpCodes(supabase),
    db.listDailyClocks(supabase),
    db.listPaidPeriods(supabase),
  ]);

  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        splitDay: settings.splitDay,
        periodOverrides: settings.periodOverrides,
      },
      entries,
      opCodes,
      dailyClocks,
      paidPeriods,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type ImportBundle = {
  version: number;
  exportedAt: string;
  settings: { splitDay: number; periodOverrides: Record<string, PeriodOverride> };
  entries: Entry[];
  opCodes: OpCode[];
  dailyClocks: DailyClock[];
  paidPeriods: PaidPeriod[];
};

export async function importDataAction(bundle: ImportBundle): Promise<void> {
  if (bundle.version !== 1) throw new Error("Unsupported backup version.");
  if (!Array.isArray(bundle.entries) || !Array.isArray(bundle.opCodes)) {
    throw new Error("Invalid backup format.");
  }

  const supabase = await createClient();
  const userId = await db.getCurrentUserId(supabase);

  // Wipe existing data (entries cascade entry_op_codes via FK).
  await supabase.from("entries").delete().eq("user_id", userId);
  await supabase.from("op_codes").delete().eq("user_id", userId);
  await supabase.from("daily_clock_hours").delete().eq("user_id", userId);
  await supabase.from("paid_period_hours").delete().eq("user_id", userId);

  // Insert op_codes.
  if (bundle.opCodes.length > 0) {
    const { error } = await supabase.from("op_codes").insert(
      bundle.opCodes.map((oc) => ({
        id: oc.id,
        user_id: userId,
        code: oc.code,
        description: oc.description,
        flag_hours: oc.flagHours,
        sort_order: oc.sortOrder,
        created_at: oc.createdAt,
      })),
    );
    if (error) throw error;
  }

  // Insert entries then their op code lines.
  if (bundle.entries.length > 0) {
    const { error: entriesErr } = await supabase.from("entries").insert(
      bundle.entries.map((e) => ({
        id: e.id,
        user_id: userId,
        date: e.date,
        ro_number: e.roNumber,
        vehicle_year: e.vehicle.year,
        vehicle_make: e.vehicle.make,
        vehicle_model: e.vehicle.model,
        flag_hours: e.flagHours,
        notes: e.notes,
        created_at: e.createdAt,
        updated_at: e.updatedAt,
      })),
    );
    if (entriesErr) throw entriesErr;

    const allLines = bundle.entries.flatMap((e) =>
      e.opCodes.map((oc) => ({
        id: oc.id,
        entry_id: e.id,
        op_code_id: oc.opCodeId,
        custom: oc.custom,
        custom_code: oc.customCode,
        custom_description: oc.customDescription,
        flag_hours: oc.flagHours,
        actual_hours: oc.actualHours,
        position: oc.position,
      })),
    );
    if (allLines.length > 0) {
      const { error: linesErr } = await supabase.from("entry_op_codes").insert(allLines);
      if (linesErr) throw linesErr;
    }
  }

  if (bundle.dailyClocks.length > 0) {
    const { error } = await supabase.from("daily_clock_hours").insert(
      bundle.dailyClocks.map((c) => ({
        user_id: userId,
        date: c.date,
        hours: c.hours,
      })),
    );
    if (error) throw error;
  }

  if (bundle.paidPeriods.length > 0) {
    const { error } = await supabase.from("paid_period_hours").insert(
      bundle.paidPeriods.map((p) => ({
        user_id: userId,
        period_key: p.periodKey,
        paid_flag_hours: p.paidFlagHours,
      })),
    );
    if (error) throw error;
  }

  await db.updateSettings(supabase, {
    splitDay: bundle.settings.splitDay,
    periodOverrides: bundle.settings.periodOverrides,
  });

  revalidateAll();
}

// ---------------------------------------------------------------------------
// Clear all data
// ---------------------------------------------------------------------------

export async function clearAllDataAction(): Promise<void> {
  const supabase = await createClient();
  const userId = await db.getCurrentUserId(supabase);

  await supabase.from("entries").delete().eq("user_id", userId);
  await supabase.from("op_codes").delete().eq("user_id", userId);
  await supabase.from("daily_clock_hours").delete().eq("user_id", userId);
  await supabase.from("paid_period_hours").delete().eq("user_id", userId);

  await db.updateSettings(supabase, { splitDay: 15, periodOverrides: {} });
  await db.setTimerState(supabase, { roId: null, startTime: null, accumulated: 0 });

  revalidateAll();
}
