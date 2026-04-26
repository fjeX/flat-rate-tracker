import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { LogRoForm } from "@/components/forms/LogRoForm";

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;

  const supabase = await createClient();
  const [opCodes, settings] = await Promise.all([
    db.listOpCodes(supabase),
    db.getSettings(supabase),
  ]);

  let existingEntry;
  if (edit) {
    const entry = await db.getEntry(supabase, edit);
    if (!entry) notFound();
    existingEntry = entry;
  }

  return (
    <LogRoForm
      initialOpCodes={opCodes}
      existingEntry={existingEntry}
      roTemplates={settings.roTemplates}
    />
  );
}
