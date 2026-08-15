"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { validate } from "@/lib/validation/core";
import {
  bonusIdSchema,
  entryIdSchema,
  newBonusSchema,
  recentRosLimitSchema,
} from "@/lib/validation/actions";
import type { Bonus, NewBonus } from "@/lib/types";

function revalidateBonusScreens() {
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/dashboard");
  revalidatePath("/history");
}

// The columns a spiff is made of. Written out rather than spread so a field
// the schema doesn't know about can't reach the write even if one is added to
// the type later.
function bonusColumns(input: NewBonus) {
  return {
    date: input.date,
    amount: input.amount,
    category: input.category,
    source: input.source?.trim() || null,
    note: input.note?.trim() || null,
    entryId: input.entryId ?? null,
  };
}

export async function createBonusAction(input: NewBonus): Promise<Bonus> {
  const clean = validate(newBonusSchema, input);
  const supabase = await createClient();
  const bonus = await db.createBonus(supabase, bonusColumns(clean));
  revalidateBonusScreens();
  return bonus;
}

export async function updateBonusAction(
  id: string,
  input: NewBonus,
): Promise<Bonus> {
  const bonusId = validate(bonusIdSchema, id);
  const clean = validate(newBonusSchema, input);
  const supabase = await createClient();
  const bonus = await db.updateBonus(supabase, bonusId, bonusColumns(clean));
  revalidateBonusScreens();
  return bonus;
}

export async function deleteBonusAction(id: string): Promise<void> {
  const bonusId = validate(bonusIdSchema, id);
  const supabase = await createClient();
  await db.deleteBonus(supabase, bonusId);
  revalidateBonusScreens();
}

// Read-only: bonuses linked to one RO, for the RoDetailModal "linked spiffs" list.
export async function listBonusesForEntryAction(
  entryId: string,
): Promise<Bonus[]> {
  if (!entryId) return [];
  const id = validate(entryIdSchema, entryId);
  const supabase = await createClient();
  return db.listBonusesForEntry(supabase, id);
}

// Recent ROs for the optional "attach to RO" picker in the spiff form. Kept slim
// (id + number + date + a vehicle summary) so the picker stays lightweight.
export type RecentRo = {
  id: string;
  roNumber: string;
  date: string;
  vehicleSummary: string;
};

export async function listRecentRosAction(limit = 20): Promise<RecentRo[]> {
  const clean = validate(recentRosLimitSchema, limit);
  const supabase = await createClient();
  const entries = await db.listEntries(supabase, { limit: clean });
  return entries.map((e) => ({
    id: e.id,
    roNumber: e.roNumber,
    date: e.date,
    vehicleSummary: [e.vehicle.year, e.vehicle.make, e.vehicle.model]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" "),
  }));
}
