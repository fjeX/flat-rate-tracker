// Data layer for the unpaid-time ledger (Unpaid Time Engine, Phase 1).
//
// Every hour a flat-rate tech spends at the shop earning nothing lands here:
// comebacks (their own or someone else's), same-visit rework, and waiting on
// parts or approvals. Rows arrive three ways — written automatically when a
// timer slot's hold time is banked (`source: "timer"`), from resolving an empty
// scheduled day (`"zero_day"`), or typed in directly (`"manual"`).
//
// Shape mirrors bonuses.ts: dollar-agnostic hours plus an optional RO link,
// range-filtered by the caller for period math.

import type { Database } from "@/lib/supabase/database.types";
import {
  isUnpaidTimeKind,
  type NewUnpaidTime,
  type UnpaidTime,
  type UnpaidTimePatch,
  type UnpaidTimeSource,
} from "@/lib/types";
import {
  getCurrentUserId,
  isMissingTable,
  retryOnce,
  type DbClient,
} from "./_client";

type UnpaidTimeRow = Database["public"]["Tables"]["unpaid_time"]["Row"];

function toSource(raw: string): UnpaidTimeSource {
  return raw === "timer" || raw === "zero_day" ? raw : "manual";
}

function toUnpaidTime(row: UnpaidTimeRow): UnpaidTime {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    hours: Number(row.hours),
    // A kind the DB allows but this build doesn't know about means the code is
    // older than the schema. Bucketing it as generic shop time keeps the hours
    // in the totals rather than silently dropping them.
    kind: isUnpaidTimeKind(row.kind) ? row.kind : "shop_time",
    entryId: row.entry_id,
    originalEntryId: row.original_entry_id,
    source: toSource(row.source),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Ledger rows, newest first. Optional inclusive date range. */
export async function listUnpaidTime(
  supabase: DbClient,
  range?: { from?: string; to?: string },
): Promise<UnpaidTime[]> {
  const data = await retryOnce(async () => {
    let q = supabase.from("unpaid_time").select("*");
    if (range?.from) q = q.gte("date", range.from);
    if (range?.to) q = q.lte("date", range.to);
    const { data, error } = await q
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });
  return (data ?? []).map(toUnpaidTime);
}

/** Null pre-migration — callers hide the feature rather than crash. */
export async function listUnpaidTimeSafe(
  supabase: DbClient,
  range?: { from?: string; to?: string },
): Promise<UnpaidTime[] | null> {
  try {
    return await listUnpaidTime(supabase, range);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** Validation lives in the server action, same as bonuses. */
export async function createUnpaidTime(
  supabase: DbClient,
  input: NewUnpaidTime,
): Promise<UnpaidTime> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("unpaid_time")
    .insert({
      user_id: userId,
      date: input.date,
      hours: input.hours,
      kind: input.kind,
      entry_id: input.entryId ?? null,
      original_entry_id: input.originalEntryId ?? null,
      source: input.source ?? "manual",
      note: input.note ?? "",
    })
    .select()
    .single();
  if (error) throw error;
  return toUnpaidTime(data);
}

/** Timer-written rows can be created before the migration lands on a
 * half-deployed VM. Banking hold time must never break the save that carries
 * the tech's actual working hours — the working time is the load-bearing half.
 * Returns false when the row was dropped so callers can say so. */
export async function createUnpaidTimeSafe(
  supabase: DbClient,
  input: NewUnpaidTime,
): Promise<boolean> {
  try {
    await createUnpaidTime(supabase, input);
    return true;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

export async function updateUnpaidTime(
  supabase: DbClient,
  id: string,
  patch: UnpaidTimePatch,
): Promise<void> {
  const update: Database["public"]["Tables"]["unpaid_time"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.date !== undefined) update.date = patch.date;
  if (patch.hours !== undefined) update.hours = patch.hours;
  if (patch.kind !== undefined) update.kind = patch.kind;
  if (patch.entryId !== undefined) update.entry_id = patch.entryId;
  if (patch.originalEntryId !== undefined)
    update.original_entry_id = patch.originalEntryId;
  if (patch.note !== undefined) update.note = patch.note;

  const { error } = await supabase.from("unpaid_time").update(update).eq("id", id);
  if (error) throw error;
}

/**
 * Delete exactly ONE ledger row, by primary key.
 *
 * BY `id` AND NOTHING ELSE. A row's `hours` cannot identify it: msToHours
 * quantises to hundredths, so a stored 0.01h covers 18s–54s of real hold time
 * and the 30s ledger gate sits inside that band — a genuine 30–54s hold and an
 * old pre-gate phantom are the SAME VALUE. Any delete phrased as a predicate
 * over hours (or a "clear the phantoms" sweep) therefore destroys real rework a
 * tech is about to hand a service manager. There is no bulk path here on
 * purpose; if one is ever wanted, this comment is the reason it can't be a
 * value match.
 *
 * The `user_id` filter is belt-and-braces over RLS (`own_unpaid_time` is `for
 * all using (user_id = auth.uid())`). It is here so ownership is enforced by
 * this function's own SQL rather than only by a policy in a migration — and so
 * it is testable without a database.
 *
 * Returns false when nothing matched: the row is already gone, or it is not
 * this user's. Deliberately NOT an exception — the caller reports it as data,
 * and a silent no-op reported as success is how a failed delete gets read as
 * "it worked, the screen just didn't repaint".
 */
export async function deleteUnpaidTime(
  supabase: DbClient,
  id: string,
): Promise<boolean> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("unpaid_time")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  // `id` is the primary key, so this is 0 or 1 — never a range.
  return (data ?? []).length === 1;
}

/** Used by clearAllDataAction. Tolerates a pre-migration DB. */
export async function clearAllUnpaidTime(supabase: DbClient): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("unpaid_time")
    .delete()
    .eq("user_id", userId);
  if (error && !isMissingTable(error)) throw error;
}
