import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { isoDate } from "@/lib/periods";
import { HistoryView } from "@/components/history/HistoryView";

export default async function HistoryPage() {
  const supabase = await createClient();
  const [entries, library, settings] = await Promise.all([
    db.listEntries(supabase),
    db.listOpCodes(supabase),
    db.getSettings(supabase),
  ]);

  return (
    <HistoryView
      entries={entries}
      library={library}
      settings={settings}
      today={isoDate()}
    />
  );
}
