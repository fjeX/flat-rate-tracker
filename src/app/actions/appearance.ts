"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { reportServerError } from "@/lib/report-error-server";
import { type Accent, type Theme } from "@/lib/theme";
import { check } from "@/lib/validation/core";
import { appearanceSchema } from "@/lib/validation/actions";

// Persist the account's theme + accent.
//
// Returns { error } instead of throwing for every expected refusal (bad value,
// signed out, column not migrated yet). A thrown error from a server action is
// masked in production, so the settings UI would show a generic failure instead
// of the sentence below — see the server-action-thrown-refusals-masked
// escalation.
//
// appearanceSchema builds its enums from THEMES / ACCENTS in src/lib/theme.ts.
export async function saveAppearance({
  theme,
  accent,
}: {
  theme: Theme;
  accent: Accent;
}): Promise<{ error?: string }> {
  const parsed = check(appearanceSchema, { theme, accent });
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  try {
    // updateSettings targets the caller's own row (user id from the session,
    // and RLS own_settings enforces it regardless).
    await db.updateSettings(supabase, parsed.data);
  } catch (err) {
    // Includes a DB that has not run 20260929000000_appearance.sql yet: the
    // browser copy still applies, only the cross-device save is skipped. It is
    // still reported, or an unapplied migration would fail every save unseen —
    // except the missing-column error itself: local dev runs against prod
    // before the VM has migrated, and each of those would land in
    // client_errors, which the nightly health check reads as a live fault.
    // PostgREST throws a plain { message, code } object, not always an Error.
    // Pre-migration it reads "Could not find the 'theme' column of
    // 'user_settings' in the schema cache" (PGRST204).
    const msg = String((err as { message?: unknown })?.message ?? err);
    const preMigration =
      /could not find the '(theme|accent)' column/i.test(msg) ||
      /column [\w.]*\b(theme|accent) does not exist/i.test(msg);
    if (!preMigration) await reportServerError(err, { url: "action:saveAppearance" });
    return { error: "Couldn't save your appearance to your account. Try again." };
  }

  // Settings only: the layout's copy is read once per browser (AppearanceSync),
  // so refetching every route on each radio click would buy nothing.
  revalidatePath("/settings");
  return {};
}
