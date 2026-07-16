"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";

export async function upsertDailyClockHoursAction(
  date: string,
  hours: number,
): Promise<void> {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE_RE.test(date)) throw new Error("Invalid date format.");
  if (!Number.isFinite(hours) || hours < 0)
    throw new Error("Hours must be a non-negative number.");

  const supabase = await createClient();
  await db.upsertDailyClock(supabase, date, hours);

  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/schedule");
}
