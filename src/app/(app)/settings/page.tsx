import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { isoDate, isoDateInTz } from "@/lib/periods";
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
import Link from "next/link";

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
  // "Today" is decided here, once, in the tech's zone, and handed to the client
  // cards. A client card calling isoDate() during render reads the VM's UTC
  // clock on the server and the phone's clock in the browser; on the last
  // evening of a month those are different months, and the pay-period preview
  // failed hydration on /settings (deploy rolled back 2026-09-30 20:33 PT).
  const today = timezone ? isoDateInTz(timezone) : isoDate();

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
          <SplitDayCard initialSplitDay={settings.splitDay} overrideCount={overrideCount} today={today} />
          <TimezoneCard initialTimezone={timezone} />
          <TrueTimeCard initialShare={settings.shareLaborTimes} />
          <section className="card padded-lg">
            <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--fg-0)" }}>
              Work Schedule & Days Off
            </h2>
            <p className="mb-4 text-sm" style={{ color: "var(--fg-2)" }}>
              Your weekly pattern, days off, and one-day changes live on the
              schedule calendar — they drive efficiency on days you don&apos;t
              enter clocked hours.
            </p>
            <Link href="/schedule" className="btn btn-primary">
              Open schedule calendar
            </Link>
          </section>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="section-title">Logging</h2>
        <div className="space-y-6">
          <QuickAddCard />
          <RoTimeCard initialTrack={settings.trackRoTime} />
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
