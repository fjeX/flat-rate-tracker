"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { observationsFromEntry } from "@/lib/true-time";
import { reportServerError } from "@/lib/report-error-server";
import { validate } from "@/lib/validation/core";
import {
  addLineSchema,
  entryIdSchema,
  lineIdSchema,
  newEntrySchema,
  offsetSchema,
  roNumberQuerySchema,
  setLineActualHoursSchema,
  setLinePaidHoursSchema,
  setLineUpsellSchema,
} from "@/lib/validation/actions";
import type {
  ActualSource,
  Entry,
  NewEntry,
  NewEntryOpCode,
  RoMatch,
} from "@/lib/types";
import type { DbClient } from "@/lib/db";

/**
 * Keep this RO's True Time observations in step with its current state.
 *
 * Called after every mutation that can change a line's flag or actual hours.
 * Entirely best-effort and never allowed to throw: an observation is statistical
 * side data, and losing one costs the pool a single row, whereas failing the
 * tech's save costs them their work.
 *
 * Reads consent per call rather than caching it, so flipping the setting takes
 * effect on the very next save instead of at some later session boundary.
 */
async function syncObservations(
  supabase: DbClient,
  entryId: string,
): Promise<void> {
  try {
    const [settings, entry, library] = await Promise.all([
      db.getSettings(supabase),
      db.getEntry(supabase, entryId),
      db.listOpCodes(supabase),
    ]);
    if (!entry) return;
    await db.syncEntryLaborTimeObservations(
      supabase,
      entryId,
      observationsFromEntry(entry, library),
      settings.shareLaborTimes,
    );
  } catch (err) {
    // Swallowed so the tech's save still succeeds — but REPORTED, because a
    // silently swallowed error here once hid a write path that was failing 100%
    // of the time.
    await reportServerError(err, { url: "true-time/syncObservations" });
  }
}

// Create or update an entry. Returns the persisted entry so the client can
// navigate / display success. Throws on validation or DB errors.
export async function loadMoreEntries(offset: number): Promise<Entry[]> {
  const safeOffset = validate(offsetSchema, offset);
  const supabase = await createClient();
  return db.listEntries(supabase, { limit: 100, offset: safeOffset });
}

// Find existing entries that already use this RO number. RO numbers are not
// unique (shops recycle them), so before saving a new RO the form checks here
// and, if there are matches, asks the user whether they meant to edit an
// existing one or log a genuinely new repair under the same number.
export async function findDuplicateRos(roNumber: string): Promise<RoMatch[]> {
  const ro = validate(roNumberQuerySchema, roNumber).trim();
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
  // `clean` is the PARSED value, not `input`: the schema declares the fields an
  // RO is made of, so anything else a caller attached is gone by this line
  // rather than riding along into the DB mapper.
  const clean = validate(newEntrySchema, input);
  const id = entryId === undefined ? undefined : validate(entryIdSchema, entryId);

  const supabase = await createClient();

  // Normalize the comeback invariants server-side rather than trusting the
  // client. The DB CHECK would reject a comeback line carrying flag hours, but
  // that surfaces as a raw constraint violation; deciding it here means one
  // consistent answer no matter which form (or future caller) sent it.
  const hasComebackLines = clean.opCodes.some((l) => l.isComeback);
  const opCodes = clean.opCodes.map((l) =>
    l.isComeback ? { ...l, flagHours: 0 } : l,
  );

  // RO numbers are intentionally NOT unique — shops recycle them, so the same
  // number can be a different repair months later. Duplicate awareness lives in
  // the client (findDuplicateRos + the duplicate-RO prompt); the server just
  // persists what it's told.

  const normalized: NewEntry = {
    ...clean,
    notes: clean.notes.trim(),
    opCodes,
    // Entry-level comeback metadata without a single marked line describes
    // nothing. Clearing it here also means EDITING a comeback back into a
    // normal RO actually clears the columns instead of leaving them stale.
    comebackKind: hasComebackLines ? clean.comebackKind : null,
    comebackOfEntryId:
      hasComebackLines && clean.comebackKind === "comeback_own"
        ? clean.comebackOfEntryId
        : null,
  };

  const entry = id
    ? await db.updateEntry(supabase, id, normalized)
    : await db.createEntry(supabase, normalized);

  await syncObservations(supabase, entry.id);

  // Revalidate everything that displays entries. NB: "/" is the marketing
  // landing page — the app dashboard lives at "/dashboard" and must be listed
  // explicitly or its Recent-ROs / stats stay stale after a mutation.
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/log");

  return entry;
}

export async function deleteEntryLineAction(lineId: string): Promise<void> {
  const id = validate(lineIdSchema, lineId);
  const supabase = await createClient();
  await db.deleteEntryLine(supabase, id);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
}

export async function deleteEntryAction(id: string): Promise<void> {
  const entryId = validate(entryIdSchema, id);
  const supabase = await createClient();
  // Storage objects do NOT cascade when the entry (and its entry_photos rows)
  // are deleted — purge them explicitly first so the bucket keeps no orphans.
  const photoPaths = await db.listEntryPhotoPaths(supabase, entryId);
  if (photoPaths.length > 0) {
    await supabase.storage.from("ro-photos").remove(photoPaths);
  }
  await db.deleteEntry(supabase, entryId);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
}

export async function addOpCodeLineToEntryAction(
  entryId: string,
  line: Omit<NewEntryOpCode, "position">,
): Promise<void> {
  const clean = validate(addLineSchema, { entryId, line });
  const supabase = await createClient();
  try {
    await db.addEntryLine(supabase, clean.entryId, clean.line);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Failed to add op code.");
  }
  await syncObservations(supabase, clean.entryId);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
}

export async function setLineActualHoursAction(
  lineId: string,
  actualHours: number | null,
  // Defaults to "timer" rather than null so every EXISTING caller (the RO detail
  // modal's blur-to-save, the timer's own write) keeps contributing to the
  // shared True Time pool exactly as it did before. Only retro capture passes
  // "estimate", and only it is held back from the pool.
  actualSource: ActualSource | null = "timer",
): Promise<void> {
  const clean = validate(setLineActualHoursSchema, {
    lineId,
    actualHours,
    actualSource,
  });
  const supabase = await createClient();
  await db.setLineActualHours(
    supabase,
    clean.lineId,
    clean.actualHours,
    clean.actualSource,
  );
  // The single most important True Time hook: this is where a timed job's actual
  // hours actually arrive (the timer saves through here), so it is where most
  // observations are born — and where clearing the hours must retract one.
  const owner = await db.getEntryIdForLine(supabase, clean.lineId);
  if (owner) await syncObservations(supabase, owner);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
}

// Mark (or unmark) one RO line as an upsell.
//
// No True Time sync: this changes nothing about flag or actual hours, so the
// observations it would recompute are byte-identical. Every other line mutation
// here calls syncObservations because it moves one of those two numbers.
export async function setLineUpsellAction(
  lineId: string,
  isUpsell: boolean,
): Promise<void> {
  const clean = validate(setLineUpsellSchema, { lineId, isUpsell });
  const supabase = await createClient();
  await db.setLineUpsell(supabase, clean.lineId, clean.isUpsell);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
}

// Record (or clear) the flag hours the shop actually paid on a single RO line.
// null clears it back to "not yet reconciled". Mirrors setLineActualHoursAction.
export async function setLinePaidHoursAction(
  lineId: string,
  paidHours: number | null,
): Promise<void> {
  const clean = validate(setLinePaidHoursSchema, { lineId, paidHours });
  const supabase = await createClient();
  await db.setLinePaidHours(supabase, clean.lineId, clean.paidHours);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
}
