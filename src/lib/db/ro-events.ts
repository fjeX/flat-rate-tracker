// Data layer for the RO timeline (Open Tickets, Phase 1).
//
// One row per thing that happened to a multi-day ticket: opened, diagnosis
// done, waiting on approval, parts ordered, closed. The STORY only — hours live
// in the unpaid_time ledger as `open_work` rows (decision 4), so a note edit
// here can never move a day total, and a ledger row can never lose its context.
//
// `opened`, `closed` and `reopened` are written by the server actions that
// perform those transitions, never by a form — the caller cannot forget them
// and cannot fake them.

import type { Database } from "@/lib/supabase/database.types";
import {
  isRoEventKind,
  RO_EVENT_PICKABLE_KINDS,
  type NewRoEvent,
  type RoEvent,
} from "@/lib/types";
import {
  getCurrentUserId,
  isMissingTable,
  retryOnce,
  type DbClient,
} from "./_client";

type RoEventRow = Database["public"]["Tables"]["ro_events"]["Row"];

function toRoEvent(row: RoEventRow): RoEvent {
  return {
    id: row.id,
    userId: row.user_id,
    entryId: row.entry_id,
    date: row.date,
    time: row.time ?? null,
    // A kind the DB allows but this build doesn't know means the code is older
    // than the schema. Show it as a custom event carrying its raw kind in the
    // note position rather than dropping the row — the timeline is the record.
    kind: isRoEventKind(row.kind) ? row.kind : "custom",
    note: isRoEventKind(row.kind) ? row.note : row.note || row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Chronological order, the one sort every surface uses. (date, time, created)
 * — a null time sorts AFTER every timed event on the same day, matching the
 * index and the honest position for "sometime that day".
 */
export function sortRoEvents(events: RoEvent[]): RoEvent[] {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time !== b.time) {
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time < b.time ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/** One ticket's timeline, chronological. */
export async function listRoEvents(
  supabase: DbClient,
  entryId: string,
): Promise<RoEvent[]> {
  const data = await retryOnce(async () => {
    const { data, error } = await supabase
      .from("ro_events")
      .select("*")
      .eq("entry_id", entryId);
    if (error) throw error;
    return data;
  });
  return sortRoEvents((data ?? []).map(toRoEvent));
}

/**
 * Timelines for several tickets in one read — the dashboard card needs the
 * latest event of every open ticket and must not issue one query per row.
 * Returned grouped, each group chronological.
 */
export async function listRoEventsForEntries(
  supabase: DbClient,
  entryIds: string[],
): Promise<Map<string, RoEvent[]>> {
  const out = new Map<string, RoEvent[]>();
  if (entryIds.length === 0) return out;
  const data = await retryOnce(async () => {
    const { data, error } = await supabase
      .from("ro_events")
      .select("*")
      .in("entry_id", entryIds);
    if (error) throw error;
    return data;
  });
  for (const row of sortRoEvents((data ?? []).map(toRoEvent))) {
    const list = out.get(row.entryId);
    if (list) list.push(row);
    else out.set(row.entryId, [row]);
  }
  return out;
}

/** Null pre-migration — callers hide the section rather than crash. */
export async function listRoEventsSafe(
  supabase: DbClient,
  entryId: string,
): Promise<RoEvent[] | null> {
  try {
    return await listRoEvents(supabase, entryId);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** Every timeline row the account owns — the backup export's read. */
export async function listAllRoEvents(supabase: DbClient): Promise<RoEvent[]> {
  const data = await retryOnce(async () => {
    const { data, error } = await supabase.from("ro_events").select("*");
    if (error) throw error;
    return data;
  });
  return sortRoEvents((data ?? []).map(toRoEvent));
}

/** Null pre-migration, so a backup taken against an older DB omits the key —
 *  which import reads as "this backup does not describe timelines". */
export async function listAllRoEventsSafe(
  supabase: DbClient,
): Promise<RoEvent[] | null> {
  try {
    return await listAllRoEvents(supabase);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** Validation lives in the server action, same as unpaid-time. */
export async function createRoEvent(
  supabase: DbClient,
  input: NewRoEvent,
): Promise<RoEvent> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("ro_events")
    .insert({
      user_id: userId,
      entry_id: input.entryId,
      date: input.date,
      time: input.time ?? null,
      kind: input.kind,
      note: input.note ?? "",
    })
    .select()
    .single();
  if (error) throw error;
  return toRoEvent(data);
}

/**
 * Delete exactly ONE event, by primary key, scoped to the signed-in user in
 * this function's own SQL on top of RLS (same shape as deleteUnpaidTime, for
 * the same reason: ownership enforced here is testable without a database).
 *
 * Only the hand-picked kinds are deletable. `opened`, `closed` and `reopened`
 * are the record of what the ticket DID — the card counts days-open from
 * `opened` — so the filter refuses them in SQL rather than trusting the UI
 * not to offer the button.
 *
 * Returns false when nothing matched — already gone, not this user's, or a
 * transition event.
 */
export async function deleteRoEvent(
  supabase: DbClient,
  id: string,
): Promise<boolean> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("ro_events")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .in("kind", [...RO_EVENT_PICKABLE_KINDS])
    .select("id");
  if (error) throw error;
  return (data ?? []).length === 1;
}
