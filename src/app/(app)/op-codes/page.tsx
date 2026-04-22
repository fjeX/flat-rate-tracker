import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { OpCodesView } from "@/components/op-codes/OpCodesView";

export default async function OpCodesPage() {
  const supabase = await createClient();
  const library = await db.listOpCodes(supabase);

  return <OpCodesView library={library} />;
}
