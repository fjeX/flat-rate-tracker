// Data layer for True Time observations (Phase 3a — collection only).
//
// Writes anonymized flag-vs-actual measurements for opted-in users. There is
// deliberately NO read function for pooled data here: the aggregate read surface
// is Phase 3b, and shipping a reader before the dataset has a population would
// mean showing a "340 techs average…" figure that is really averaging one person.
//
// Every write is best-effort and non-fatal. Logging an RO is the load-bearing
// action a tech came to perform; a failure to record a side-channel observation
// must never surface as a failed save. Same reasoning as
// createUnpaidTimeSafe(), and the *Safe pattern is inherited from there.

import type { Database } from "@/lib/supabase/database.types";
import type { NewLaborTimeObservation } from "@/lib/true-time";
import { reportServerError } from "@/lib/report-error-server";
import { getSettings } from "./settings";
import {
  getCurrentUserId,
  isMissingColumn,
  isMissingTable,
  type DbClient,
} from "./_client";

type ObservationRow =
  Database["public"]["Tables"]["labor_time_observations"]["Insert"];

/**
 * Insert observations for one RO.
 *
 * A PLAIN insert, not an upsert: syncEntryLaborTimeObservations() deletes the
 * RO's existing rows first, so there is nothing to conflict with. The original
 * version used `ON CONFLICT (line_id)`, which failed against the partial unique
 * index the first migration created (Postgres can only infer a partial index
 * when the statement repeats its WHERE clause) — every write errored, silently.
 * The unique index on line_id still stands as a correctness backstop.
 */
export async function upsertLaborTimeObservations(
  supabase: DbClient,
  observations: NewLaborTimeObservation[],
): Promise<void> {
  if (observations.length === 0) return;
  const userId = await getCurrentUserId(supabase);
  const rows: ObservationRow[] = observations.map((o) => ({
    user_id: userId,
    entry_id: o.entryId,
    line_id: o.lineId,
    code_norm: o.codeNorm,
    make_norm: o.makeNorm,
    model_norm: o.modelNorm,
    vehicle_year: o.vehicleYear,
    flag_hours: o.flagHours,
    actual_hours: o.actualHours,
    observed_month: o.observedMonth,
    source: o.source,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("labor_time_observations").insert(rows);
  if (error) throw error;
}

/**
 * Best-effort variant used by the RO save path. Returns false when the write was
 * dropped so callers can carry on.
 *
 * Swallowing is deliberate — an observation is statistical side data, and losing
 * one costs the pool a row while failing the tech's RO save costs them their
 * work. But it is REPORTED, not silent: an early version swallowed silently and
 * a broken index meant every single write failed with nobody the wiser until
 * live verification found zero rows. A swallowed error still has to be visible
 * somewhere.
 */
export async function upsertLaborTimeObservationsSafe(
  supabase: DbClient,
  observations: NewLaborTimeObservation[],
): Promise<boolean> {
  try {
    await upsertLaborTimeObservations(supabase, observations);
    return true;
  } catch (err) {
    await reportServerError(err, { url: "true-time/upsert" });
    return false;
  }
}

/**
 * Drop every observation belonging to one RO.
 *
 * Needed on edit: if a tech clears a line's actual hours or deletes a line, the
 * old measurement must not linger claiming a job took a time the tech has since
 * retracted.
 */
export async function deleteLaborTimeObservationsForEntry(
  supabase: DbClient,
  entryId: string,
): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("labor_time_observations")
    .delete()
    .eq("user_id", userId)
    .eq("entry_id", entryId);
  if (error && !isMissingTable(error)) throw error;
}

/**
 * Bring stored observations for one RO in line with its current state.
 *
 * REPLACE-ALL rather than a diff, deliberately. The set per RO is tiny (at most
 * one row per line), and a diff would have to reason about which stored rows are
 * no longer poolable — cheap to get subtly wrong, e.g. a line whose actual hours
 * were cleared. Delete-then-insert is provably correct for one extra statement.
 *
 * Row removal on RO/line DELETE is handled by ON DELETE CASCADE in the schema,
 * so this only needs to handle edits.
 *
 * When sharing is off this degenerates to a pure delete, so turning the setting
 * off cleans up as the tech edits, not just at the moment of revocation.
 *
 * Best-effort throughout: logging an RO is the action the tech came to perform.
 */
export async function syncEntryLaborTimeObservations(
  supabase: DbClient,
  entryId: string,
  observations: NewLaborTimeObservation[],
  shareEnabled: boolean,
): Promise<boolean> {
  try {
    await deleteLaborTimeObservationsForEntry(supabase, entryId);
    if (!shareEnabled || observations.length === 0) return true;
    await upsertLaborTimeObservations(supabase, observations);
    // CONSENT RECHECK. Every PostgREST call is its own transaction, and a revoke is
    // U (set share=false) then D (delete all). If a writer's recheck reads true, its
    // snapshot predates U, so D runs after the writer's inserts and deletes them. If
    // it reads false, the writer purges its own rows. Either way no row survives a
    // revoke that raced the write.
    if (!(await getSettings(supabase)).shareLaborTimes) {
      await clearAllLaborTimeObservations(supabase);
    }
    return true;
  } catch (err) {
    // Reported, never silent — see upsertLaborTimeObservationsSafe.
    await reportServerError(err, { url: "true-time/sync" });
    return false;
  }
}

/**
 * Purge every observation for the current user.
 *
 * Called when consent is REVOKED. The aggregation function already filters on
 * share_labor_times, so a revoked user stops being counted the moment the flag
 * flips — but leaving their raw rows behind would mean revoking consent didn't
 * actually delete anything, which is not what "stop sharing" means to a person.
 */
export async function clearAllLaborTimeObservations(
  supabase: DbClient,
): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("labor_time_observations")
    .delete()
    .eq("user_id", userId);
  if (error && !isMissingTable(error)) throw error;
  // The observations are gone, so the "already backfilled" stamp is now a lie.
  // Every caller (consent revoked, account wiped, import replaced the account)
  // wants the next opted-in page load to rebuild the pool from the entries.
  await resetLaborTimeBackfill(supabase);
}

/**
 * Forget any backfill state: BOTH the done stamp and the in-flight lease go
 * back to null, so the next opted-in page load claims and rebuilds. Tolerates a
 * pre-migration DB, where the columns do not exist yet.
 */
export async function resetLaborTimeBackfill(supabase: DbClient): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("user_settings")
    .update({ true_time_backfilled_at: null, true_time_backfill_started_at: null })
    .eq("user_id", userId);
  if (error && !isMissingColumn(error)) throw error;
}

/** Mark the backfill done: stamp it and release the lease. */
export async function completeLaborTimeBackfill(supabase: DbClient): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("user_settings")
    .update({
      true_time_backfilled_at: new Date().toISOString(),
      true_time_backfill_started_at: null,
    })
    .eq("user_id", userId);
  if (error) throw error;
}

/** How long a claimed backfill is presumed alive before another may take over. */
export const BACKFILL_LEASE_MS = 15 * 60 * 1000;

/**
 * Claim the one-time backfill with a LEASE. Returns true when THIS caller owns it.
 *
 * A conditional UPDATE:
 *   SET true_time_backfill_started_at = now
 *   WHERE user_id = me AND true_time_backfilled_at IS NULL
 *     AND (true_time_backfill_started_at IS NULL OR ... < now - 15 min)
 * Two tabs racing get exactly one winner (Postgres re-checks the predicate after
 * the first writer commits). The done stamp is only written on SUCCESS, so a
 * container stopped mid-run (a deploy) can never leave the pool marked done and
 * empty: the lease just expires and the next page load retries. A FAILED run
 * keeps its lease on purpose, which is the backoff - at most one full account
 * scan per 15 minutes instead of one per navigation. Clock skew between app and
 * DB is irrelevant at this scale.
 * A DB without the columns (migration not applied yet) answers false.
 */
export async function claimLaborTimeBackfill(
  supabase: DbClient,
  now: Date = new Date(),
): Promise<boolean> {
  const userId = await getCurrentUserId(supabase);
  const cutoff = new Date(now.getTime() - BACKFILL_LEASE_MS).toISOString();
  const { data, error } = await supabase
    .from("user_settings")
    .update({ true_time_backfill_started_at: now.toISOString() })
    .eq("user_id", userId)
    .is("true_time_backfilled_at", null)
    .or(`true_time_backfill_started_at.is.null,true_time_backfill_started_at.lt.${cutoff}`)
    .select("user_id");
  if (error) {
    if (isMissingColumn(error)) return false;
    throw error;
  }
  return (data?.length ?? 0) > 0;
}

/** Rows per insert during a backfill. Well inside PostgREST's body limits. */
const BACKFILL_INSERT_CHUNK = 500;

/**
 * Replace ALL of the current user's observations with `observations`:
 * delete everything, then insert in chunks. Throws on any failure - the caller
 * (backfillLaborTimeObservations) owns reporting; a failed run keeps its lease as backoff.
 */
export async function replaceAllLaborTimeObservations(
  supabase: DbClient,
  observations: NewLaborTimeObservation[],
): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("labor_time_observations")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
  for (let i = 0; i < observations.length; i += BACKFILL_INSERT_CHUNK) {
    await upsertLaborTimeObservations(
      supabase,
      observations.slice(i, i + BACKFILL_INSERT_CHUNK),
    );
  }
}
