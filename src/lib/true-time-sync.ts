// The one True Time observation sync, shared by every server action that can
// move a line's flag or actual hours (entries.ts, open-tickets.ts, timer.ts).
//
// Lives here — not in a "use server" file — because a "use server" module may
// only export async server actions, and this must never be callable from the
// client. It used to be copied privately into each action file, and the copy
// that never got made (the timer's save) is how stopwatch hours stayed out of
// the pool: incident fingerprint `timer-save-skips-true-time-sync`.
import * as db from "@/lib/db";
import type { DbClient } from "@/lib/db";
import { observationsFromEntry } from "@/lib/true-time";
import { reportServerError } from "@/lib/report-error-server";

/**
 * Keep this RO's True Time observations in step with its current state.
 *
 * Call it AFTER the mutation, so it re-reads the post-save entry.
 *
 * Entirely best-effort and never allowed to throw: an observation is statistical
 * side data, and losing one costs the pool a single row, whereas failing the
 * tech's save costs them their work.
 *
 * Reads consent per call rather than caching it, so flipping the setting takes
 * effect on the very next save instead of at some later session boundary.
 */
export async function syncObservations(
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
