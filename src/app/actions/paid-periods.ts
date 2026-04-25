"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";

export async function setPaidPeriodHoursAction(
  periodKey: string,
  hours: number,
): Promise<void> {
  if (!periodKey) throw new Error("Period key is required.");
  if (!Number.isFinite(hours) || hours < 0)
    throw new Error("Paid hours must be a non-negative number.");

  const supabase = await createClient();
  await db.upsertPaidPeriod(supabase, periodKey, hours);

  revalidatePath("/pay-period");
  revalidatePath("/");
}
