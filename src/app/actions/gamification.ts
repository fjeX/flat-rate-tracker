"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { validate } from "@/lib/validation/core";
import { dayOffIdSchema, dayOffSchema } from "@/lib/validation/actions";
import type { DayOff } from "@/lib/types";

function revalidateStreakScreens() {
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function addDayOffAction(
  startDate: string,
  endDate: string,
): Promise<DayOff> {
  const clean = validate(dayOffSchema, { startDate, endDate });

  const supabase = await createClient();
  const dayOff = await db.addDayOff(supabase, clean.startDate, clean.endDate);
  revalidateStreakScreens();
  return dayOff;
}

export async function deleteDayOffAction(id: string): Promise<void> {
  const dayOffId = validate(dayOffIdSchema, id);
  const supabase = await createClient();
  await db.deleteDayOff(supabase, dayOffId);
  revalidateStreakScreens();
}
