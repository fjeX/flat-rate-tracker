// Data layer for the user's personal op code library.
import type { Database } from "@/lib/supabase/database.types";
import type { NewOpCode, OpCode, OpCodePatch, SubOpCode } from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";

type OpCodeRow = Database["public"]["Tables"]["op_codes"]["Row"];
type OpCodeVariantRow = Database["public"]["Tables"]["op_code_variants"]["Row"];

function toSubOpCode(row: OpCodeVariantRow): SubOpCode {
  return {
    id: row.id,
    opCodeId: row.op_code_id,
    userId: row.user_id,
    code: row.code,
    description: row.description,
    flagHours: Number(row.flag_hours),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function toOpCode(row: OpCodeRow, variants: OpCodeVariantRow[]): OpCode {
  return {
    id: row.id,
    userId: row.user_id,
    code: row.code,
    description: row.description,
    flagHours: Number(row.flag_hours),
    notes: row.notes ?? "",
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    subOpCodes: variants
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(toSubOpCode),
  };
}

export async function listOpCodes(supabase: DbClient): Promise<OpCode[]> {
  const [opResult, varResult] = await Promise.all([
    supabase.from("op_codes").select("*").order("sort_order", { ascending: true }),
    supabase.from("op_code_variants").select("*"),
  ]);
  if (opResult.error) throw opResult.error;
  if (varResult.error) throw varResult.error;

  const variantsByParent = new Map<string, OpCodeVariantRow[]>();
  for (const v of varResult.data ?? []) {
    const list = variantsByParent.get(v.op_code_id) ?? [];
    list.push(v);
    variantsByParent.set(v.op_code_id, list);
  }

  return (opResult.data ?? []).map((row) =>
    toOpCode(row, variantsByParent.get(row.id) ?? []),
  );
}

export async function getOpCode(
  supabase: DbClient,
  id: string,
): Promise<OpCode | null> {
  const [opResult, varResult] = await Promise.all([
    supabase.from("op_codes").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("op_code_variants")
      .select("*")
      .eq("op_code_id", id)
      .order("sort_order", { ascending: true }),
  ]);
  if (opResult.error) throw opResult.error;
  if (varResult.error) throw varResult.error;
  if (!opResult.data) return null;
  return toOpCode(opResult.data, varResult.data ?? []);
}

export async function createOpCode(
  supabase: DbClient,
  input: NewOpCode,
): Promise<OpCode> {
  const userId = await getCurrentUserId(supabase);

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
      ...(input.notes ? { notes: input.notes } : {}),
      sort_order: sortOrder,
    })
    .select()
    .single();
  if (error) throw error;
  return toOpCode(data, []);
}

export async function updateOpCode(
  supabase: DbClient,
  id: string,
  patch: OpCodePatch,
): Promise<void> {
  const update: Database["public"]["Tables"]["op_codes"]["Update"] = {};
  if (patch.code !== undefined) update.code = patch.code;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.flagHours !== undefined) update.flag_hours = patch.flagHours;
  if (patch.notes !== undefined) update.notes = patch.notes;

  const { error } = await supabase
    .from("op_codes")
    .update(update)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteOpCode(supabase: DbClient, id: string): Promise<void> {
  const { error } = await supabase.from("op_codes").delete().eq("id", id);
  if (error) throw error;
}

// Reorder the library — callers pass op code ids in the new order.
// Uses a single Postgres RPC instead of N parallel UPDATE round trips.
export async function reorderOpCodes(
  supabase: DbClient,
  orderedIds: string[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  const updates = orderedIds.map((id, index) => ({ id, sort_order: index }));
  const { error } = await supabase.rpc("reorder_op_codes", { updates });
  if (error) throw error;
}

// ── Sub op code (variant) operations ──────────────────────────────────────

export type NewSubOpCodeInput = {
  code: string;
  description: string;
  flagHours: number;
  sortOrder: number;
};

export async function insertSubOpCode(
  supabase: DbClient,
  parentId: string,
  userId: string,
  input: NewSubOpCodeInput,
): Promise<SubOpCode> {
  const { data, error } = await supabase
    .from("op_code_variants")
    .insert({
      op_code_id: parentId,
      user_id: userId,
      code: input.code,
      description: input.description,
      flag_hours: input.flagHours,
      sort_order: input.sortOrder,
    })
    .select()
    .single();
  if (error) throw error;
  return toSubOpCode(data);
}

export async function updateSubOpCode(
  supabase: DbClient,
  id: string,
  patch: { code?: string; description?: string; flagHours?: number; sortOrder?: number },
): Promise<void> {
  const update: Database["public"]["Tables"]["op_code_variants"]["Update"] = {};
  if (patch.code !== undefined) update.code = patch.code;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.flagHours !== undefined) update.flag_hours = patch.flagHours;
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;

  const { error } = await supabase
    .from("op_code_variants")
    .update(update)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteSubOpCodes(
  supabase: DbClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("op_code_variants")
    .delete()
    .in("id", ids);
  if (error) throw error;
}
