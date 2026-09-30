import { cookies } from "next/headers";
import Link from "next/link";
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
import { RoTimeCard } from "@/components/settings/RoTimeCard";
import { TrueTimeCard } from "@/components/settings/TrueTimeCard";
import { AppearanceCard } from "@/components/settings/AppearanceCard";
import { SettingRow } from "@/components/settings/SettingRow";
import { Zone } from "@/components/ui/Zone";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [settings, laborRates] = await Promise.all([
    db.getSettings(supabase),
    db.listLaborRates(supabase),
  ]);
  const overrideCount = Object.keys(settings.periodOverrides).length;
  const cookieStore = await cookies();
  const timezone = cookieStore.get("frt_timezone")?.value ?? "";

  return (
    <main className="stg-page">
      <div className="pagehead">
        <div className="grow">
          <h1>Settings</h1>
          <p>How the app tracks, logs and looks. Every change saves on its own.</p>
        </div>
      </div>

      <div className="stg-col">
        {/* Phase 3 built Appearance from the mock; it keeps its own layout. */}
        <Zone id="appearance" name="Appearance">
          <AppearanceCard
            initialTheme={settings.theme}
            initialAccent={settings.accent}
            mode="account"
          />
        </Zone>

        <Zone name="Tracking">
          <GoalHoursCard initialGoalHours={settings.goalHours} />
          <PayRatesCard
            initialRates={laborRates}
            initialDefaultLaborType={settings.defaultLaborType}
          />
          <ReferenceRateCard initialRate={settings.referenceHourlyRate} />
          <SplitDayCard initialSplitDay={settings.splitDay} overrideCount={overrideCount} />
          <TimezoneCard initialTimezone={timezone} />
          <TrueTimeCard initialShare={settings.shareLaborTimes} />
          <SettingRow
            titleAs="h2"
            title="Work Schedule & Days Off"
            description="Your weekly pattern, days off, and one-day changes live on the schedule calendar — they drive efficiency on days you don't enter clocked hours."
          >
            <Link href="/schedule" className="btn btn-line">
              Open schedule calendar
            </Link>
          </SettingRow>
        </Zone>

        <Zone name="Logging">
          <QuickAddCard />
          <RoTimeCard initialTrack={settings.trackRoTime} />
          <RoTemplateCard userId={user!.id} initialTemplates={settings.roTemplates} />
        </Zone>

        <Zone name="Data">
          <DataCard />
          <DangerZoneCard />
        </Zone>
      </div>
    </main>
  );
}
