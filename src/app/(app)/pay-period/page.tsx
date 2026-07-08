import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import {
  getPeriodForDate,
  getRangeForPeriodKey,
  isoDate,
  isoDateInTz,
  type PeriodRange,
} from "@/lib/periods";
import { aggregateStats } from "@/lib/stats";
import { ratesToMap } from "@/lib/earnings";
import { filterBonusesInRange } from "@/lib/bonuses";
import { PayPeriodView } from "@/components/pay-period/PayPeriodView";

export default async function PayPeriodPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const tz = cookieStore.get("frt_timezone")?.value;
  const today = tz ? isoDateInTz(tz) : isoDate();

  // Fetch entries from the last 3 years — covers any period a user would
  // realistically browse without loading the full unbounded history.
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const fromDate = tz
    ? isoDateInTz(tz, threeYearsAgo)
    : isoDate(threeYearsAgo);

  const [
    settings,
    entries,
    clocks,
    paidList,
    library,
    laborRates,
    photoEntryIds,
    allBonuses,
    { data: userData },
  ] = await Promise.all([
    db.getSettings(supabase),
    db.listEntries(supabase, { from: fromDate }),
    db.listDailyClocks(supabase),
    db.listPaidPeriods(supabase),
    db.listOpCodes(supabase),
    db.listLaborRates(supabase),
    db.listEntryIdsWithPhotos(supabase),
    db.listBonuses(supabase),
    supabase.auth.getUser(),
  ]);

  const firstName =
    (userData.user?.user_metadata?.first_name as string | undefined) ?? "";
  const lastName =
    (userData.user?.user_metadata?.last_name as string | undefined) ?? "";
  const techName = `${firstName} ${lastName}`.trim() || null;

  const current = getPeriodForDate(today, settings.splitDay, settings.periodOverrides);

  // Periods to show in the dropdown: any with entries, paid hours, or an
  // explicit override, plus the current one so new users always see something.
  const keys = new Set<string>([current.key]);
  for (const e of entries) {
    const r = getPeriodForDate(
      e.date,
      settings.splitDay,
      settings.periodOverrides,
    );
    keys.add(r.key);
  }
  for (const p of paidList) keys.add(p.periodKey);
  for (const k of Object.keys(settings.periodOverrides)) keys.add(k);

  const availablePeriods: PeriodRange[] = Array.from(keys)
    .map((key) =>
      getRangeForPeriodKey(key, settings.splitDay, settings.periodOverrides),
    )
    .filter((r): r is PeriodRange => r !== null)
    .sort((a, b) => b.start.localeCompare(a.start));

  const params = await searchParams;
  const selected: PeriodRange =
    (params.period
      ? availablePeriods.find((p) => p.key === params.period)
      : undefined) ?? current;

  const stats = aggregateStats(entries, clocks, {
    start: selected.start,
    end: selected.end,
  });
  const periodEntries = entries.filter(
    (e) => e.date >= selected.start && e.date <= selected.end,
  );
  const paidForSelected =
    paidList.find((p) => p.periodKey === selected.key)?.paidFlagHours ?? null;
  const hasOverride = Boolean(settings.periodOverrides[selected.key]);

  const periodBonuses = filterBonusesInRange(
    allBonuses,
    selected.start,
    selected.end,
  );
  // Seed the "add spiff" date to today when today falls in the viewed period,
  // otherwise to the period's last day so the new spiff lands where it's visible.
  const bonusDefaultDate =
    today >= selected.start && today <= selected.end ? today : selected.end;

  return (
    <PayPeriodView
      availablePeriods={availablePeriods}
      currentKey={current.key}
      selected={selected}
      hasOverride={hasOverride}
      stats={stats}
      paidFlagHours={paidForSelected}
      entries={periodEntries}
      library={library}
      rates={ratesToMap(laborRates)}
      techName={techName}
      entryIdsWithPhotos={new Set(photoEntryIds)}
      bonuses={periodBonuses}
      bonusDefaultDate={bonusDefaultDate}
      clocks={clocks}
      referenceRate={settings.referenceHourlyRate}
    />
  );
}
