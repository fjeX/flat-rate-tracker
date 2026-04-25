// Actual paid-flag-hours per pay period (for discrepancy checks).
import type { Database } from "@/lib/supabase/database.types";
import type { PaidPeriod } from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";

type PaidRow = Database["public"]["Tables"]["paid_period_hours"]["Row"];

function toPaidPeriod(row: PaidRow): PaidPeriod {
  return {
    userId: row.user_id,
    periodKey: row.period_key,
    paidFlagHours: Number(row.paid_flag_hours),
  };
}

export async function getPaidPeriod(
  supabase: DbClient,
  periodKey: string,
): Promise<PaidPeriod | null> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("paid_period_hours")
    .select("*")
    .eq("user_id", userId)
    .eq("period_key", periodKey)
    .maybeSingle();
  if (error) throw error;
  return data ? toPaidPeriod(data) : null;
}

export async function listPaidPeriods(supabase: DbClient): Promise<PaidPeriod[]> {
  const { data, error } = await supabase
    .from("paid_period_hours")
    .select("*")
    .order("period_key", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toPaidPeriod);
}

export async function upsertPaidPeriod(
  supabase: DbClient,
  periodKey: string,
  paidFlagHours: number,
): Promise<PaidPeriod> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("paid_period_hours")
    .upsert(
      { user_id: userId, period_key: periodKey, paid_flag_hours: paidFlagHours },
      { onConflict: "user_id,period_key" },
    )
    .select()
    .single();
  if (error) throw error;
  return toPaidPeriod(data);
}
