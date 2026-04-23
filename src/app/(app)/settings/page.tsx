import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { SplitDayCard } from "@/components/settings/SplitDayCard";
import { DataCard } from "@/components/settings/DataCard";
import { DangerZoneCard } from "@/components/settings/DangerZoneCard";

export default async function SettingsPage() {
  const supabase = await createClient();
  const settings = await db.getSettings(supabase);
  const overrideCount = Object.keys(settings.periodOverrides).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <h1 className="text-xl font-semibold text-zinc-100">Settings</h1>
      <SplitDayCard initialSplitDay={settings.splitDay} overrideCount={overrideCount} />
      <DataCard />
      <DangerZoneCard />
    </div>
  );
}
