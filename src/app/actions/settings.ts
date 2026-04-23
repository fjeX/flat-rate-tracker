"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function revalidatePeriodScreens() {
  revalidatePath("/pay-period");
  revalidatePath("/history");
  revalidatePath("/");
}

export async function setPeriodOverrideAction(
  periodKey: string,
  start: string,
  end: string,
): Promise<void> {
  if (!periodKey) throw new Error("Period key is required.");
  if (!DATE_RE.test(start) || !DATE_RE.test(end))
    throw new Error("Dates must be in YYYY-MM-DD format.");
  if (start > end) throw new Error("Start date must be on or before end date.");

  const supabase = await createClient();
  const settings = await db.getSettings(supabase);
  const next = {
    ...settings.periodOverrides,
    [periodKey]: { start, end },
  };
  await db.updateSettings(supabase, { periodOverrides: next });

  revalidatePeriodScreens();
}

export async function clearPeriodOverrideAction(
  periodKey: string,
): Promise<void> {
  if (!periodKey) throw new Error("Period key is required.");

  const supabase = await createClient();
  const settings = await db.getSettings(supabase);
  if (!settings.periodOverrides[periodKey]) return;

  const next = { ...settings.periodOverrides };
  delete next[periodKey];
  await db.updateSettings(supabase, { periodOverrides: next });

  revalidatePeriodScreens();
}
