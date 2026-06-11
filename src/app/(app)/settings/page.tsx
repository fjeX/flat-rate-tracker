import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { GoalHoursCard } from "@/components/settings/GoalHoursCard";
import { SplitDayCard } from "@/components/settings/SplitDayCard";
import { DataCard } from "@/components/settings/DataCard";
import { DangerZoneCard } from "@/components/settings/DangerZoneCard";
import { RoTemplateCard } from "@/components/settings/RoTemplateCard";
import { TimezoneCard } from "@/components/settings/TimezoneCard";
import { QuickAddCard } from "@/components/settings/QuickAddCard";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const settings = await db.getSettings(supabase);
  const overrideCount = Object.keys(settings.periodOverrides).length;
  const cookieStore = await cookies();
  const timezone = cookieStore.get("frt_timezone")?.value ?? "";

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <h1 className="text-xl font-semibold text-zinc-100">Settings</h1>
      <TimezoneCard initialTimezone={timezone} />
      <QuickAddCard />
      <GoalHoursCard initialGoalHours={settings.goalHours} />
      <SplitDayCard initialSplitDay={settings.splitDay} overrideCount={overrideCount} />
      <RoTemplateCard userId={user!.id} initialTemplates={settings.roTemplates} />
      <DataCard />
      <DangerZoneCard />
    </div>
  );
}
