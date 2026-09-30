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
import { SettingsSwitcher, type SettingsSection } from "@/components/settings/SettingsSwitcher";

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

  // One setting on display at a time (the mock's screen-settings); Pay Rates
  // opens first because it is the one that changes what every other page
  // shows. The order here is the order of the "More settings" list.
  const sections: SettingsSection[] = [
    {
      id: "pay-rates",
      name: "Pay Rates",
      group: "Tracking",
      content: (
        <PayRatesCard
          initialRates={laborRates}
          initialDefaultLaborType={settings.defaultLaborType}
        />
      ),
    },
    {
      id: "goal",
      name: "Pay Period Goal",
      group: "Tracking",
      content: <GoalHoursCard initialGoalHours={settings.goalHours} />,
    },
    {
      id: "period",
      name: "Pay Period Defaults",
      group: "Tracking",
      content: <SplitDayCard initialSplitDay={settings.splitDay} overrideCount={overrideCount} />,
    },
    {
      id: "reference-rate",
      name: "Reference hourly rate",
      group: "Tracking",
      content: <ReferenceRateCard initialRate={settings.referenceHourlyRate} />,
    },
    {
      id: "schedule",
      name: "Work Schedule & Days Off",
      group: "Tracking",
      content: (
        <SettingRow
          titleAs="h2"
          title="Work Schedule & Days Off"
          description="Your weekly pattern, days off, and one-day changes live on the schedule calendar — they drive efficiency on days you don't enter clocked hours."
        >
          <Link href="/schedule" className="btn btn-line">
            Open schedule calendar
          </Link>
        </SettingRow>
      ),
    },
    {
      id: "timezone",
      name: "Timezone",
      group: "Tracking",
      content: <TimezoneCard initialTimezone={timezone} />,
    },
    {
      id: "true-time",
      name: "Contribute to True Time",
      group: "Tracking",
      content: <TrueTimeCard initialShare={settings.shareLaborTimes} />,
    },
    {
      id: "quick-add",
      name: "Quick Add RO",
      group: "Logging",
      content: <QuickAddCard />,
    },
    {
      id: "ro-time",
      name: "Time of day on each RO",
      group: "Logging",
      content: <RoTimeCard initialTrack={settings.trackRoTime} />,
    },
    {
      id: "templates",
      name: "RO Scan Templates",
      group: "Logging",
      content: <RoTemplateCard userId={user!.id} initialTemplates={settings.roTemplates} />,
    },
    {
      id: "appearance",
      name: "Appearance",
      group: "Appearance",
      // Phase 3 built this from the mock; it keeps its own layout.
      content: (
        <AppearanceCard
          initialTheme={settings.theme}
          initialAccent={settings.accent}
          mode="account"
        />
      ),
    },
    {
      id: "backup",
      name: "Backup",
      group: "Data",
      content: <DataCard />,
    },
    {
      id: "danger",
      name: "Danger Zone",
      group: "Data",
      content: <DangerZoneCard />,
    },
  ];

  return (
    <main className="stg-page">
      <div className="pagehead">
        <div className="grow">
          <h1>Settings</h1>
          <p>Saved to your account as you change them.</p>
        </div>
      </div>
      <SettingsSwitcher sections={sections} defaultId="pay-rates" />
    </main>
  );
}
