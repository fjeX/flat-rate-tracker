"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import {
  shiftFromHours,
  validateWeeks,
  type ScheduleWeek,
  type ShiftDef,
  type WorkSchedule,
} from "@/lib/schedule";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function revalidateScheduleScreens() {
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath("/pay-period");
  revalidatePath("/schedule");
}

export async function saveWorkScheduleAction(input: {
  effectiveFrom: string;
  rotationWeeks: 1 | 2;
  weeks: ScheduleWeek[];
}): Promise<WorkSchedule> {
  if (!DATE_RE.test(input.effectiveFrom))
    throw new Error("Effective date must be in YYYY-MM-DD format.");
  if (input.rotationWeeks !== 1 && input.rotationWeeks !== 2)
    throw new Error("Rotation must be 1 or 2 weeks.");
  const problem = validateWeeks(input.weeks, input.rotationWeeks);
  if (problem) throw new Error(problem);

  const supabase = await createClient();
  const saved = await db.upsertWorkSchedule(supabase, input);
  revalidateScheduleScreens();
  return saved;
}

export async function deleteWorkScheduleAction(id: string): Promise<void> {
  if (!id) throw new Error("Missing schedule id.");
  const supabase = await createClient();
  await db.deleteWorkSchedule(supabase, id);
  revalidateScheduleScreens();
}

/** One-day shift override, hours-first ("staying late Thursday: 10h from
 * 07:00"). Any date — a future override is a plan, and efficiency only uses
 * it once the day completes. Returns the stored shift. */
export async function setShiftOverrideAction(
  date: string,
  input: { paidHours: number; start: string; breakMin: number },
): Promise<ShiftDef> {
  if (!DATE_RE.test(date)) throw new Error("Date must be in YYYY-MM-DD format.");
  const shift = shiftFromHours(input.paidHours, input.start, input.breakMin);
  if (!shift)
    throw new Error(
      "That shift doesn't work — check the hours, start time, and lunch (it must end before midnight).",
    );
  const supabase = await createClient();
  await db.upsertShiftOverride(supabase, date, shift);
  revalidateScheduleScreens();
  return shift;
}

/** Remove a one-day override — the day falls back to the pattern. */
export async function clearShiftOverrideAction(date: string): Promise<void> {
  if (!DATE_RE.test(date)) throw new Error("Date must be in YYYY-MM-DD format.");
  const supabase = await createClient();
  await db.deleteShiftOverride(supabase, date);
  revalidateScheduleScreens();
}

/** Un-confirm a zero day — it goes back to "unresolved" (held out). */
export async function deleteConfirmedZeroDayAction(date: string): Promise<void> {
  if (!DATE_RE.test(date)) throw new Error("Date must be in YYYY-MM-DD format.");
  const supabase = await createClient();
  await db.deleteConfirmedZeroDay(supabase, date);
  revalidateScheduleScreens();
}

/** Resolve an empty scheduled workday: a day off is excluded from efficiency,
 * a real zero counts its full scheduled hours against it. */
export async function resolveZeroDayAction(
  date: string,
  resolution: "day-off" | "worked-zero",
): Promise<void> {
  if (!DATE_RE.test(date)) throw new Error("Date must be in YYYY-MM-DD format.");
  const supabase = await createClient();
  if (resolution === "day-off") {
    await db.addDayOff(supabase, date, date);
  } else {
    await db.addConfirmedZeroDay(supabase, date);
  }
  revalidateScheduleScreens();
}
