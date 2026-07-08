// Data layer for spiffs / bonuses — the dollar ledger that isn't flag hours.
// Kept in its own module (like entry-photos) so it never touches the entry
// line-mapper columns. Numerics come back from PostgREST as strings, so amount
// is always Number()'d, exactly like every other numeric in this layer.
import type { Database } from "@/lib/supabase/database.types";
import type { Bonus, BonusCategory, BonusPatch, NewBonus } from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";

type BonusRow = Database["public"]["Tables"]["bonuses"]["Row"];

function toBonus(row: BonusRow): Bonus {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    // numeric(8,2) arrives as a string through PostgREST — coerce it.
    amount: Number(row.amount),
    category: row.category as BonusCategory,
    source: row.source,
    note: row.note,
    entryId: row.entry_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ------------------------------------------------------------------------
// Reads
// ------------------------------------------------------------------------

// Every bonus for the current user, newest-first. Used by the JSON export.
export async function listBonuses(supabase: DbClient): Promise<Bonus[]> {
  const { data, error } = await supabase
    .from("bonuses")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toBonus);
}

// Bonuses whose date falls in [from, to] inclusive — mirrors listEntries'
// date filtering so a pay period aggregates spiffs the same way it does ROs.
export async function listBonusesInRange(
  supabase: DbClient,
  from: string,
  to: string,
): Promise<Bonus[]> {
  const { data, error } = await supabase
    .from("bonuses")
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toBonus);
}

// All bonuses linked to one RO — powers the "linked spiffs" list in RoDetailModal.
export async function listBonusesForEntry(
  supabase: DbClient,
  entryId: string,
): Promise<Bonus[]> {
  const { data, error } = await supabase
    .from("bonuses")
    .select("*")
    .eq("entry_id", entryId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toBonus);
}

// ------------------------------------------------------------------------
// Writes
// ------------------------------------------------------------------------

export async function createBonus(
  supabase: DbClient,
  input: NewBonus,
): Promise<Bonus> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("bonuses")
    .insert({
      user_id: userId,
      date: input.date,
      amount: input.amount,
      category: input.category,
      source: input.source ?? null,
      note: input.note ?? null,
      entry_id: input.entryId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return toBonus(data);
}

export async function updateBonus(
  supabase: DbClient,
  id: string,
  patch: BonusPatch,
): Promise<Bonus> {
  const update: Database["public"]["Tables"]["bonuses"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.date !== undefined) update.date = patch.date;
  if (patch.amount !== undefined) update.amount = patch.amount;
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.source !== undefined) update.source = patch.source ?? null;
  if (patch.note !== undefined) update.note = patch.note ?? null;
  if (patch.entryId !== undefined) update.entry_id = patch.entryId ?? null;

  const { data, error } = await supabase
    .from("bonuses")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return toBonus(data);
}

export async function deleteBonus(supabase: DbClient, id: string): Promise<void> {
  const { error } = await supabase.from("bonuses").delete().eq("id", id);
  if (error) throw error;
}
