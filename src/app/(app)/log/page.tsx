import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { hasAnyRate, ratesToMap } from "@/lib/earnings";
import { LogRoForm } from "@/components/forms/LogRoForm";

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;

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

  return (
    <LogRoForm
      initialOpCodes={opCodes}
      existingEntry={existingEntry}
      roTemplates={settings.roTemplates}
      defaultLaborType={settings.defaultLaborType}
      laborTypeEnabled={laborTypeEnabled}
    />
  );
}
