"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";

export async function upsertDailyClockHoursAction(
  date: string,
  hours: number,
): Promise<void> {
  if (!Number.isFinite(hours) || hours < 0)
    throw new Error("Hours must be a non-negative number.");

  const supabase = await createClient();
  await db.upsertDailyClock(supabase, date, hours);

  revalidatePath("/");
  revalidatePath("/pay-period");
}
