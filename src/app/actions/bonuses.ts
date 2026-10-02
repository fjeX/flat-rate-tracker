"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { Refusal, refusable } from "@/lib/refusal";
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

// The write actions RETURN `{ error }` for a refusal (a bad figure, a spiff
// that's gone) instead of throwing it: a production build masks the message of
// an error thrown out of a Server Action, so the sentence would never reach
// the tech (server-action-thrown-refusals-masked). DB failures still throw.
export async function createBonusAction(
  input: NewBonus,
): Promise<Bonus | { error: string }> {
  return refusable(async () => {
    const clean = validate(newBonusSchema, input);
    const supabase = await createClient();
    const bonus = await db.createBonus(supabase, bonusColumns(clean));
    revalidateBonusScreens();
    return bonus;
  });
}

export async function updateBonusAction(
  id: string,
  input: NewBonus,
): Promise<Bonus | { error: string }> {
  return refusable(async () => {
    const bonusId = validate(bonusIdSchema, id);
    const clean = validate(newBonusSchema, input);
    const supabase = await createClient();
    const bonus = await db.updateBonus(supabase, bonusId, bonusColumns(clean));
    // null = the update matched no row: already deleted, or not this account's.
    // Reporting that as a save would leave the form showing edited numbers that
    // are not in the ledger, which is worse than an error on the money screen.
    if (!bonus) {
      throw new Refusal("That spiff no longer exists — nothing was saved.");
    }
    revalidateBonusScreens();
    return bonus;
  });
}

export async function deleteBonusAction(
  id: string,
): Promise<{ error?: string }> {
  return refusable(async () => {
    const bonusId = validate(bonusIdSchema, id);
    const supabase = await createClient();
    // false = nothing matched, so nothing was deleted. Refusing (rather than
    // returning quietly) is what puts it in front of the tech: SpiffsCard is
    // the only thing that reports a failed money delete out loud.
    if (!(await db.deleteBonus(supabase, bonusId))) {
      throw new Refusal(
        "That spiff was not deleted — it may already be gone. Refresh and try again.",
      );
    }
    revalidateBonusScreens();
    return {};
  });
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
