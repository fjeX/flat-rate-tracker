import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import {
  getRangeForPeriodKey,
  getPeriodForDate,
  formatPeriodLabel,
  formatDateLong,
  isoDate,
  isoDateInTz,
} from "@/lib/periods";
import { ratesToMap } from "@/lib/earnings";
import { buildDisputePack } from "@/lib/dispute-pack";
import { DisputePackPrint } from "@/components/pay-period/DisputePackPrint";

// Dedicated print view for the dispute pack. Lives OUTSIDE the (app) route
// group on purpose, so it renders without the app header/nav/timer chrome —
// one clean page for window.print() → PDF. Auth is enforced here directly
// since it doesn't inherit the (app) layout's guard.
export default async function DisputePackPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; pending?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const cookieStore = await cookies();
  const tz = cookieStore.get("frt_timezone")?.value;
  const today = tz ? isoDateInTz(tz) : isoDate();

  const params = await searchParams;
  const includePending = params.pending === "1";

  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const fromDate = tz ? isoDateInTz(tz, threeYearsAgo) : isoDate(threeYearsAgo);

  const [settings, entries, library, laborRates, photoEntryIds] =
    await Promise.all([
      db.getSettings(supabase),
      db.listEntries(supabase, { from: fromDate }),
      db.listOpCodes(supabase),
      db.listLaborRates(supabase),
      db.listEntryIdsWithPhotos(supabase),
    ]);

  const selected =
    (params.period
      ? getRangeForPeriodKey(
          params.period,
          settings.splitDay,
          settings.periodOverrides,
        )
      : null) ?? getPeriodForDate(today, settings.splitDay, settings.periodOverrides);

  const periodEntries = entries.filter(
    (e) => e.date >= selected.start && e.date <= selected.end,
  );

  const firstName = (user.user_metadata?.first_name as string | undefined) ?? "";
  const lastName = (user.user_metadata?.last_name as string | undefined) ?? "";
  const techName = `${firstName} ${lastName}`.trim() || null;

  const pack = buildDisputePack({
    entries: periodEntries,
    periodLabel: formatPeriodLabel(selected),
    library,
    rates: ratesToMap(laborRates),
    includePending,
    periodEnd: selected.end,
    today,
    techName,
    generatedDate: formatDateLong(today),
    entryIdsWithPhotos: new Set(photoEntryIds),
  });

  return <DisputePackPrint pack={pack} />;
}
