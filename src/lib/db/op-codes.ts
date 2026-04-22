// Data layer for the user's personal op code library.
import type { Database } from "@/lib/supabase/database.types";
import type { NewOpCode, OpCode, OpCodePatch } from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";

type OpCodeRow = Database["public"]["Tables"]["op_codes"]["Row"];

function toOpCode(row: OpCodeRow): OpCode {
  return {
    id: row.id,
    userId: row.user_id,
    code: row.code,
    description: row.description,
    flagHours: Number(row.flag_hours),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export async function listOpCodes(supabase: DbClient): Promise<OpCode[]> {
  const { data, error } = await supabase
    .from("op_codes")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toOpCode);
}

export async function createOpCode(
  supabase: DbClient,
  input: NewOpCode,
): Promise<OpCode> {
  const userId = await getCurrentUserId(supabase);

  // If sortOrder isn't provided, append to end of the user's library.
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const { data: existing, error: existingErr } = await supabase
      .from("op_codes")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1);
    if (existingErr) throw existingErr;
    sortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
  }

  const { data, error } = await supabase
    .from("op_codes")
    .insert({
      user_id: userId,
      code: input.code,
      description: input.description,
      flag_hours: input.flagHours,
      sort_order: sortOrder,
    })
    .select()
    .single();
  if (error) throw error;
  return toOpCode(data);
}

export async function updateOpCode(
  supabase: DbClient,
  id: string,
  patch: OpCodePatch,
): Promise<OpCode> {
  const update: Database["public"]["Tables"]["op_codes"]["Update"] = {};
  if (patch.code !== undefined) update.code = patch.code;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.flagHours !== undefined) update.flag_hours = patch.flagHours;

  const { data, error } = await supabase
    .from("op_codes")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return toOpCode(data);
}

export async function deleteOpCode(supabase: DbClient, id: string): Promise<void> {
  const { error } = await supabase.from("op_codes").delete().eq("id", id);
  if (error) throw error;
}

// Reorder the library — callers pass op code ids in the new order.
// Done as N updates; small N (personal library, dozens at most).
export async function reorderOpCodes(
  supabase: DbClient,
  orderedIds: string[],
): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("op_codes").update({ sort_order: index }).eq("id", id),
    ),
  );
}
