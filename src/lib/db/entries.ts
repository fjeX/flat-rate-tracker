// Data layer for repair orders (entries) and their op code lines.
import type { Database } from "@/lib/supabase/database.types";
import type {
  Entry,
  EntryOpCode,
  EntryPatch,
  LaborType,
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
    notes: row.notes,
    position: row.position,
    subOpCodeId: row.sub_op_code_id ?? null,
    laborType: (row.labor_type as LaborType | null) ?? null,
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
      mileage: row.vehicle_mileage,
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
  offset?: number; // 0-indexed; used with limit for pagination
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
  if (filter.limit !== undefined) {
    const start = filter.offset ?? 0;
    q = q.range(start, start + filter.limit - 1);
  }

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

export async function getEntriesByRoNumber(
  supabase: DbClient,
  roNumber: string,
): Promise<Entry[]> {
  // Case-insensitive match. RO numbers are NOT unique — shops recycle them over
  // time — so this returns every entry sharing the number, newest-first.
  const { data, error } = await supabase
    .from("entries")
    .select("*, entry_op_codes(*)")
    .ilike("ro_number", roNumber)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toEntry);
}

// ------------------------------------------------------------------------
// Writes
// ------------------------------------------------------------------------

function toLineInsert(
  entryId: string,
  line: NewEntryOpCode,
  position: number,
): Database["public"]["Tables"]["entry_op_codes"]["Insert"] {
  const insert: Database["public"]["Tables"]["entry_op_codes"]["Insert"] = {
    entry_id: entryId,
    op_code_id: line.opCodeId ?? null,
    custom: line.custom,
    custom_code: line.customCode ?? null,
    custom_description: line.customDescription ?? null,
    flag_hours: line.flagHours,
    actual_hours: line.actualHours,
    position,
  };
  if (line.notes) insert.notes = line.notes;
  // Only include sub_op_code_id when set — safe on DBs that haven't run migration yet.
  if (line.subOpCodeId) insert.sub_op_code_id = line.subOpCodeId;
  // Same guard for labor_type: omit when null so inserts still work pre-migration.
  if (line.laborType) insert.labor_type = line.laborType;
  return insert;
}

// The set of line columns the FORM owns. A diff-based UPDATE only touches these,
// so any column the form doesn't carry (today: none beyond this; tomorrow:
// paid_hours, labor_type, …) survives an edit instead of being wiped. This is
// the whole reason updateEntry diffs instead of delete-and-reinsert.
function toLineUpdate(
  line: NewEntryOpCode,
  position: number,
): Database["public"]["Tables"]["entry_op_codes"]["Update"] {
  return {
    op_code_id: line.opCodeId ?? null,
    custom: line.custom,
    custom_code: line.customCode ?? null,
    custom_description: line.customDescription ?? null,
    flag_hours: line.flagHours,
    actual_hours: line.actualHours,
    notes: line.notes ?? "",
    position,
    sub_op_code_id: line.subOpCodeId ?? null,
    labor_type: line.laborType ?? null,
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
      vehicle_mileage: input.vehicle.mileage,
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
    update.vehicle_mileage = patch.vehicle.mileage;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("entries").update(update).eq("id", id);
    if (error) throw error;
  }

  if (patch.opCodes !== undefined) {
    await diffEntryLines(supabase, id, patch.opCodes);
  }

  const fresh = await getEntry(supabase, id);
  if (!fresh) throw new Error("Entry not found after update");
  return fresh;
}

// Reconcile the entry's op-code lines against the incoming form state WITHOUT
// blowing them away. Lines carry their DB id through the form; we UPDATE ones
// that still exist (touching only form-owned columns), INSERT new ones, and
// DELETE the ones the form dropped.
//
// Why not delete-and-reinsert? That silently wipes any column the form doesn't
// round-trip. The moment a per-line column exists that the log form doesn't
// carry (paid_hours, labor_type, a timer-written actual_hours, …), a plain edit
// of the RO's notes would erase it. A diff fixes the whole class of bug.
async function diffEntryLines(
  supabase: DbClient,
  entryId: string,
  lines: NewEntryOpCode[],
): Promise<void> {
  const { data: existing, error: exErr } = await supabase
    .from("entry_op_codes")
    .select("id")
    .eq("entry_id", entryId);
  if (exErr) throw exErr;
  const existingIds = new Set((existing ?? []).map((r) => r.id));
  const keptIds = new Set<string>();

  // Position is the array index so reordering in the form persists.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.id && existingIds.has(line.id)) {
      keptIds.add(line.id);
      const { error: upErr } = await supabase
        .from("entry_op_codes")
        .update(toLineUpdate(line, i))
        .eq("id", line.id);
      if (upErr) throw upErr;
    } else {
      const { error: insErr } = await supabase
        .from("entry_op_codes")
        .insert(toLineInsert(entryId, line, i));
      if (insErr) throw insErr;
    }
  }

  const toDelete = [...existingIds].filter((lineId) => !keptIds.has(lineId));
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("entry_op_codes")
      .delete()
      .in("id", toDelete);
    if (delErr) throw delErr;
  }
}

export async function deleteEntry(supabase: DbClient, id: string): Promise<void> {
  const { error } = await supabase.from("entries").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteEntryLine(
  supabase: DbClient,
  lineId: string,
): Promise<void> {
  const { error } = await supabase
    .from("entry_op_codes")
    .delete()
    .eq("id", lineId);
  if (error) throw error;
}

// Append a single new op code line to an existing entry.
// Position is set to max(existing positions) + 1.
export async function addEntryLine(
  supabase: DbClient,
  entryId: string,
  line: Omit<NewEntryOpCode, "position">,
): Promise<void> {
  const { data: last } = await supabase
    .from("entry_op_codes")
    .select("position")
    .eq("entry_id", entryId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = last ? last.position + 1 : 0;
  const { error } = await supabase
    .from("entry_op_codes")
    .insert(toLineInsert(entryId, { ...line, position }, position));
  if (error) throw new Error(error.message);
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
