// Insights — the cross-period surface.
//
// This page exists because the Pay Period page kept growing lifetime figures it
// wasn't allowed to keep. Its scope rule is that every number on it describes
// the period in its title bar; anything that spans periods belongs here. The
// dispute-recovery block below was living on Pay Period in violation of that,
// reporting the same "2 claims closed · 100% got paid" on every period a tech
// opened, including periods with no claim at all.
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { isoDate, isoDateInTz } from "@/lib/periods";
import { dailyDenominators } from "@/lib/stats";
import { dataRange } from "@/lib/insights";
import { InsightsView } from "@/components/insights/InsightsView";

export default async function InsightsPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const tz = cookieStore.get("frt_timezone")?.value;
  const today = tz ? isoDateInTz(tz) : isoDate();
  const weekStartDay = Number(
    cookieStore.get("frt_week_start")?.value ?? "0",
  ) as 0 | 1;

  // Deliberately unbounded. Other pages page their entry loads; this one is the
  // whole point of having history, and a silent limit here wouldn't look like a
  // bug — it would look like a tech who improved. If it ever gets slow the fix
  // is a SQL-side aggregate, not a smaller window.
  const [settings, entries, clocks, library] = await Promise.all([
    db.getSettings(supabase),
    db.listEntries(supabase),
    db.listDailyClocks(supabase),
    db.listOpCodes(supabase),
  ]);

  // Null until their migrations land; every consumer treats null as "hide".
  const [schedules, daysOff, confirmedZeroDays, shiftOverrides, disputes] =
    await Promise.all([
      db.listWorkSchedulesSafe(supabase),
      db.listDaysOffSafe(supabase),
      db.listConfirmedZeroDaysSafe(supabase),
      db.listShiftOverridesSafe(supabase),
      db.listDisputesSafe(supabase),
    ]);

  const range = dataRange(entries, clocks);

  // The same per-day denominator the dashboard and the period stats use, over
  // the whole span of the tech's data. One derivation, so a weekday figure here
  // can never contradict the efficiency on the dashboard.
  const denomByDay = range
    ? dailyDenominators(
        entries,
        clocks,
        range,
        today,
        schedules && schedules.length > 0
          ? {
              schedules,
              daysOff: daysOff ?? [],
              confirmedZeroDays: confirmedZeroDays ?? [],
              today,
              shiftOverrides: shiftOverrides ?? {},
            }
          : null,
      )
    : {};

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold" style={{ color: "var(--fg-0)" }}>
        Insights
      </h1>
      <p className="mt-1 text-sm" style={{ color: "var(--fg-2)" }}>
        What your own history says, across every pay period.
      </p>

      <div className="mt-6">
        {/* The aggregates are computed in the client component, not here: the
            window chips re-scope every section, and round-tripping to the
            server for each chip press would make them feel broken. The pure
            functions in lib/insights run the same either side. */}
        <InsightsView
          entries={entries}
          denomByDay={denomByDay}
          library={library}
          splitDay={settings.splitDay}
          periodOverrides={settings.periodOverrides}
          today={today}
          weekStartDay={weekStartDay}
          disputes={disputes}
        />
      </div>
    </main>
  );
}
