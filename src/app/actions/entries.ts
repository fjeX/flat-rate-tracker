"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { Entry, NewEntry } from "@/lib/types";

// Create or update an entry. Returns the persisted entry so the client can
// navigate / display success. Throws on validation or DB errors.
export async function saveEntry(
  input: NewEntry,
  entryId?: string,
): Promise<Entry> {
  // --- server-side validation -------------------------------------------
  const roNumber = input.roNumber.trim();
  if (!roNumber) throw new Error("RO number is required.");
  if (!input.date) throw new Error("Date is required.");
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

  // Unique-per-user RO# (case-insensitive). Excludes the entry being edited.
  const existing = await db.getEntryByRoNumber(supabase, roNumber);
  if (existing && existing.id !== entryId) {
    throw new Error(`RO #${roNumber} already exists.`);
  }

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

export async function deleteEntryAction(id: string): Promise<void> {
  const supabase = await createClient();
  await db.deleteEntry(supabase, id);
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
