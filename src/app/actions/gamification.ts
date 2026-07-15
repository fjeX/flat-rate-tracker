"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { DayOff } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function revalidateStreakScreens() {
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function addDayOffAction(
  startDate: string,
  endDate: string,
): Promise<DayOff> {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate))
    throw new Error("Dates must be in YYYY-MM-DD format.");
  if (startDate > endDate)
    throw new Error("Start date must be on or before end date.");

  const supabase = await createClient();
  const dayOff = await db.addDayOff(supabase, startDate, endDate);
  revalidateStreakScreens();
  return dayOff;
}

export async function deleteDayOffAction(id: string): Promise<void> {
  if (!id) throw new Error("Missing day-off id.");
  const supabase = await createClient();
  await db.deleteDayOff(supabase, id);
  revalidateStreakScreens();
}
