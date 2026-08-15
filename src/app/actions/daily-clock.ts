"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { validate } from "@/lib/validation/core";
import { dailyClockSchema } from "@/lib/validation/actions";

export async function upsertDailyClockHoursAction(
  date: string,
  hours: number,
): Promise<void> {
  const clean = validate(dailyClockSchema, { date, hours });

  const supabase = await createClient();
  await db.upsertDailyClock(supabase, clean.date, clean.hours);

  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/schedule");
}
