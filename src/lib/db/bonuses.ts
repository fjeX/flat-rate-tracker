// Data layer for spiffs / bonuses — the dollar ledger that isn't flag hours.
// Kept in its own module (like entry-photos) so it never touches the entry
// line-mapper columns. Numerics come back from PostgREST as strings, so amount
// is always Number()'d, exactly like every other numeric in this layer.
import type { Database } from "@/lib/supabase/database.types";
import type { Bonus, BonusCategory, BonusPatch, NewBonus } from "@/lib/types";
import { getCurrentUserId, type DbClient, retryOnce} from "./_client";

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
// retryOnce: read during the /pay-period render's Promise.all, not just by the
// JSON export.
export async function listBonuses(supabase: DbClient): Promise<Bonus[]> {
  const data = await retryOnce(async () => {
    const { data, error } = await supabase
      .from("bonuses")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });
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

/**
 * Patch exactly ONE spiff, by primary key, and say whether it landed.
 *
 * The `user_id` filter is belt-and-braces over RLS (`own_bonuses` is `for all
 * using (user_id = auth.uid()) with check (user_id = auth.uid())`). It is here
 * so ownership is enforced by this function's own SQL rather than only by a
 * policy in a migration — and so it is testable without a database.
 *
 * Returns null when nothing matched: the row is already gone, or it is not this
 * account's. The previous `.select().single()` collapsed those into a PGRST116
 * whose message ("JSON object requested, multiple (or no) rows returned") tells
 * a tech nothing about their money; the caller turns null into a sentence.
 */
export async function updateBonus(
  supabase: DbClient,
  id: string,
  patch: BonusPatch,
): Promise<Bonus | null> {
  const userId = await getCurrentUserId(supabase);
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
    .eq("user_id", userId)
    .select();
  if (error) throw error;
  // `id` is the primary key, so this is 0 or 1 — never a range. The full row is
  // selected rather than just the id because the caller hands the saved spiff
  // straight back to the form; it is the same request either way.
  const rows = data ?? [];
  return rows.length === 1 ? toBonus(rows[0]) : null;
}

/**
 * Delete exactly ONE spiff, by primary key.
 *
 * BY `id` AND NOTHING ELSE, and never in bulk. This is the dollar ledger: on
 * 2026-08-19 a mis-click hard-deleted a real $35 spiff that no backup could
 * return, and spiffs are not distinguishable by value — two $25 "spiff" rows on
 * the same date are routine, so any delete phrased as a predicate over amount,
 * date or category destroys money the tech is about to reconcile against a
 * paystub. There is no bulk path here on purpose.
 *
 * The `user_id` filter is belt-and-braces over RLS (`own_bonuses` is `for all
 * using (user_id = auth.uid())`). It is here so ownership is enforced by this
 * function's own SQL rather than only by a policy in a migration — and so it is
 * testable without a database.
 *
 * Returns false when nothing matched: the row is already gone, or it is not
 * this account's. Without the `.select("id")` this function could not tell a
 * deleted row from a no-op and reported both as success — and a failed delete
 * reported as success is exactly how "it worked, the screen just didn't
 * repaint" gets believed about money.
 */
export async function deleteBonus(
  supabase: DbClient,
  id: string,
): Promise<boolean> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("bonuses")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  // `id` is the primary key, so this is 0 or 1 — never a range.
  return (data ?? []).length === 1;
}
