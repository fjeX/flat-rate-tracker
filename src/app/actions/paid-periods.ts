"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { check } from "@/lib/validation/core";
import { paidPeriodSchema, periodKeySchema } from "@/lib/validation/actions";

// Record the flag hours the shop paid for a whole pay period.
//
// RETURNS { error } RATHER THAN THROWING, for the same reason the hours-writing
// actions in entries.ts do — see the note on setLineActualHoursAction. A thrown
// Error crossing the Server Actions boundary has its message replaced with a
// generic string plus a digest in a production build, so the real sentence
// ("Paid hours can't be more than …") never reaches the tech. `check()` sends it
// as data, which nothing redacts. DB failures still throw.
export async function setPaidPeriodHoursAction(
  periodKey: string,
  hours: number,
): Promise<{ error?: string }> {
  const parsed = check(paidPeriodSchema, { periodKey, hours });
  if (!parsed.ok) return { error: parsed.error };
  const clean = parsed.data;

  const supabase = await createClient();
  await db.upsertPaidPeriod(supabase, clean.periodKey, clean.hours);

  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/");
  return {};
}

// Clear the period's paid figure back to "not entered yet", which is the only
// state the tech could not get back to by hand: the input commits on blur, but
// blanking it parses to null and the commit early-returns, so a period entered
// by mistake stayed labelled settled/short/over forever.
//
// Deletes the row rather than writing 0 — see deletePaidPeriod for why the
// column can't hold "unset". Same { error } contract as the setter above, for
// the same redaction reason. DB failures still throw.
export async function deletePaidPeriodAction(
  periodKey: string,
): Promise<{ error?: string }> {
  const parsed = check(periodKeySchema, periodKey);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  await db.deletePaidPeriod(supabase, parsed.data);

  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/");
  return {};
}
