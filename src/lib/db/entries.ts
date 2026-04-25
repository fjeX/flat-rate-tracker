// Data layer for repair orders (entries) and their op code lines.
import type { Database } from "@/lib/supabase/database.types";
import type {
  Entry,
  EntryOpCode,
  EntryPatch,
  NewEntry,
  NewEntryOpCode,
} from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";

type EntryRow = Database["public"]["Tables"]["entries"]["Row"];
type EntryOpCodeRow = Database["public"]["Tables"]["entry_op_codes"]["Row"];

function toEntryOpCode(row: EntryOpCodeRow): EntryOpCode {
  return {
    id: row.id,
    opCodeId: row.op_code_id,
    custom: row.custom,
    customCode: row.custom_code,
    customDescription: row.custom_description,
    flagHours: Number(row.flag_hours),
    actualHours: row.actual_hours === null ? null : Number(row.actual_hours),
    position: row.position,
  };
}

function toEntry(row: EntryRow & { entry_op_codes?: EntryOpCodeRow[] }): Entry {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    date: row.date,
    roNumber: row.ro_number,
    vehicle: {
      year: row.vehicle_year,
      make: row.vehicle_make,
      model: row.vehicle_model,
      vin: row.vehicle_vin,
    },
    flagHours: Number(row.flag_hours),
    notes: row.notes,
    opCodes: (row.entry_op_codes ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(toEntryOpCode),
  };
}

// ------------------------------------------------------------------------
// Reads
// ------------------------------------------------------------------------

export type ListEntriesFilter = {
  from?: string; // inclusive "YYYY-MM-DD"
  to?: string; // inclusive "YYYY-MM-DD"
  limit?: number;
};

export async function listEntries(
  supabase: DbClient,
  filter: ListEntriesFilter = {},
): Promise<Entry[]> {
  let q = supabase
    .from("entries")
    .select("*, entry_op_codes(*)")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (filter.from) q = q.gte("date", filter.from);
  if (filter.to) q = q.lte("date", filter.to);
  if (filter.limit) q = q.limit(filter.limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toEntry);
}

export async function getEntry(
  supabase: DbClient,
  id: string,
): Promise<Entry | null> {
  const { data, error } = await supabase
    .from("entries")
    .select("*, entry_op_codes(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toEntry(data) : null;
}

export async function getEntryByRoNumber(
  supabase: DbClient,
  roNumber: string,
): Promise<Entry | null> {
  // Case-insensitive match — DB has a unique index on lower(ro_number).
  const { data, error } = await supabase
    .from("entries")
    .select("*, entry_op_codes(*)")
    .ilike("ro_number", roNumber)
    .maybeSingle();
  if (error) throw error;
  return data ? toEntry(data) : null;
}

// ------------------------------------------------------------------------
// Writes
// ------------------------------------------------------------------------

function toLineInsert(
  entryId: string,
  line: NewEntryOpCode,
  position: number,
): Database["public"]["Tables"]["entry_op_codes"]["Insert"] {
  return {
    entry_id: entryId,
    op_code_id: line.opCodeId ?? null,
    custom: line.custom,
    custom_code: line.customCode ?? null,
    custom_description: line.customDescription ?? null,
    flag_hours: line.flagHours,
    actual_hours: line.actualHours,
    position,
  };
}

export async function createEntry(
  supabase: DbClient,
  input: NewEntry,
): Promise<Entry> {
  if (input.opCodes.length === 0) {
    throw new Error("At least one op code is required.");
  }

  const userId = await getCurrentUserId(supabase);

  const { data: entry, error: entryErr } = await supabase
    .from("entries")
    .insert({
      user_id: userId,
      date: input.date,
      ro_number: input.roNumber,
      vehicle_year: input.vehicle.year,
      vehicle_make: input.vehicle.make,
      vehicle_model: input.vehicle.model,
      vehicle_vin: input.vehicle.vin,
      notes: input.notes,
    })
    .select()
    .single();
  if (entryErr) throw entryErr;

  const lineInserts = input.opCodes.map((oc, i) => toLineInsert(entry.id, oc, i));
  const { error: linesErr } = await supabase
    .from("entry_op_codes")
    .insert(lineInserts);
  if (linesErr) {
    // Best-effort cleanup so we don't leave an orphan entry with no lines.
    await supabase.from("entries").delete().eq("id", entry.id);
    throw linesErr;
  }

  // Re-fetch so we get the DB-updated flag_hours (the recompute trigger runs
  // after the line inserts) and the generated line ids.
  const fresh = await getEntry(supabase, entry.id);
  if (!fresh) throw new Error("Entry disappeared after creation");
  return fresh;
}

export async function updateEntry(
  supabase: DbClient,
  id: string,
  patch: EntryPatch,
): Promise<Entry> {
  const update: Database["public"]["Tables"]["entries"]["Update"] = {};
  if (patch.date !== undefined) update.date = patch.date;
  if (patch.roNumber !== undefined) update.ro_number = patch.roNumber;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.vehicle !== undefined) {
    update.vehicle_year = patch.vehicle.year;
    update.vehicle_make = patch.vehicle.make;
    update.vehicle_model = patch.vehicle.model;
    update.vehicle_vin = patch.vehicle.vin;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("entries").update(update).eq("id", id);
    if (error) throw error;
  }

  if (patch.opCodes !== undefined) {
    // Simplest correct approach: delete existing lines and re-insert.
    // RLS + FK-cascade makes this safe; trigger will recompute flag_hours.
    const { error: delErr } = await supabase
      .from("entry_op_codes")
      .delete()
      .eq("entry_id", id);
    if (delErr) throw delErr;

    if (patch.opCodes.length > 0) {
      const lineInserts = patch.opCodes.map((oc, i) => toLineInsert(id, oc, i));
      const { error: insErr } = await supabase
        .from("entry_op_codes")
        .insert(lineInserts);
      if (insErr) throw insErr;
    }
  }

  const fresh = await getEntry(supabase, id);
  if (!fresh) throw new Error("Entry not found after update");
  return fresh;
}

export async function deleteEntry(supabase: DbClient, id: string): Promise<void> {
  const { error } = await supabase.from("entries").delete().eq("id", id);
  if (error) throw error;
}

// Update just a single op code line's actualHours — used by the RO detail
// modal's "blur to save" behavior and by the timer's "save to job" flow.
export async function setLineActualHours(
  supabase: DbClient,
  lineId: string,
  actualHours: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("entry_op_codes")
    .update({ actual_hours: actualHours })
    .eq("id", lineId);
  if (error) throw error;
}
