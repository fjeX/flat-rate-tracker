// Data layer for gamification Phase 1: days off, career milestones, portfolio
// snapshots, and the one-call dashboard orchestrator (docs/gamification.md).
//
// Design rules baked in here:
//   - streak/odometer are DERIVED from entries at read time — no counters
//   - career milestones are earned-once rows, never revoked by RO edits
//   - snapshots are immutable; generation is idempotent (unique constraints
//     absorb races) and backfill-safe (stats over the first N ROs)
//   - all-time reads are PAGED — PostgREST caps a single response (~1000
//     rows), which would silently truncate a veteran's history
//
// Every read here tolerates a pre-migration database (tables not created
// yet): getGamificationData returns null and the dashboard hides the cards.

import type { Database, Json } from "@/lib/supabase/database.types";
import type {
  CareerMilestone,
  DayOff,
  Entry,
  PortfolioSnapshot,
  SnapshotStats,
} from "@/lib/types";
import { computeStreak, type StreakResult } from "@/lib/streak";
import {
  careerMilestonesHit,
  nextCareerMilestone,
  nextSnapshotThreshold,
  snapshotSeqForThreshold,
  snapshotThresholdsReached,
} from "@/lib/career";
import {
  buildSnapshotStats,
  chronological,
  settledThresholds,
  snapshotEfficiency,
  unbackedSnapshots,
  type SnapshotScheduleData,
} from "@/lib/snapshots";
import { addDays } from "@/lib/periods";
import type { DailyClock } from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";
import { listOpCodes } from "./op-codes";
import {
  listConfirmedZeroDaysSafe,
  listShiftOverridesSafe,
  listWorkSchedulesSafe,
} from "./schedules";

const PAGE = 500;

type DayOffRow = Database["public"]["Tables"]["days_off"]["Row"];
type SnapshotRow = Database["public"]["Tables"]["portfolio_snapshots"]["Row"];

// PostgREST reports a table missing from its schema cache as PGRST205; raw
// Postgres says 42P01. Either way: migration not applied yet, feature off.
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "PGRST205" || e.code === "42P01") return true;
  return /schema cache|does not exist/i.test(e.message ?? "");
}

// ------------------------------------------------------------------------
// days_off
// ------------------------------------------------------------------------

function toDayOff(row: DayOffRow): DayOff {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  };
}

/** listDaysOff that reports a pre-migration DB as null instead of throwing —
 * lets the settings page hide the card rather than crash. */
export async function listDaysOffSafe(supabase: DbClient): Promise<DayOff[] | null> {
  try {
    return await listDaysOff(supabase);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export async function listDaysOff(supabase: DbClient): Promise<DayOff[]> {
  const { data, error } = await supabase
    .from("days_off")
    .select("*")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toDayOff);
}

export async function addDayOff(
  supabase: DbClient,
  startDate: string,
  endDate: string,
): Promise<DayOff> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("days_off")
    .insert({ user_id: userId, start_date: startDate, end_date: endDate })
    .select()
    .single();
  if (error) throw error;
  return toDayOff(data);
}

export async function deleteDayOff(supabase: DbClient, id: string): Promise<void> {
  const { error } = await supabase.from("days_off").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------------------
// career_milestones — earned-once
// ------------------------------------------------------------------------

export async function listCareerMilestones(supabase: DbClient): Promise<number[]> {
  const { data, error } = await supabase
    .from("career_milestones")
    .select("threshold");
  if (error) throw error;
  return (data ?? []).map((r) => r.threshold).sort((a, b) => a - b);
}

/**
 * The same rows WITH achieved_at, for a backup. Null pre-migration.
 *
 * Kept separate from listCareerMilestones rather than widening it: the dashboard
 * asks "which thresholds have I crossed" and answers that with a number[], and
 * every caller of it would have to unwrap an object for a field it never uses.
 * A backup asks a different question — "when did I cross them" — because
 * re-stamping the date on import would compress a multi-year career into one
 * afternoon.
 */
export async function listCareerMilestonesForBackupSafe(
  supabase: DbClient,
): Promise<CareerMilestone[] | null> {
  try {
    const { data, error } = await supabase
      .from("career_milestones")
      .select("threshold, achieved_at")
      .order("threshold", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      threshold: r.threshold,
      achievedAt: r.achieved_at,
    }));
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** Record crossed milestones. Idempotent — existing rows are left alone. */
export async function recordCareerMilestones(
  supabase: DbClient,
  thresholds: number[],
): Promise<void> {
  if (thresholds.length === 0) return;
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("career_milestones")
    .upsert(
      thresholds.map((threshold) => ({ user_id: userId, threshold })),
      { onConflict: "user_id,threshold", ignoreDuplicates: true },
    );
  if (error) throw error;
}

// ------------------------------------------------------------------------
// portfolio_snapshots — immutable records
// ------------------------------------------------------------------------

function toSnapshot(row: SnapshotRow): PortfolioSnapshot {
  return {
    id: row.id,
    seq: row.seq,
    roThreshold: row.ro_threshold,
    stats: row.stats as unknown as SnapshotStats,
    createdAt: row.created_at,
  };
}

export async function listSnapshots(supabase: DbClient): Promise<PortfolioSnapshot[]> {
  const { data, error } = await supabase
    .from("portfolio_snapshots")
    .select("*")
    .order("seq", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toSnapshot);
}

/** listSnapshots that reports a pre-migration DB as null instead of throwing. */
export async function listSnapshotsSafe(
  supabase: DbClient,
): Promise<PortfolioSnapshot[] | null> {
  try {
    return await listSnapshots(supabase);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

// ------------------------------------------------------------------------
// Paged all-time reads (PostgREST truncates unpaged responses)
// ------------------------------------------------------------------------

export type EntryDay = { date: string; flagHours: number };

/** Lightweight all-time projection: one row per entry, date + flag hours. */
export async function listAllEntryDays(supabase: DbClient): Promise<EntryDay[]> {
  const out: EntryDay[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("entries")
      .select("date, flag_hours")
      .order("date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      out.push({ date: r.date, flagHours: Number(r.flag_hours) });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Full all-time entries with lines, in log order — snapshot generation only. */
async function listAllEntriesChronological(supabase: DbClient): Promise<Entry[]> {
  // Local import avoids a cycle: entries.ts doesn't know about gamification.
  const { listEntries } = await import("./entries");
  const out: Entry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await listEntries(supabase, { limit: PAGE, offset });
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return chronological(out);
}

/** All-time clock rows, paged — snapshot generation only. */
async function listAllDailyClocks(supabase: DbClient): Promise<DailyClock[]> {
  const out: DailyClock[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("daily_clock_hours")
      .select("user_id, date, hours")
      .order("date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      out.push({ userId: r.user_id, date: r.date, hours: Number(r.hours) });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** entry_id of every photo the user owns (for per-snapshot photo counts). */
async function listAllPhotoEntryIds(supabase: DbClient): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("entry_photos")
      .select("entry_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []).map((r) => r.entry_id));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// ------------------------------------------------------------------------
// Snapshot generation — rare path, only when a threshold is newly crossed
// ------------------------------------------------------------------------

/**
 * Drop snapshots that claim more ROs than the tech now has.
 *
 * Snapshots are immutable in CONTENT — nothing here rewrites a frozen stat. But
 * a snapshot at threshold 100 held by an account with 99 ROs is a record of
 * something that did not happen: the rows it froze have since been deleted. It
 * also puts the dashboard in open contradiction with itself ("Next: Snapshot #5
 * · 99/100" sitting under a frozen snapshot of 100).
 *
 * Only snapshots ABOVE the current count are withdrawn, which is what keeps this
 * safe: a tech at 149 ROs who deletes one still has every snapshot up to 100,
 * because those thresholds are still genuinely cleared. Nothing is lost either
 * way — a snapshot is derived data, rebuilt from the first N entries the moment
 * the count is legitimately reached again.
 */
async function withdrawUnbackedSnapshots(
  supabase: DbClient,
  roCount: number,
  existing: PortfolioSnapshot[],
): Promise<PortfolioSnapshot[]> {
  const unbacked = unbackedSnapshots(existing, roCount);
  if (unbacked.length === 0) return existing;
  const { error } = await supabase
    .from("portfolio_snapshots")
    .delete()
    .in(
      "id",
      unbacked.map((s) => s.id),
    );
  if (error) throw error;
  return existing.filter((s) => s.roThreshold <= roCount);
}

async function generateMissingSnapshots(
  supabase: DbClient,
  roCount: number,
  existing: PortfolioSnapshot[],
  today: string,
  nowMs: number,
): Promise<PortfolioSnapshot[]> {
  const due = snapshotThresholdsReached(roCount);
  const have = new Set(existing.map((s) => s.roThreshold));
  const missing = due.filter((t) => !have.has(t));
  if (missing.length === 0) return existing;

  const userId = await getCurrentUserId(supabase);
  const [all, library, photoEntryIds, schedules] = await Promise.all([
    listAllEntriesChronological(supabase),
    listOpCodes(supabase),
    listAllPhotoEntryIds(supabase),
    // Null pre-migration; empty when no schedule is set up yet.
    listWorkSchedulesSafe(supabase),
  ]);

  // Freeze only what has stopped moving. A threshold held back here is not
  // lost — it is picked up by the next dashboard load once it settles.
  const ready = settledThresholds(all, missing, nowMs);
  if (ready.length === 0) return existing;

  // Schedule-aware overall efficiency is only worth freezing once a schedule
  // exists — the extra fetches are skipped otherwise (rare path regardless).
  let scheduleData: SnapshotScheduleData = null;
  if (schedules !== null && schedules.length > 0) {
    const [clocks, daysOff, confirmedZeroDays, shiftOverrides] = await Promise.all([
      listAllDailyClocks(supabase),
      listDaysOff(supabase),
      listConfirmedZeroDaysSafe(supabase),
      listShiftOverridesSafe(supabase),
    ]);
    scheduleData = {
      clocks,
      ctx: {
        schedules,
        daysOff,
        confirmedZeroDays: confirmedZeroDays ?? [],
        today,
        shiftOverrides: shiftOverrides ?? {},
      },
    };
  }

  for (const threshold of ready) {
    const stats = buildSnapshotStats(
      all.slice(0, threshold),
      library,
      photoEntryIds,
      scheduleData,
    );
    // ignoreDuplicates: a concurrent load generating the same snapshot wins
    // quietly — seq is deterministic, so both writers agree on the row.
    const { error } = await supabase.from("portfolio_snapshots").upsert(
      {
        user_id: userId,
        seq: snapshotSeqForThreshold(threshold),
        ro_threshold: threshold,
        stats: stats as unknown as Json,
      },
      { onConflict: "user_id,ro_threshold", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  return listSnapshots(supabase);
}

// ------------------------------------------------------------------------
// Efficiency backfill — snapshots frozen before the schedule feature
// ------------------------------------------------------------------------

/** Snapshots frozen before schedule-aware efficiency existed have no
 * overallEfficiency key at all. Once a schedule exists, patch those rows a
 * single time: recompute over the same first-N entries and merge ONLY the two
 * efficiency fields into the stored stats — everything else stays frozen.
 * After the patch the key exists (possibly null), so this never re-runs. */
async function backfillSnapshotEfficiency(
  supabase: DbClient,
  snapshots: PortfolioSnapshot[],
  today: string,
): Promise<PortfolioSnapshot[]> {
  const missing = snapshots.filter(
    (s) => !("overallEfficiency" in (s.stats as unknown as Record<string, unknown>)),
  );
  if (missing.length === 0) return snapshots;

  // No schedule yet — nothing meaningful to compute; try again once one exists.
  const schedules = await listWorkSchedulesSafe(supabase);
  if (schedules === null || schedules.length === 0) return snapshots;

  const [all, clocks, daysOff, confirmedZeroDays, shiftOverrides] = await Promise.all([
    listAllEntriesChronological(supabase),
    listAllDailyClocks(supabase),
    listDaysOff(supabase),
    listConfirmedZeroDaysSafe(supabase),
    listShiftOverridesSafe(supabase),
  ]);
  const scheduleData: SnapshotScheduleData = {
    clocks,
    ctx: {
      schedules,
      daysOff,
      confirmedZeroDays: confirmedZeroDays ?? [],
      today,
      shiftOverrides: shiftOverrides ?? {},
    },
  };

  for (const snap of missing) {
    const eff = snapshotEfficiency(all.slice(0, snap.roThreshold), scheduleData);
    const stats = { ...(snap.stats as unknown as Record<string, unknown>), ...eff };
    const { error } = await supabase
      .from("portfolio_snapshots")
      .update({ stats: stats as unknown as Json })
      .eq("id", snap.id);
    if (error) throw error;
  }
  return listSnapshots(supabase);
}

// ------------------------------------------------------------------------
// Dashboard orchestrator
// ------------------------------------------------------------------------

export type GamificationData = {
  streak: StreakResult;
  careerTotal: number;
  roCount: number;
  /** Earned-once milestones (stored ∪ derived) for the road pins. */
  careerMilestones: number[];
  nextCareerMilestone: number | null;
  /** Flag hours in the trailing 7 days — the "+x this week" delta. */
  weekDelta: number;
  snapshots: PortfolioSnapshot[]; // newest first
  nextSnapshotAt: number;
};

/**
 * Everything the dashboard's gamification cards need, in one call.
 * Returns null when the gamification tables haven't been migrated yet —
 * caller hides the cards instead of crashing the page.
 */
export async function getGamificationData(
  supabase: DbClient,
  // nowMs is injectable so the snapshot settle window can be tested without
  // waiting an hour; production callers pass today only.
  opts: { today: string; nowMs?: number },
): Promise<GamificationData | null> {
  try {
    const [entryDays, daysOff, storedMilestones, snapshots] = await Promise.all([
      listAllEntryDays(supabase),
      listDaysOff(supabase),
      listCareerMilestones(supabase),
      listSnapshots(supabase),
    ]);

    const streak = computeStreak({
      loggedDates: [...new Set(entryDays.map((d) => d.date))],
      daysOff,
      today: opts.today,
    });

    const careerTotal =
      Math.round(entryDays.reduce((sum, d) => sum + d.flagHours, 0) * 100) / 100;
    const roCount = entryDays.length;

    const weekFrom = addDays(opts.today, -6);
    const weekDelta =
      Math.round(
        entryDays
          .filter((d) => d.date >= weekFrom && d.date <= opts.today)
          .reduce((sum, d) => sum + d.flagHours, 0) * 100,
      ) / 100;

    // Earned-once: record any newly crossed thresholds, display the union so
    // a later correction can lower the total without un-ringing the bell.
    const derived = careerMilestonesHit(careerTotal);
    const newly = derived.filter((t) => !storedMilestones.includes(t));
    if (newly.length > 0) await recordCareerMilestones(supabase, newly);
    const careerMilestones = [...new Set([...storedMilestones, ...derived])].sort(
      (a, b) => a - b,
    );

    // Withdraw first, then generate: a snapshot whose rows were deleted has to
    // go before the same threshold can be re-earned and refrozen from the
    // entries that actually exist now.
    const backed = await withdrawUnbackedSnapshots(supabase, roCount, snapshots);
    const freshSnapshots = await backfillSnapshotEfficiency(
      supabase,
      await generateMissingSnapshots(
        supabase,
        roCount,
        backed,
        opts.today,
        opts.nowMs ?? Date.now(),
      ),
      opts.today,
    );

    return {
      streak,
      careerTotal,
      roCount,
      careerMilestones,
      nextCareerMilestone: nextCareerMilestone(careerTotal),
      weekDelta,
      snapshots: freshSnapshots,
      nextSnapshotAt: nextSnapshotThreshold(roCount),
    };
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}
