"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { refusable } from "@/lib/refusal";
import { syncObservations } from "@/lib/true-time-sync";
import { check, validate } from "@/lib/validation/core";
import {
  addLineSchema,
  entryIdSchema,
  entryRangeSchema,
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

// Create or update an entry. Returns the persisted entry so the client can
// navigate / display success. Throws on validation or DB errors.
export async function loadMoreEntries(offset: number): Promise<Entry[]> {
  const safeOffset = validate(offsetSchema, offset);
  const supabase = await createClient();
  return db.listEntries(supabase, { limit: 100, offset: safeOffset });
}

// Every RO dated from..to (inclusive) for the History custom range. History
// only holds the newest page up front, so a range in the past has to be asked
// for — filtering what happens to be loaded would quietly drop older ROs.
export async function loadEntriesInRange(
  from: string,
  to: string,
): Promise<{ entries: Entry[] } | { error: string }> {
  return refusable(async () => {
    const range = validate(entryRangeSchema, { from, to });
    const supabase = await createClient();
    return { entries: await db.listEntries(supabase, range) };
  });
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

// Resolve a SINGLE entry id to the slim summary the comeback "redo of" chip
// renders. findDuplicateRos above answers the same shape but searches BY RO
// NUMBER, which edit-load can't use — reopening a saved comeback has only the
// stored comeback_of_entry_id and no number to search with.
//
// Returns null rather than throwing when the row is gone. A deleted original is
// an ordinary state here (the link is a soft reference, not an FK the UI can
// rely on), and the caller's correct response is to render the plain "Linked to
// an earlier RO" fallback — not to surface an error over a missing label.
//
// Scoped like every other action in this file: `createClient()` is bound to the
// caller's auth cookie, so RLS on `entries` limits the read to the signed-in
// user's own rows. An id belonging to someone else simply comes back null.
//
// roNumber rides along on top of RoMatch because the chip's label leads with
// "RO #…" and RoMatch itself carries no number.
export async function getRoMatchById(
  entryId: string,
): Promise<(RoMatch & { roNumber: string }) | null> {
  const id = validate(entryIdSchema, entryId);
  const supabase = await createClient();
  const entry = await db.getEntry(supabase, id);
  if (!entry) return null;
  return {
    id: entry.id,
    date: entry.date,
    roNumber: entry.roNumber ?? "",
    vehicleSummary: [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" "),
  };
}

// RETURNS { error } for a refused RO (bad RO number, no op codes, ...) rather
// than throwing: a thrown Error crossing the Server Actions boundary has its
// message replaced by a generic string in a production build, so the tech would
// never read "RO numbers are digits only". Callers turn { error } into their
// own inline error. Unexpected failures (DB down) still throw.
export async function saveEntry(
  input: NewEntry,
  entryId?: string,
): Promise<Entry | { error: string }> {
  // refusable(): the entry-id parse and db.createEntry's "at least one op
  // code" guard throw Refusals; this turns them into `{ error }` too.
  return refusable(async () => {
    // --- server-side validation -------------------------------------------
    // `clean` is the PARSED value, not `input`: the schema declares the fields an
    // RO is made of, so anything else a caller attached is gone by this line
    // rather than riding along into the DB mapper.
    const parsed = check(newEntrySchema, input);
    if (!parsed.ok) return { error: parsed.error };
    const clean = parsed.data;
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
  });
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

// Returns `{ error }` for a refusal (a validation sentence) rather than
// throwing it — a thrown sentence is masked in production
// (server-action-thrown-refusals-masked). `{}` is success.
//
// A DB failure still THROWS. This used to catch it and rethrow its raw message
// as if it were a sentence for the tech, which (a) production masked anyway and
// (b) would only ever have shown a Postgres error. It is a failure, not a
// refusal, so it stays loud.
export async function addOpCodeLineToEntryAction(
  entryId: string,
  line: Omit<NewEntryOpCode, "position">,
): Promise<{ error?: string }> {
  return refusable(async () => {
    const clean = validate(addLineSchema, { entryId, line });
    const supabase = await createClient();
    await db.addEntryLine(supabase, clean.entryId, clean.line);
    await syncObservations(supabase, clean.entryId);
    revalidatePath("/");
    revalidatePath("/dashboard");
    revalidatePath("/history");
    revalidatePath("/pay-period");
    revalidatePath("/insights");
    return {};
  });
}

// Record (or clear) the hours a line actually took.
//
// RETURNS { error } RATHER THAN THROWING, and every hours-writing action here
// does the same. A thrown Error crossing the Server Actions boundary has its
// message replaced with a generic string plus a digest in a production build —
// only the server log keeps the sentence. So "Actual hours can't be more than
// 999.99." reached the tech as an opaque line and the cap looked like a bug in
// the app. `check()` is the non-throwing sibling of `validate()` for exactly
// this: the message travels as data, which nothing redacts. DB failures still
// throw, because those have no sentence worth showing anyway.
export async function setLineActualHoursAction(
  lineId: string,
  actualHours: number | null,
  // Defaults to "timer" rather than null so every EXISTING caller (the RO detail
  // modal's blur-to-save) keeps contributing to the shared True Time pool
  // exactly as it did before. Only retro capture passes "estimate", and only it
  // is held back from the pool. (The timer's own save does NOT come through
  // here — saveTimerAction adds via db.addLineActualHours, which stamps
  // "timer" itself when the line has no source yet.)
  actualSource: ActualSource | null = "timer",
  // `onlyIfEmpty`: write only if the line has no actual hours yet. The light
  // "how long did that take?" asks pass it so a stale ask can never overwrite
  // (and relabel as an estimate) hours a timer added in the meantime. When the
  // line was already filled it returns { skipped: true } and writes nothing.
  options?: { onlyIfEmpty?: boolean },
): Promise<{ error?: string; skipped?: boolean }> {
  const parsed = check(setLineActualHoursSchema, {
    lineId,
    actualHours,
    actualSource,
  });
  if (!parsed.ok) return { error: parsed.error };
  const clean = parsed.data;
  const supabase = await createClient();
  const written = await db.setLineActualHours(
    supabase,
    clean.lineId,
    clean.actualHours,
    clean.actualSource,
    { onlyIfEmpty: options?.onlyIfEmpty === true },
  );
  if (options?.onlyIfEmpty && !written?.wrote) return { skipped: true };
  // True Time hook for hand-entered actual hours (the RO modal's blur-to-save and
  // retro capture) — and where clearing the hours must retract an observation.
  // The timer does NOT save through here (saveTimerAction →
  // db.addLineActualHours); it calls the same shared syncObservations itself
  // after banking work hours (fixed 2026-09-28, incident fingerprint
  // `timer-save-skips-true-time-sync`).
  const owner = await db.getEntryIdForLine(supabase, clean.lineId);
  if (owner) await syncObservations(supabase, owner);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  return {};
}

// Mark (or unmark) one RO line as an upsell.
//
// No True Time sync: this changes nothing about flag or actual hours, so the
// observations it would recompute are byte-identical. Every other line mutation
// here calls syncObservations because it moves one of those two numbers.
//
// Returns `{ error }` for a refusal — chiefly db.setLineUpsell's "a comeback
// can't also be an upsell" — rather than throwing it (masked in production).
export async function setLineUpsellAction(
  lineId: string,
  isUpsell: boolean,
): Promise<{ error?: string }> {
  return refusable(async () => {
    const clean = validate(setLineUpsellSchema, { lineId, isUpsell });
    const supabase = await createClient();
    await db.setLineUpsell(supabase, clean.lineId, clean.isUpsell);
    revalidatePath("/");
    revalidatePath("/dashboard");
    revalidatePath("/history");
    revalidatePath("/pay-period");
    revalidatePath("/insights");
    return {};
  });
}

// Record (or clear) the flag hours the shop actually paid on a single RO line.
// null clears it back to "not yet reconciled". Mirrors setLineActualHoursAction,
// including the { error } return — see the note there for why it isn't a throw.
export async function setLinePaidHoursAction(
  lineId: string,
  paidHours: number | null,
): Promise<{ error?: string }> {
  const parsed = check(setLinePaidHoursSchema, { lineId, paidHours });
  if (!parsed.ok) return { error: parsed.error };
  const clean = parsed.data;
  const supabase = await createClient();
  await db.setLinePaidHours(supabase, clean.lineId, clean.paidHours);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  return {};
}
