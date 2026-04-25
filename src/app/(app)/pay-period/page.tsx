import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import {
  getPeriodForDate,
  getRangeForPeriodKey,
  isoDate,
  type PeriodRange,
} from "@/lib/periods";
import { aggregateStats } from "@/lib/stats";
import { PayPeriodView } from "@/components/pay-period/PayPeriodView";

export default async function PayPeriodPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const supabase = await createClient();
  const today = isoDate();

  const [settings, entries, clocks, paidList, library] = await Promise.all([
    db.getSettings(supabase),
    db.listEntries(supabase),
    db.listDailyClocks(supabase),
    db.listPaidPeriods(supabase),
    db.listOpCodes(supabase),
  ]);

  const current = getPeriodForDate(
    today,
    settings.splitDay,
    settings.periodOverrides,
  );

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
    />
  );
}
