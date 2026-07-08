"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { BONUS_CATEGORIES } from "@/lib/bonuses";
import type { Bonus, BonusCategory, NewBonus } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isBonusCategory(v: string): v is BonusCategory {
  return (BONUS_CATEGORIES as readonly string[]).includes(v);
}

function revalidateBonusScreens() {
  revalidatePath("/pay-period");
  revalidatePath("/dashboard");
  revalidatePath("/history");
}

// Validate the shared fields for create/update. Amounts are dollars — allow
// cents but keep them sane (numeric(8,2) tops out below 1,000,000).
function validate(input: NewBonus): void {
  if (!DATE_RE.test(input.date)) {
    throw new Error("Date must be in YYYY-MM-DD format.");
  }
  if (!isBonusCategory(input.category)) {
    throw new Error(`Unknown category: ${input.category}`);
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 999999) {
    throw new Error("Amount must be a positive dollar figure.");
  }
}

export async function createBonusAction(input: NewBonus): Promise<Bonus> {
  validate(input);
  const supabase = await createClient();
  const bonus = await db.createBonus(supabase, {
    date: input.date,
    amount: input.amount,
    category: input.category,
    source: input.source?.trim() || null,
    note: input.note?.trim() || null,
    entryId: input.entryId ?? null,
  });
  revalidateBonusScreens();
  return bonus;
}

export async function updateBonusAction(
  id: string,
  input: NewBonus,
): Promise<Bonus> {
  if (!id) throw new Error("Bonus ID is required.");
  validate(input);
  const supabase = await createClient();
  const bonus = await db.updateBonus(supabase, id, {
    date: input.date,
    amount: input.amount,
    category: input.category,
    source: input.source?.trim() || null,
    note: input.note?.trim() || null,
    entryId: input.entryId ?? null,
  });
  revalidateBonusScreens();
  return bonus;
}

export async function deleteBonusAction(id: string): Promise<void> {
  if (!id) throw new Error("Bonus ID is required.");
  const supabase = await createClient();
  await db.deleteBonus(supabase, id);
  revalidateBonusScreens();
}

// Read-only: bonuses linked to one RO, for the RoDetailModal "linked spiffs" list.
export async function listBonusesForEntryAction(
  entryId: string,
): Promise<Bonus[]> {
  if (!entryId) return [];
  const supabase = await createClient();
  return db.listBonusesForEntry(supabase, entryId);
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
  const supabase = await createClient();
  const entries = await db.listEntries(supabase, { limit });
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
