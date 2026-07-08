"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { LABOR_TYPES } from "@/lib/earnings";
import type { LaborType } from "@/lib/types";

function isLaborType(v: string): v is LaborType {
  return (LABOR_TYPES as readonly string[]).includes(v);
}

// Save the full set of rates in one shot. Each entry is a labor type and either
// a positive rate or null (= clear it). Blank inputs from the settings card
// arrive as null and delete the row.
export async function setLaborRatesAction(
  rates: { laborType: LaborType; hourlyRate: number | null }[],
): Promise<void> {
  const supabase = await createClient();

  for (const { laborType, hourlyRate } of rates) {
    if (!isLaborType(laborType)) {
      throw new Error(`Unknown labor type: ${laborType}`);
    }
    if (
      hourlyRate !== null &&
      (!Number.isFinite(hourlyRate) || hourlyRate < 0 || hourlyRate > 9999)
    ) {
      throw new Error("Rate must be a number between 0 and 9999.");
    }
    await db.setLaborRate(supabase, laborType, hourlyRate);
  }

  // Rates change dollar figures everywhere they render.
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/pay-period");
  revalidatePath("/history");
}

// The per-user default labor type that seeds the log form's per-line selector.
// null clears it (no default).
export async function setDefaultLaborTypeAction(
  laborType: LaborType | null,
): Promise<void> {
  if (laborType !== null && !isLaborType(laborType)) {
    throw new Error(`Unknown labor type: ${laborType}`);
  }
  const supabase = await createClient();
  await db.updateSettings(supabase, { defaultLaborType: laborType });
  revalidatePath("/settings");
  revalidatePath("/log");
}
