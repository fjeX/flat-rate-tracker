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
import { type UnpaidTimeKind } from "@/lib/types";
import { validate } from "@/lib/validation/core";
import {
  resolveZeroDaySchema,
  scheduleDateSchema,
  scheduleIdSchema,
  shiftOverrideSchema,
  workScheduleSchema,
} from "@/lib/validation/actions";

function revalidateScheduleScreens() {
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/schedule");
}

export async function saveWorkScheduleAction(input: {
  effectiveFrom: string;
  rotationWeeks: 1 | 2;
  weeks: ScheduleWeek[];
}): Promise<WorkSchedule> {
  const clean = validate(workScheduleSchema, input);
  // Shape is the schema's job; whether the PATTERN makes sense is still
  // validateWeeks', and it answers in the words the user should read.
  const problem = validateWeeks(clean.weeks, clean.rotationWeeks);
  if (problem) throw new Error(problem);

  const supabase = await createClient();
  const saved = await db.upsertWorkSchedule(supabase, clean);
  revalidateScheduleScreens();
  return saved;
}

export async function deleteWorkScheduleAction(id: string): Promise<void> {
  const scheduleId = validate(scheduleIdSchema, id);
  const supabase = await createClient();
  await db.deleteWorkSchedule(supabase, scheduleId);
  revalidateScheduleScreens();
}

/** One-day shift override, hours-first ("staying late Thursday: 10h from
 * 07:00"). Any date — a future override is a plan, and efficiency only uses
 * it once the day completes. Returns the stored shift. */
export async function setShiftOverrideAction(
  date: string,
  input: { paidHours: number; start: string; breakMin: number },
): Promise<ShiftDef> {
  const clean = validate(shiftOverrideSchema, { date, input });
  const shift = shiftFromHours(
    clean.input.paidHours,
    clean.input.start,
    clean.input.breakMin,
  );
  if (!shift)
    throw new Error(
      "That shift doesn't work — check the hours, start time, and lunch (it must end before midnight).",
    );
  const supabase = await createClient();
  await db.upsertShiftOverride(supabase, clean.date, shift);
  revalidateScheduleScreens();
  return shift;
}

/** Remove a one-day override — the day falls back to the pattern. */
export async function clearShiftOverrideAction(date: string): Promise<void> {
  const day = validate(scheduleDateSchema, date);
  const supabase = await createClient();
  await db.deleteShiftOverride(supabase, day);
  revalidateScheduleScreens();
}

/** Un-confirm a zero day — it goes back to "unresolved" (held out). */
export async function deleteConfirmedZeroDayAction(date: string): Promise<void> {
  const day = validate(scheduleDateSchema, date);
  const supabase = await createClient();
  await db.deleteConfirmedZeroDay(supabase, day);
  revalidateScheduleScreens();
}

/** Resolve an empty scheduled workday: a day off is excluded from efficiency,
 * a real zero counts its full scheduled hours against it. */
// The third resolution, "worked-unpaid", is the whole reason Phase 2 touches
// this action (bug #2 from the Phase 1 audit — "the forced lie").
//
// Before it, a scheduled day with zero flag hours offered two answers and both
// were false for a day spent on comebacks or waiting on parts:
//   - "Day off"           → poisons schedule inference; you WERE at the shop
//   - "Worked, zero flag" → permanently tanks that day's efficiency with no
//                           record of why, so the number is unexplainable later
//
// "Worked — unpaid" reuses the confirmed_zero_day marker (so the day counts as
// worked for schedule inference and the streak, exactly like the second option)
// and adds a ledger row saying where the hours actually went.
export async function resolveZeroDayAction(
  date: string,
  resolution: "day-off" | "worked-zero" | "worked-unpaid",
  unpaid?: { hours: number; kind: UnpaidTimeKind; note?: string },
): Promise<void> {
  const clean = validate(resolveZeroDaySchema, { date, resolution, unpaid });
  const day = clean.date;
  const supabase = await createClient();

  if (clean.resolution === "day-off") {
    await db.addDayOff(supabase, day, day);
    revalidateScheduleScreens();
    return;
  }

  if (clean.resolution === "worked-unpaid") {
    // The schema validates the ledger block's CONTENTS; whether one was
    // required at all depends on the resolution, which is this line's job.
    if (!clean.unpaid) throw new Error("Unpaid hours and reason are required.");

    // Ledger row FIRST. If it fails, the day stays unresolved and the card
    // stays on screen — better than marking the day settled while losing the
    // only record of why it was empty.
    await db.createUnpaidTime(supabase, {
      date: day,
      hours: clean.unpaid.hours,
      kind: clean.unpaid.kind,
      // Server-set: this row exists because a zero day was resolved, and no
      // caller gets to relabel where it came from.
      source: "zero_day",
      note: clean.unpaid.note?.trim() ?? "",
    });
    await db.addConfirmedZeroDay(supabase, day);
    revalidateScheduleScreens();
    return;
  }

  await db.addConfirmedZeroDay(supabase, day);
  revalidateScheduleScreens();
}
