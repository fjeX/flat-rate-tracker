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
import { aggregateStats, aggregateStatsWithSchedule } from "@/lib/stats";
import { computeForecast } from "@/lib/forecast";
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
  // Null while the work_schedules migration hasn't been applied —
  // efficiency falls back to clocked-hours-only.
  const [schedules, daysOff, confirmedZeroDays, shiftOverrides, unpaidTime] =
    await Promise.all([
      db.listWorkSchedulesSafe(supabase),
      db.listDaysOffSafe(supabase),
      db.listConfirmedZeroDaysSafe(supabase),
      db.listShiftOverridesSafe(supabase),
      // Null until the Phase 2 migration lands — stats then report zero
      // unpaid hours instead of the page failing.
      db.listUnpaidTimeSafe(supabase, { from: fromDate }),
    ]);
  const unpaid = unpaidTime ?? [];

  // Null until the dispute-ledger migration lands. Deliberately NOT coerced to
  // [] — the card must be able to tell "not migrated" (hide entirely, because
  // its actions would throw) from "migrated, nothing disputed yet" (show the
  // offer). Not date-filtered: lifetime recovery spans every period.
  const disputes = await db.listDisputesSafe(supabase);

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

  // Schedule-aware efficiency once a schedule exists (clocked hours still
  // win per day); plain clocked-hours efficiency otherwise.
  const stats =
    schedules !== null && schedules.length > 0
      ? aggregateStatsWithSchedule(
          entries,
          clocks,
          { start: selected.start, end: selected.end },
          {
            schedules,
            daysOff: daysOff ?? [],
            confirmedZeroDays: confirmedZeroDays ?? [],
            today,
            shiftOverrides: shiftOverrides ?? {},
          },
          unpaid,
        )
      : aggregateStats(
          entries,
          clocks,
          { start: selected.start, end: selected.end },
          unpaid,
        );
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

  // Forward projection for the in-progress hero ("on this pace you land at…").
  // Only computed for a period that is actually still running — projecting a
  // closed period has no meaning, and computeForecast's day-remaining maths
  // assumes today falls inside the range. Derived from entries already loaded
  // above; no extra fetch.
  const goalHours = settings.goalHours ?? 0;
  const forecast =
    selected.end >= today && goalHours > 0
      ? computeForecast(entries, {
          today,
          periodEnd: selected.end,
          current: stats.flagHours,
          goal: goalHours,
        })
      : null;

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
      unpaid={unpaid}
      disputes={disputes}
      openDispute={
        (disputes ?? []).find(
          (d) =>
            d.periodKey === selected.key &&
            d.status !== "resolved" &&
            d.status !== "withdrawn",
        ) ?? null
      }
      today={today}
      goalHours={goalHours}
      forecast={forecast}
      schedule={{
        // Same context the efficiency denominator uses, so the effective-hourly
        // figure and the efficiency figure can never disagree about which hours
        // a day was worked.
        //
        // Passed even when no schedule exists (empty array): `today` is what
        // lets an in-progress shift be excluded rather than flagged as missing
        // data, and that matters to every user, schedule or not.
        schedules: schedules ?? [],
        daysOff: daysOff ?? [],
        today,
        shiftOverrides: shiftOverrides ?? {},
      }}
    />
  );
}
