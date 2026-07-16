// Data layer for work schedules (schedule-based efficiency plan).
//
// Design rules baked in here:
//   - schedules are effective-dated and append-only: saving a schedule with a
//     NEW effective_from adds a version; saving with an EXISTING one corrects
//     that version in place (upsert). History before a version's date never
//     recalculates.
//   - anchor_monday is derived server-side from effective_from (the week a
//     version starts is its "week A") — callers never supply it.
//   - reads tolerate a pre-migration database: the *Safe variant returns null
//     and callers hide the feature.

import type { Database, Json } from "@/lib/supabase/database.types";
import type {
  ScheduleWeek,
  ShiftDef,
  ShiftOverrideMap,
  WorkSchedule,
} from "@/lib/schedule";
import { mondayOf } from "@/lib/schedule";
import { getCurrentUserId, type DbClient } from "./_client";

type ScheduleRow = Database["public"]["Tables"]["work_schedules"]["Row"];

// Same detection as gamification.ts: PostgREST PGRST205 / Postgres 42P01.
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "PGRST205" || e.code === "42P01") return true;
  return /schema cache|does not exist/i.test(e.message ?? "");
}

function toWorkSchedule(row: ScheduleRow): WorkSchedule {
  return {
    id: row.id,
    effectiveFrom: row.effective_from,
    rotationWeeks: row.rotation_weeks === 2 ? 2 : 1,
    anchorMonday: row.anchor_monday,
    weeks: row.weeks as unknown as ScheduleWeek[],
    createdAt: row.created_at,
  };
}

/** All schedule versions, newest effective_from first. Null pre-migration —
 * lets callers hide the feature rather than crash. */
export async function listWorkSchedulesSafe(
  supabase: DbClient,
): Promise<WorkSchedule[] | null> {
  try {
    return await listWorkSchedules(supabase);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export async function listWorkSchedules(
  supabase: DbClient,
): Promise<WorkSchedule[]> {
  const { data, error } = await supabase
    .from("work_schedules")
    .select("*")
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toWorkSchedule);
}

/** Add a schedule version, or correct the existing version with the same
 * effective_from. Validation happens in the server action. */
export async function upsertWorkSchedule(
  supabase: DbClient,
  input: {
    effectiveFrom: string;
    rotationWeeks: 1 | 2;
    weeks: ScheduleWeek[];
  },
): Promise<WorkSchedule> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("work_schedules")
    .upsert(
      {
        user_id: userId,
        effective_from: input.effectiveFrom,
        rotation_weeks: input.rotationWeeks,
        anchor_monday: mondayOf(input.effectiveFrom),
        weeks: input.weeks as unknown as Json,
      },
      { onConflict: "user_id,effective_from" },
    )
    .select()
    .single();
  if (error) throw error;
  return toWorkSchedule(data);
}

/** Remove a mistaken version. The date range it covered falls back to the
 * previous version (or to no schedule at all). */
export async function deleteWorkSchedule(
  supabase: DbClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("work_schedules").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------------------
// work_shift_overrides — one-day departures from the pattern ("staying two
// hours late Thursday"). Still "scheduled" provenance; days_off marks a day
// fully off, and clocked hours record fact.
// ------------------------------------------------------------------------

/** All overrides as a date-keyed map. Null pre-migration. */
export async function listShiftOverridesSafe(
  supabase: DbClient,
): Promise<ShiftOverrideMap | null> {
  try {
    const { data, error } = await supabase
      .from("work_shift_overrides")
      .select("date, shift");
    if (error) throw error;
    const out: ShiftOverrideMap = {};
    for (const r of data ?? []) out[r.date] = r.shift as unknown as ShiftDef;
    return out;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export async function upsertShiftOverride(
  supabase: DbClient,
  date: string,
  shift: ShiftDef,
): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("work_shift_overrides")
    .upsert(
      { user_id: userId, date, shift: shift as unknown as Json },
      { onConflict: "user_id,date" },
    );
  if (error) throw error;
}

/** Back to the pattern for that day. */
export async function deleteShiftOverride(
  supabase: DbClient,
  date: string,
): Promise<void> {
  const { error } = await supabase
    .from("work_shift_overrides")
    .delete()
    .eq("date", date);
  if (error) throw error;
}

// ------------------------------------------------------------------------
// confirmed_zero_days — "yes, I worked that day and flagged nothing".
// The other resolution of an empty scheduled day is a days_off entry.
// ------------------------------------------------------------------------

/** ISO dates confirmed as real zero-work days. Null pre-migration. */
export async function listConfirmedZeroDaysSafe(
  supabase: DbClient,
): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from("confirmed_zero_days")
      .select("date")
      .order("date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => r.date);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** Idempotent — confirming twice is a no-op. */
export async function addConfirmedZeroDay(
  supabase: DbClient,
  date: string,
): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("confirmed_zero_days")
    .upsert(
      { user_id: userId, date },
      { onConflict: "user_id,date", ignoreDuplicates: true },
    );
  if (error) throw error;
}

export async function deleteConfirmedZeroDay(
  supabase: DbClient,
  date: string,
): Promise<void> {
  const { error } = await supabase
    .from("confirmed_zero_days")
    .delete()
    .eq("date", date);
  if (error) throw error;
}
