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

/**
 * One-time backfill: build observations from every RO the user already has.
 *
 * The pool otherwise only holds ROs saved after opt-in, so an account that has
 * been timing jobs for months contributes nothing until it re-saves each one.
 *
 * CONCURRENCY + CRASH SAFETY: a 15-minute LEASE is claimed first with a
 * conditional UPDATE (claimLaborTimeBackfill), so two tabs/requests get exactly
 * one runner. The "done" stamp is written only AFTER success, so a container
 * stopped mid-run leaves nothing marked done - the lease expires and a later
 * page load retries. A failure keeps the lease (no release): that is the
 * backoff, one retry per 15 minutes rather than one per navigation.
 *
 * Never throws; failures go to reportServerError. Returns true when a backfill
 * ran to completion.
 */
export async function backfillLaborTimeObservations(
  supabase: DbClient,
): Promise<boolean> {
  try {
    const settings = await db.getSettings(supabase);
    if (!settings.shareLaborTimes) return false;
    if (!(await db.claimLaborTimeBackfill(supabase))) return false;

    // listEntries with no limit pages past PostgREST's 1000-row cap.
    const [entries, library] = await Promise.all([
      db.listEntries(supabase),
      db.listOpCodes(supabase),
    ]);
    const observations = entries.flatMap((e) => observationsFromEntry(e, library));
    await db.replaceAllLaborTimeObservations(supabase, observations);
    // CONSENT RECHECK. Every PostgREST call is its own transaction, and a revoke is
    // U (set share=false) then D (delete all). If a writer's recheck reads true, its
    // snapshot predates U, so D runs after the writer's inserts and deletes them. If
    // it reads false, the writer purges its own rows. Either way no row survives a
    // revoke that raced the write.
    if (!(await db.getSettings(supabase)).shareLaborTimes) {
      await db.clearAllLaborTimeObservations(supabase);
      return false;
    }
    await db.completeLaborTimeBackfill(supabase);
    return true;
  } catch (err) {
    await reportServerError(err, { url: "true-time/backfill" });
    return false;
  }
}
