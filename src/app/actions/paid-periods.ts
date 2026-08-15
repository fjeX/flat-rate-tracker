"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { validate } from "@/lib/validation/core";
import { paidPeriodSchema } from "@/lib/validation/actions";

export async function setPaidPeriodHoursAction(
  periodKey: string,
  hours: number,
): Promise<void> {
  const clean = validate(paidPeriodSchema, { periodKey, hours });

  const supabase = await createClient();
  await db.upsertPaidPeriod(supabase, clean.periodKey, clean.hours);

  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/");
}
