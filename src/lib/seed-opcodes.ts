// Seeds the starter op code library for a brand-new account.
//
// Shared by both sign-up paths:
//   - email/password sign-up (src/app/actions/auth.ts)
//   - Google OAuth callback   (src/app/auth/callback/route.ts)
//
// Idempotent: only seeds when the user's library is empty, so it is safe to
// call on every OAuth callback (which fires on every Google login, not just
// the first one).
import * as db from "@/lib/db";
import { STARTER_OP_CODES } from "@/lib/starter-opcodes";
import type { DbClient } from "@/lib/db/_client";

export async function seedStarterOpCodesIfEmpty(supabase: DbClient): Promise<void> {
  // Cheap existence check — head request returns the count without rows.
  // RLS scopes this to the current user, so count > 0 means "already seeded".
  const { count, error } = await supabase
    .from("op_codes")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  if ((count ?? 0) > 0) return;

  for (const starter of STARTER_OP_CODES) {
    await db.createOpCode(supabase, {
      code: starter.code,
      description: starter.description,
      flagHours: starter.flagHours,
      notes: "",
    });
  }
}
