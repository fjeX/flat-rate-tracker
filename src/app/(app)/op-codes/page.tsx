import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { OpCodesView } from "@/components/op-codes/OpCodesView";

export default async function OpCodesPage() {
  const supabase = await createClient();
  const [library, settings] = await Promise.all([
    db.listOpCodes(supabase),
    db.getSettings(supabase),
  ]);

  return <OpCodesView library={library} tagColors={settings.tagColors} />;
}
