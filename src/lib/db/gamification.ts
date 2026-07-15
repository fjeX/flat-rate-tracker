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
import type { DayOff, Entry, PortfolioSnapshot, SnapshotStats } from "@/lib/types";
import { computeStreak, type StreakResult } from "@/lib/streak";
import {
  careerMilestonesHit,
  nextCareerMilestone,
  nextSnapshotThreshold,
  snapshotSeqForThreshold,
  snapshotThresholdsReached,
} from "@/lib/career";
import { buildSnapshotStats, chronological } from "@/lib/snapshots";
import { addDays } from "@/lib/periods";
import { getCurrentUserId, type DbClient } from "./_client";
import { listOpCodes } from "./op-codes";

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

async function generateMissingSnapshots(
  supabase: DbClient,
  roCount: number,
  existing: PortfolioSnapshot[],
): Promise<PortfolioSnapshot[]> {
  const due = snapshotThresholdsReached(roCount);
  const have = new Set(existing.map((s) => s.roThreshold));
  const missing = due.filter((t) => !have.has(t));
  if (missing.length === 0) return existing;

  const userId = await getCurrentUserId(supabase);
  const [all, library, photoEntryIds] = await Promise.all([
    listAllEntriesChronological(supabase),
    listOpCodes(supabase),
    listAllPhotoEntryIds(supabase),
  ]);

  for (const threshold of missing) {
    const stats = buildSnapshotStats(
      all.slice(0, threshold),
      library,
      photoEntryIds,
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
  opts: { today: string },
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

    const freshSnapshots = await generateMissingSnapshots(
      supabase,
      roCount,
      snapshots,
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
