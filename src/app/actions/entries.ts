"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { Entry, NewEntry, NewEntryOpCode, RoMatch } from "@/lib/types";

// Create or update an entry. Returns the persisted entry so the client can
// navigate / display success. Throws on validation or DB errors.
export async function loadMoreEntries(offset: number): Promise<Entry[]> {
  const supabase = await createClient();
  return db.listEntries(supabase, { limit: 100, offset });
}

// Find existing entries that already use this RO number. RO numbers are not
// unique (shops recycle them), so before saving a new RO the form checks here
// and, if there are matches, asks the user whether they meant to edit an
// existing one or log a genuinely new repair under the same number.
export async function findDuplicateRos(roNumber: string): Promise<RoMatch[]> {
  const ro = roNumber.trim();
  if (!ro) return [];
  const supabase = await createClient();
  const matches = await db.getEntriesByRoNumber(supabase, ro);
  return matches.map((e) => ({
    id: e.id,
    date: e.date,
    vehicleSummary: [e.vehicle.year, e.vehicle.make, e.vehicle.model]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" "),
  }));
}

export async function saveEntry(
  input: NewEntry,
  entryId?: string,
): Promise<Entry> {
  // --- server-side validation -------------------------------------------
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const roNumber = input.roNumber.trim();
  if (!roNumber) throw new Error("RO number is required.");
  if (!input.date) throw new Error("Date is required.");
  if (!DATE_RE.test(input.date)) throw new Error("Date must be in YYYY-MM-DD format.");
  if (input.opCodes.length === 0)
    throw new Error("Add at least one op code.");
  for (const line of input.opCodes) {
    if (!Number.isFinite(line.flagHours) || line.flagHours < 0)
      throw new Error("Flag hours must be a non-negative number.");
    if (
      line.actualHours !== null &&
      (!Number.isFinite(line.actualHours) || line.actualHours < 0)
    )
      throw new Error("Actual hours must be a non-negative number.");
  }

  const supabase = await createClient();

  // RO numbers are intentionally NOT unique — shops recycle them, so the same
  // number can be a different repair months later. Duplicate awareness lives in
  // the client (findDuplicateRos + the duplicate-RO prompt); the server just
  // persists what it's told.

  const normalized: NewEntry = {
    ...input,
    roNumber,
    notes: input.notes.trim(),
  };

  const entry = entryId
    ? await db.updateEntry(supabase, entryId, normalized)
    : await db.createEntry(supabase, normalized);

  // Revalidate everything that displays entries.
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/log");

  return entry;
}

export async function deleteEntryLineAction(lineId: string): Promise<void> {
  const supabase = await createClient();
  await db.deleteEntryLine(supabase, lineId);
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/pay-period");
}

export async function deleteEntryAction(id: string): Promise<void> {
  const supabase = await createClient();
  await db.deleteEntry(supabase, id);
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/pay-period");
}

export async function addOpCodeLineToEntryAction(
  entryId: string,
  line: Omit<NewEntryOpCode, "position">,
): Promise<void> {
  if (!entryId) throw new Error("Entry ID is required.");
  const supabase = await createClient();
  try {
    await db.addEntryLine(supabase, entryId, line);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Failed to add op code.");
  }
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/pay-period");
}

export async function setLineActualHoursAction(
  lineId: string,
  actualHours: number | null,
): Promise<void> {
  const supabase = await createClient();
  await db.setLineActualHours(supabase, lineId, actualHours);
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/pay-period");
}
