// Barrel re-export for the data layer.
//
// Usage from a Server Component:
//   import { createClient } from "@/lib/supabase/server";
//   import * as db from "@/lib/db";
//   const supabase = await createClient();
//   const entries = await db.listEntries(supabase);

export * from "./_client";
export * from "./entries";
export * from "./entry-photos";
export * from "./bonuses";
export * from "./op-codes";
export * from "./labor-rates";
export * from "./settings";
export * from "./daily-clock";
export * from "./paid-periods";
export * from "./gamification";
