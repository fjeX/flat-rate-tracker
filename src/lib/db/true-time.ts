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
import { getCurrentUserId, isMissingTable, type DbClient } from "./_client";

type ObservationRow =
  Database["public"]["Tables"]["labor_time_observations"]["Insert"];

/**
 * Upsert observations for one RO, keyed on line_id.
 *
 * Upsert rather than insert because a tech correcting their actual hours must
 * REPLACE the measurement, not add a second one for the same job — otherwise a
 * single edited line would count twice in the pool and skew its own bucket.
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
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("labor_time_observations")
    .upsert(rows, { onConflict: "line_id" });
  if (error) throw error;
}

/**
 * Best-effort variant used by the RO save path. Returns false when the write was
 * dropped (pre-migration DB, or any other failure) so callers can carry on.
 *
 * Swallowing broadly is deliberate here and NOT the usual pattern: an
 * observation is statistical side data. Losing one costs the pool a single row;
 * failing the tech's RO save costs them their work.
 */
export async function upsertLaborTimeObservationsSafe(
  supabase: DbClient,
  observations: NewLaborTimeObservation[],
): Promise<boolean> {
  try {
    await upsertLaborTimeObservations(supabase, observations);
    return true;
  } catch {
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
    return true;
  } catch {
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
}
