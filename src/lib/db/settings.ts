// User settings.
//
// Timer state used to live here as three columns on this singleton row. It
// moved to its own `active_timers` child table when the timer went to 3
// concurrent slots — see db/timers.ts for why (row-level atomicity and real
// foreign keys, neither of which a shared settings row could provide).
import type { Database } from "@/lib/supabase/database.types";
import type { FieldRegion, LaborType, PeriodOverride, RoTemplate, UserSettings } from "@/lib/types";
import { getCurrentUserId, retryOnce, type DbClient } from "./_client";

type SettingsRow = Database["public"]["Tables"]["user_settings"]["Row"];

// Normalises whatever is in ro_template (null, legacy single object, or new array)
// into the canonical RoTemplate[] shape — no DB migration required.
function normaliseTemplates(raw: unknown): RoTemplate[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as RoTemplate[];
  // Legacy: single object without id/name — wrap it transparently.
  if (typeof raw !== "object" || raw === null || !("imageStoragePath" in raw)) return [];
  const t = raw as { imageStoragePath: string; regions: FieldRegion[] };
  return [{ id: "legacy", name: "Page 1", imageStoragePath: t.imageStoragePath, regions: t.regions }];
}

function toSettings(row: SettingsRow): UserSettings {
  return {
    userId: row.user_id,
    splitDay: row.split_day,
    goalHours: row.goal_hours,
    periodOverrides:
      (row.period_overrides as Record<string, PeriodOverride> | null) ?? {},
    updatedAt: row.updated_at,
    roTemplates: normaliseTemplates(row.ro_template),
    defaultLaborType: (row.default_labor_type as LaborType | null) ?? null,
    referenceHourlyRate:
      row.reference_hourly_rate === null
        ? null
        : Number(row.reference_hourly_rate),
    // `?? {}` also covers a pre-migration DB, where select("*") simply
    // doesn't return the column.
    tagColors: (row.tag_colors as Record<string, number> | null) ?? {},
    // `?? false` also covers a pre-migration DB. Defaulting to false is the
    // safe direction for a consent flag: an unknown answer is never consent.
    shareLaborTimes: row.share_labor_times ?? false,
    // Same `?? false`, same reason in a different key: an unknown answer must
    // not put a new field in front of someone who never asked for it.
    trackRoTime: row.track_ro_time ?? false,
  };
}

export async function getSettings(supabase: DbClient): Promise<UserSettings> {
  const userId = await getCurrentUserId(supabase);
  const data = await retryOnce(async () => {
    const { data, error } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  });
  if (!data) {
    return {
      userId,
      splitDay: 15,
      goalHours: 88,
      periodOverrides: {},
      updatedAt: new Date().toISOString(),
      roTemplates: [],
      defaultLaborType: null,
      referenceHourlyRate: null,
      tagColors: {},
      shareLaborTimes: false,
      trackRoTime: false,
    };
  }
  return toSettings(data);
}

export type SettingsPatch = {
  splitDay?: number;
  goalHours?: number;
  periodOverrides?: Record<string, PeriodOverride>;
  roTemplates?: RoTemplate[];
  defaultLaborType?: LaborType | null;
  referenceHourlyRate?: number | null;
  tagColors?: Record<string, number>;
  shareLaborTimes?: boolean;
  trackRoTime?: boolean;
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
  if (patch.goalHours !== undefined) update.goal_hours = patch.goalHours;
  if (patch.periodOverrides !== undefined)
    update.period_overrides = patch.periodOverrides;
  if (patch.roTemplates !== undefined)
    update.ro_template = patch.roTemplates.length > 0 ? patch.roTemplates : null;
  if (patch.defaultLaborType !== undefined)
    update.default_labor_type = patch.defaultLaborType;
  if (patch.referenceHourlyRate !== undefined)
    update.reference_hourly_rate = patch.referenceHourlyRate;
  if (patch.tagColors !== undefined) update.tag_colors = patch.tagColors;
  if (patch.shareLaborTimes !== undefined)
    update.share_labor_times = patch.shareLaborTimes;
  // Needs a column-level UPDATE grant to be writable at all — granted in
  // 20260816000000_ro_time_and_upsell.sql. See the lock_is_admin migration.
  if (patch.trackRoTime !== undefined) update.track_ro_time = patch.trackRoTime;

  const { data, error } = await supabase
    .from("user_settings")
    .update(update)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return toSettings(data);
}

