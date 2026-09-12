import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { hasAnyRate, ratesToMap } from "@/lib/earnings";
import { hhmmInTz, isoDate, isoDateInTz } from "@/lib/periods";
import { LogRoForm } from "@/components/forms/LogRoForm";

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; close?: string }>;
}) {
  const { edit, close } = await searchParams;

  const supabase = await createClient();
  const [opCodes, settings, laborRates] = await Promise.all([
    db.listOpCodes(supabase),
    db.getSettings(supabase),
    db.listLaborRates(supabase),
  ]);

  let existingEntry;
  if (edit) {
    const entry = await db.getEntry(supabase, edit);
    if (!entry) notFound();
    existingEntry = entry;
  }

  // Show the per-line labor-type selector only once the user has priced a rate
  // or picked a default — otherwise the form is exactly as it was before.
  const laborTypeEnabled =
    hasAnyRate(ratesToMap(laborRates)) || settings.defaultLaborType !== null;

  // Computed here, not in the client component: a clock read during render must
  // produce the same string on the server and on the hydrating client, and it
  // cannot. Same reason `today` is derived from the timezone cookie server-side
  // everywhere else in the app.
  const cookieStore = await cookies();
  const tz = cookieStore.get("frt_timezone")?.value ?? "";
  const defaultLoggedTime = settings.trackRoTime ? hhmmInTz(tz) : "";
  const today = tz ? isoDateInTz(tz) : isoDate();

  // `?close=1` on an OPEN ticket puts the form in close mode (Open Tickets,
  // Phase 1): the full line editor, the close date defaulting to today, and
  // the actual-hours prefill from the ticket's timeline. On a closed RO the
  // flag is ignored — there is nothing to close.
  const closeMode = Boolean(close) && existingEntry?.status === "open";

  return (
    <LogRoForm
      initialOpCodes={opCodes}
      existingEntry={existingEntry}
      roTemplates={settings.roTemplates}
      defaultLaborType={settings.defaultLaborType}
      laborTypeEnabled={laborTypeEnabled}
      trackRoTime={settings.trackRoTime}
      defaultLoggedTime={defaultLoggedTime}
      timeZone={tz}
      today={today}
      // Signed-in only (decision 12). The guest log page never passes this.
      openTicketEnabled
      closeMode={closeMode}
    />
  );
}
