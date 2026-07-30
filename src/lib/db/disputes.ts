// Data layer for the Dispute Outcome Ledger.
//
// A dispute is a FROZEN historical claim (see the migration header and the type
// docs in lib/types.ts): the hours, dollars, and labels are copied in at
// generation time and never recomputed from the live ROs. So this module writes
// snapshots, not references — and every read returns exactly what was claimed,
// even after the underlying RO has been edited or deleted.
//
// Shape mirrors unpaid-time.ts, including the `*Safe` variants: migrations are
// applied by hand on the VM, so a build can legitimately run against a DB that
// does not have these tables yet. Every read surface must degrade to "feature
// hidden" rather than crash the pay-period page.

import type { Database } from "@/lib/supabase/database.types";
import {
  isDisputeStatus,
  type Dispute,
  type DisputeLine,
  type DisputePatch,
  type DisputeScope,
  type NewDispute,
} from "@/lib/types";
import { getCurrentUserId, isMissingTable, type DbClient } from "./_client";

type DisputeRow = Database["public"]["Tables"]["disputes"]["Row"];
type DisputeLineRow = Database["public"]["Tables"]["dispute_lines"]["Row"];

// numeric columns come back as strings from PostgREST in some driver versions;
// Number() normalizes both. A null dollars column must stay null — "unknown"
// and "zero" are different answers (see the Dispute type docs).
function num(v: number | string | null): number {
  return v === null ? 0 : Number(v);
}
function numOrNull(v: number | string | null): number | null {
  return v === null ? null : Number(v);
}

function toScope(raw: string): DisputeScope {
  // An unknown scope means the DB is newer than this build. 'period' is the
  // safe read: it renders the claim's totals without promising per-line detail
  // this build may not know how to display.
  return raw === "lines" ? "lines" : "period";
}

function toDisputeLine(row: DisputeLineRow): DisputeLine {
  return {
    id: row.id,
    disputeId: row.dispute_id,
    entryId: row.entry_id,
    lineId: row.line_id,
    roNumber: row.ro_number,
    code: row.code,
    description: row.description,
    workDate: row.work_date,
    flaggedHours: num(row.flagged_hours),
    paidHours: numOrNull(row.paid_hours),
    claimedHours: num(row.claimed_hours),
    claimedDollars: numOrNull(row.claimed_dollars),
    recoveredHours: num(row.recovered_hours),
    recoveredDollars: numOrNull(row.recovered_dollars),
    hadPhoto: row.had_photo,
    position: row.position,
  };
}

function toDispute(row: DisputeRow, lines: DisputeLineRow[] = []): Dispute {
  return {
    id: row.id,
    userId: row.user_id,
    periodKey: row.period_key,
    periodLabel: row.period_label,
    scope: toScope(row.scope),
    // A status the DB allows but this build doesn't know about is treated as
    // 'generated' — the least-committal state. Mislabelling it 'resolved' would
    // fold an unknown row into the lifetime-recovered figure.
    status: isDisputeStatus(row.status) ? row.status : "generated",
    claimedHours: num(row.claimed_hours),
    claimedDollars: numOrNull(row.claimed_dollars),
    recoveredHours: num(row.recovered_hours),
    recoveredDollars: numOrNull(row.recovered_dollars),
    generatedAt: row.generated_at,
    submittedAt: row.submitted_at,
    answeredAt: row.answered_at,
    resolvedAt: row.resolved_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines: lines
      .filter((l) => l.dispute_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map(toDisputeLine),
  };
}

/**
 * Every dispute for the user, newest first, with their lines attached.
 *
 * Two queries rather than a PostgREST embed: the embed syntax couples this read
 * to the FK name, and the ledger is small enough per user (a handful of rows per
 * year) that a second round trip costs nothing.
 */
export async function listDisputes(supabase: DbClient): Promise<Dispute[]> {
  const { data: rows, error } = await supabase
    .from("disputes")
    .select("*")
    .order("generated_at", { ascending: false });
  if (error) throw error;
  const disputes = rows ?? [];
  if (disputes.length === 0) return [];

  const { data: lineRows, error: lineError } = await supabase
    .from("dispute_lines")
    .select("*")
    .in(
      "dispute_id",
      disputes.map((d) => d.id),
    );
  if (lineError) throw lineError;

  return disputes.map((d) => toDispute(d, lineRows ?? []));
}

/** Null pre-migration — callers hide the feature rather than crash. */
export async function listDisputesSafe(
  supabase: DbClient,
): Promise<Dispute[] | null> {
  try {
    return await listDisputes(supabase);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * The live (non-terminal) dispute for one period, or null. Backed by the partial
 * unique index in the migration, so there can only ever be one.
 */
export async function getOpenDispute(
  supabase: DbClient,
  periodKey: string,
): Promise<Dispute | null> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("disputes")
    .select("*")
    .eq("user_id", userId)
    .eq("period_key", periodKey)
    .not("status", "in", "(resolved,withdrawn)")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: lineRows, error: lineError } = await supabase
    .from("dispute_lines")
    .select("*")
    .eq("dispute_id", data.id);
  if (lineError) throw lineError;
  return toDispute(data, lineRows ?? []);
}

export async function getOpenDisputeSafe(
  supabase: DbClient,
  periodKey: string,
): Promise<Dispute | null> {
  try {
    return await getOpenDispute(supabase, periodKey);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * Open a dispute, with its frozen line snapshots. Validation lives in the server
 * action, same as bonuses and unpaid-time.
 *
 * If the line insert fails the parent is deleted, so a dispute can never exist
 * claiming N itemized hours with zero itemized rows behind it. There is no
 * transaction available through PostgREST, so this compensating delete is the
 * available equivalent.
 */
export async function createDispute(
  supabase: DbClient,
  input: NewDispute,
): Promise<Dispute> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("disputes")
    .insert({
      user_id: userId,
      period_key: input.periodKey,
      period_label: input.periodLabel ?? "",
      scope: input.scope,
      claimed_hours: input.claimedHours,
      claimed_dollars: input.claimedDollars ?? null,
      note: input.note ?? "",
    })
    .select()
    .single();
  if (error) throw error;

  const lines = input.lines ?? [];
  if (lines.length === 0) return toDispute(data);

  const { data: lineRows, error: lineError } = await supabase
    .from("dispute_lines")
    .insert(
      lines.map((l, i) => ({
        dispute_id: data.id,
        user_id: userId,
        entry_id: l.entryId ?? null,
        line_id: l.lineId ?? null,
        ro_number: l.roNumber,
        code: l.code,
        description: l.description ?? "",
        work_date: l.workDate ?? null,
        flagged_hours: l.flaggedHours,
        paid_hours: l.paidHours ?? null,
        claimed_hours: l.claimedHours,
        claimed_dollars: l.claimedDollars ?? null,
        had_photo: l.hadPhoto ?? false,
        position: i,
      })),
    )
    .select();
  if (lineError) {
    await supabase.from("disputes").delete().eq("id", data.id);
    throw lineError;
  }
  return toDispute(data, lineRows ?? []);
}

/**
 * Patch a dispute. Lifecycle timestamps are stamped HERE rather than passed in
 * so a transition can never be recorded without its time, and an already-set
 * timestamp is never overwritten by a repeat transition (re-saving a resolved
 * dispute's note must not move its resolved_at).
 */
export async function updateDispute(
  supabase: DbClient,
  id: string,
  patch: DisputePatch,
): Promise<void> {
  const now = new Date().toISOString();
  const update: Database["public"]["Tables"]["disputes"]["Update"] = {
    updated_at: now,
  };
  if (patch.recoveredHours !== undefined)
    update.recovered_hours = patch.recoveredHours;
  if (patch.recoveredDollars !== undefined)
    update.recovered_dollars = patch.recoveredDollars;
  if (patch.note !== undefined) update.note = patch.note;

  if (patch.status !== undefined) {
    update.status = patch.status;
    const { data: existing, error: readError } = await supabase
      .from("disputes")
      .select("submitted_at, answered_at, resolved_at")
      .eq("id", id)
      .single();
    if (readError) throw readError;
    if (patch.status === "submitted" && !existing.submitted_at)
      update.submitted_at = now;
    if (patch.status === "answered" && !existing.answered_at)
      update.answered_at = now;
    if (patch.status === "resolved" && !existing.resolved_at)
      update.resolved_at = now;
  }

  const { error } = await supabase.from("disputes").update(update).eq("id", id);
  if (error) throw error;
}

/** Per-line outcome: a shop paying 3 of 4 disputed lines is the normal result. */
export async function updateDisputeLine(
  supabase: DbClient,
  id: string,
  patch: { recoveredHours?: number; recoveredDollars?: number | null },
): Promise<void> {
  const update: Database["public"]["Tables"]["dispute_lines"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.recoveredHours !== undefined)
    update.recovered_hours = patch.recoveredHours;
  if (patch.recoveredDollars !== undefined)
    update.recovered_dollars = patch.recoveredDollars;

  const { error } = await supabase
    .from("dispute_lines")
    .update(update)
    .eq("id", id);
  if (error) throw error;
}

/** Lines cascade via the FK. */
export async function deleteDispute(
  supabase: DbClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("disputes").delete().eq("id", id);
  if (error) throw error;
}

/** Used by clearAllDataAction. Tolerates a pre-migration DB. */
export async function clearAllDisputes(supabase: DbClient): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  // dispute_lines cascades from disputes, but rows are deleted explicitly first
  // so a future schema change that drops the cascade can't silently orphan them.
  const { error: lineError } = await supabase
    .from("dispute_lines")
    .delete()
    .eq("user_id", userId);
  if (lineError && !isMissingTable(lineError)) throw lineError;
  const { error } = await supabase
    .from("disputes")
    .delete()
    .eq("user_id", userId);
  if (error && !isMissingTable(error)) throw error;
}
