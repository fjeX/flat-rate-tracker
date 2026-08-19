// Actual paid-flag-hours per pay period (for discrepancy checks).
import type { Database } from "@/lib/supabase/database.types";
import type { PaidPeriod } from "@/lib/types";
import { getCurrentUserId, retryOnce, type DbClient } from "./_client";

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
  const data = await retryOnce(async () => {
    const { data, error } = await supabase
      .from("paid_period_hours")
      .select("*")
      .order("period_key", { ascending: false });
    if (error) throw error;
    return data;
  });
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

// Put a period back to "no paid figure entered yet".
//
// This has to be a DELETE, not a write. `paid_flag_hours` is
// `numeric(6,2) not null default 0`, so there is no value that means "unset" —
// 0 means "the shop paid zero hours", which is a real (and damning) answer.
// Absence of the row is the only way to say "not told yet", which is exactly
// what getPaidPeriod already reads back as null.
//
// Both filters matter. `user_id` mirrors every other write in this file (and
// the "own_paid_period_hours" policy already scopes it), but `period_key` is
// what keeps this from wiping the tech's entire paid-period history — the PK
// is (user_id, period_key), so a delete missing it matches every row they own.
export async function deletePaidPeriod(
  supabase: DbClient,
  periodKey: string,
): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("paid_period_hours")
    .delete()
    .eq("user_id", userId)
    .eq("period_key", periodKey);
  if (error) throw error;
}
