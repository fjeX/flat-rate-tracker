// Data layer for concurrent job timers (Unpaid Time Engine, Phase 1).
//
// Timer state used to be three columns on the singleton user_settings row. It
// now lives in its own child table, one row per slot, for two reasons that both
// bit us before: every timer action is a read-modify-write with no lock (two
// surfaces — the PiP and the /timer page — could stomp each other on a shared
// row), and the old timer_ro_id had no foreign key, so deleting an RO left a
// dangling id and orphaned milliseconds behind forever.
//
// Both problems are structural fixes here, not app-layer discipline: separate
// rows can't collide, and entry_id/line_id are real FKs with ON DELETE SET NULL.

import type { Database } from "@/lib/supabase/database.types";
import { isTimerStatus, type TimerSlot, type TimerStatus } from "@/lib/timer";
import { getCurrentUserId, isMissingTable, type DbClient } from "./_client";

type TimerRow = Database["public"]["Tables"]["active_timers"]["Row"];

function toTimerSlot(row: TimerRow): TimerSlot {
  return {
    id: row.id,
    slot: row.slot,
    entryId: row.entry_id,
    lineId: row.line_id,
    // A status the DB CHECK allows but the app doesn't know about would be a
    // deploy-order mismatch; fall back to paused rather than accruing time
    // under a status we can't reason about.
    status: isTimerStatus(row.status) ? row.status : "paused",
    startTime: row.start_time === null ? null : Number(row.start_time),
    workAccumulated: Number(row.work_accumulated),
    holdPartsAccumulated: Number(row.hold_parts_accumulated),
    holdApprovalAccumulated: Number(row.hold_approval_accumulated),
  };
}

/** All of the user's timer slots, lowest slot number first. */
export async function listTimerSlots(supabase: DbClient): Promise<TimerSlot[]> {
  const { data, error } = await supabase
    .from("active_timers")
    .select("*")
    .order("slot", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toTimerSlot);
}

/** Null pre-migration, so the layout and timer page can fall back to "no
 * timers" instead of throwing on a half-deployed VM. */
export async function listTimerSlotsSafe(
  supabase: DbClient,
): Promise<TimerSlot[] | null> {
  try {
    return await listTimerSlots(supabase);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export type NewTimerSlot = {
  slot: number;
  entryId: string | null;
  lineId: string | null;
  status: TimerStatus;
  startTime: number | null;
};

/** Claim a slot. The DB enforces the 3-slot cap via
 * check(slot between 1 and 3) + unique(user_id, slot) — a 4th row is
 * impossible, not merely discouraged. */
export async function createTimerSlot(
  supabase: DbClient,
  input: NewTimerSlot,
): Promise<TimerSlot> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("active_timers")
    .insert({
      user_id: userId,
      slot: input.slot,
      entry_id: input.entryId,
      line_id: input.lineId,
      status: input.status,
      start_time: input.startTime,
    })
    .select()
    .single();
  if (error) throw error;
  return toTimerSlot(data);
}

export type TimerSlotPatch = {
  entryId?: string | null;
  lineId?: string | null;
  status?: TimerStatus;
  startTime?: number | null;
  workAccumulated?: number;
  holdPartsAccumulated?: number;
  holdApprovalAccumulated?: number;
};

/** Update one slot by id. RLS scopes it to the owner, so no user_id filter is
 * needed here (same pattern as deleteWorkSchedule). */
export async function updateTimerSlot(
  supabase: DbClient,
  id: string,
  patch: TimerSlotPatch,
): Promise<void> {
  const update: Database["public"]["Tables"]["active_timers"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.entryId !== undefined) update.entry_id = patch.entryId;
  if (patch.lineId !== undefined) update.line_id = patch.lineId;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.startTime !== undefined) update.start_time = patch.startTime;
  if (patch.workAccumulated !== undefined)
    update.work_accumulated = Math.max(0, Math.round(patch.workAccumulated));
  if (patch.holdPartsAccumulated !== undefined)
    update.hold_parts_accumulated = Math.max(0, Math.round(patch.holdPartsAccumulated));
  if (patch.holdApprovalAccumulated !== undefined)
    update.hold_approval_accumulated = Math.max(
      0,
      Math.round(patch.holdApprovalAccumulated),
    );

  const { error } = await supabase
    .from("active_timers")
    .update(update)
    .eq("id", id);
  if (error) throw error;
}

/** Release a slot entirely — the row goes away and the slot number frees up. */
export async function deleteTimerSlot(
  supabase: DbClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("active_timers").delete().eq("id", id);
  if (error) throw error;
}

/** Used by clearAllDataAction. Tolerates a pre-migration DB so a data wipe
 * can't be blocked by a table that doesn't exist yet. */
export async function clearAllTimerSlots(supabase: DbClient): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("active_timers")
    .delete()
    .eq("user_id", userId);
  if (error && !isMissingTable(error)) throw error;
}
