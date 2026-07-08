// Data layer for the user's pay rates, keyed by labor type.
// One row per (user, labor_type); a missing row means that type is unpriced.
import type { Database } from "@/lib/supabase/database.types";
import type { LaborRate, LaborType } from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";

type LaborRateRow = Database["public"]["Tables"]["labor_rates"]["Row"];

function toLaborRate(row: LaborRateRow): LaborRate {
  return {
    laborType: row.labor_type as LaborType,
    // PostgREST returns numeric columns as strings — coerce like every other
    // numeric in this data layer.
    hourlyRate: Number(row.hourly_rate),
  };
}

export async function listLaborRates(supabase: DbClient): Promise<LaborRate[]> {
  const { data, error } = await supabase.from("labor_rates").select("*");
  if (error) throw error;
  return (data ?? []).map(toLaborRate);
}

// Set (or clear) one type's rate. A null/<=0 rate DELETES the row so "blank =
// unset" round-trips cleanly — there's no such thing as a stored 0 rate.
export async function setLaborRate(
  supabase: DbClient,
  laborType: LaborType,
  hourlyRate: number | null,
): Promise<void> {
  const userId = await getCurrentUserId(supabase);

  if (hourlyRate === null || hourlyRate <= 0) {
    const { error } = await supabase
      .from("labor_rates")
      .delete()
      .eq("user_id", userId)
      .eq("labor_type", laborType);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("labor_rates").upsert(
    {
      user_id: userId,
      labor_type: laborType,
      hourly_rate: hourlyRate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,labor_type" },
  );
  if (error) throw error;
}
