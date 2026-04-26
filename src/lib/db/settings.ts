// User settings, including persistent timer state.
import type { Database } from "@/lib/supabase/database.types";
import type { FieldRegion, PeriodOverride, RoTemplate, UserSettings } from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";

type SettingsRow = Database["public"]["Tables"]["user_settings"]["Row"];

// Normalises whatever is in ro_template (null, legacy single object, or new array)
// into the canonical RoTemplate[] shape — no DB migration required.
function normaliseTemplates(raw: unknown): RoTemplate[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as RoTemplate[];
  // Legacy: single object without id/name — wrap it transparently.
  const t = raw as { imageStoragePath: string; regions: FieldRegion[] };
  return [{ id: "legacy", name: "Page 1", imageStoragePath: t.imageStoragePath, regions: t.regions }];
}

function toSettings(row: SettingsRow): UserSettings {
  return {
    userId: row.user_id,
    splitDay: row.split_day,
    periodOverrides:
      (row.period_overrides as Record<string, PeriodOverride> | null) ?? {},
    timerRoId: row.timer_ro_id,
    timerStartTime: row.timer_start_time,
    timerAccumulated: row.timer_accumulated,
    updatedAt: row.updated_at,
    roTemplates: normaliseTemplates(row.ro_template),
  };
}

export async function getSettings(supabase: DbClient): Promise<UserSettings> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return toSettings(data);
}

export type SettingsPatch = {
  splitDay?: number;
  periodOverrides?: Record<string, PeriodOverride>;
  roTemplates?: RoTemplate[];
};

export async function updateSettings(
  supabase: DbClient,
  patch: SettingsPatch,
): Promise<UserSettings> {
  const userId = await getCurrentUserId(supabase);
  const update: Database["public"]["Tables"]["user_settings"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.splitDay !== undefined) update.split_day = patch.splitDay;
  if (patch.periodOverrides !== undefined)
    update.period_overrides = patch.periodOverrides;
  if (patch.roTemplates !== undefined)
    update.ro_template = patch.roTemplates.length > 0 ? patch.roTemplates : null;

  const { data, error } = await supabase
    .from("user_settings")
    .update(update)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return toSettings(data);
}

// --- Timer state (server-persistent so it survives device switches) ---

export type TimerState = {
  roId: string | null;
  startTime: number | null; // null means paused or not running
  accumulated: number; // ms accumulated while paused
};

export async function setTimerState(
  supabase: DbClient,
  state: TimerState,
): Promise<void> {
  const userId = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("user_settings")
    .update({
      timer_ro_id: state.roId,
      timer_start_time: state.startTime,
      timer_accumulated: state.accumulated,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw error;
}
