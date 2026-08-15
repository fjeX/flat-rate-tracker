"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { validate } from "@/lib/validation/core";
import {
  defaultLaborTypeSchema,
  laborRatesSchema,
} from "@/lib/validation/actions";
import type { LaborType } from "@/lib/types";

// Save the full set of rates in one shot. Each entry is a labor type and either
// a positive rate or null (= clear it). Blank inputs from the settings card
// arrive as null and delete the row.
export async function setLaborRatesAction(
  rates: { laborType: LaborType; hourlyRate: number | null }[],
): Promise<void> {
  // Validated as a whole BEFORE the first write. The old loop checked each row
  // as it reached it, so a bad rate in the third row left the first two saved —
  // half a rate table is worse than none, because every dollar figure on the
  // page is then computed from a mix.
  const clean = validate(laborRatesSchema, rates);

  const supabase = await createClient();

  for (const { laborType, hourlyRate } of clean) {
    await db.setLaborRate(supabase, laborType, hourlyRate);
  }

  // Rates change dollar figures everywhere they render.
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/history");
}

// The per-user default labor type that seeds the log form's per-line selector.
// null clears it (no default).
export async function setDefaultLaborTypeAction(
  laborType: LaborType | null,
): Promise<void> {
  const clean = validate(defaultLaborTypeSchema, laborType);
  const supabase = await createClient();
  await db.updateSettings(supabase, { defaultLaborType: clean });
  revalidatePath("/settings");
  revalidatePath("/log");
}
