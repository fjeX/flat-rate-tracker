import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { GoalHoursCard } from "@/components/settings/GoalHoursCard";
import { PayRatesCard } from "@/components/settings/PayRatesCard";
import { ReferenceRateCard } from "@/components/settings/ReferenceRateCard";
import { SplitDayCard } from "@/components/settings/SplitDayCard";
import { DataCard } from "@/components/settings/DataCard";
import { DangerZoneCard } from "@/components/settings/DangerZoneCard";
import { RoTemplateCard } from "@/components/settings/RoTemplateCard";
import { TimezoneCard } from "@/components/settings/TimezoneCard";
import { QuickAddCard } from "@/components/settings/QuickAddCard";
import { DaysOffCard } from "@/components/settings/DaysOffCard";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [settings, laborRates, daysOff] = await Promise.all([
    db.getSettings(supabase),
    db.listLaborRates(supabase),
    // null while the gamification migration hasn't been applied — card hidden.
    db.listDaysOffSafe(supabase),
  ]);
  const overrideCount = Object.keys(settings.periodOverrides).length;
  const cookieStore = await cookies();
  const timezone = cookieStore.get("frt_timezone")?.value ?? "";

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-semibold" style={{ color: "var(--fg-0)" }}>Settings</h1>

      <section className="mt-6">
        <h2 className="section-title">Tracking</h2>
        <div className="space-y-6">
          <GoalHoursCard initialGoalHours={settings.goalHours} />
          <PayRatesCard
            initialRates={laborRates}
            initialDefaultLaborType={settings.defaultLaborType}
          />
          <ReferenceRateCard initialRate={settings.referenceHourlyRate} />
          <SplitDayCard initialSplitDay={settings.splitDay} overrideCount={overrideCount} />
          <TimezoneCard initialTimezone={timezone} />
          {daysOff !== null && <DaysOffCard initialDaysOff={daysOff} />}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="section-title">Logging</h2>
        <div className="space-y-6">
          <QuickAddCard />
          <RoTemplateCard userId={user!.id} initialTemplates={settings.roTemplates} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="section-title">Data</h2>
        <div className="space-y-6">
          <DataCard />
          <DangerZoneCard />
        </div>
      </section>
    </main>
  );
}
