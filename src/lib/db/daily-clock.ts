// Daily clocked-in hours (one row per user per date).
import type { Database } from "@/lib/supabase/database.types";
import type { DailyClock } from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";

type ClockRow = Database["public"]["Tables"]["daily_clock_hours"]["Row"];

function toDailyClock(row: ClockRow): DailyClock {
  return {
    userId: row.user_id,
    date: row.date,
    hours: Number(row.hours),
  };
}

export async function getDailyClock(
  supabase: DbClient,
  date: string,
): Promise<DailyClock | null> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("daily_clock_hours")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (error) throw error;
  return data ? toDailyClock(data) : null;
}

export async function listDailyClocks(
  supabase: DbClient,
  opts: { from?: string; to?: string } = {},
): Promise<DailyClock[]> {
  let q = supabase
    .from("daily_clock_hours")
    .select("*")
    .order("date", { ascending: false });
  if (opts.from) q = q.gte("date", opts.from);
  if (opts.to) q = q.lte("date", opts.to);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toDailyClock);
}

export async function upsertDailyClock(
  supabase: DbClient,
  date: string,
  hours: number,
): Promise<DailyClock> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("daily_clock_hours")
    .upsert({ user_id: userId, date, hours }, { onConflict: "user_id,date" })
    .select()
    .single();
  if (error) throw error;
  return toDailyClock(data);
}
