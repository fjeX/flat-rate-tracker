"use server";

// Server actions for the unpaid-time ledger.
//
// The ledger could be written three ways (a banked timer hold, resolving an
// empty scheduled day, a manual entry) and read on four surfaces — and until
// now there was no way to REMOVE a row. The only escape hatch was
// clearAllDataAction, which wipes every entry, op code, spiff, dispute and
// clock hour the account owns. That is not a correction tool.
//
// These rows are not a private note to self: they are printed on the dispute
// pack, the document a tech hands a service manager. A wrong row on it costs
// credibility on every other row, so being able to strike one is part of the
// document being trustworthy.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { check } from "@/lib/validation/core";
import { unpaidTimeIdSchema } from "@/lib/validation/actions";

// Every surface that counts unpaid hours. The ledger feeds the pay-period card
// and its dispute pack, the leak board on /insights, and the dashboard's
// unresolved-days card, so a delete that only refreshed one of them would leave
// the other three quoting a total that no longer has a row behind it.
//
// /dashboard is listed EXPLICITLY. Revalidating "/" does not reach it — that is
// a documented FRT trap (memory/reference_frt_stale_state_gotchas.md), and it
// is exactly the kind of miss that reads as "the delete didn't work".
function revalidateUnpaidTimeScreens() {
  revalidatePath("/pay-period");
  revalidatePath("/pay-period/dispute-pack");
  revalidatePath("/insights");
  revalidatePath("/dashboard");
  revalidatePath("/");
}

/**
 * Delete ONE unpaid-time ledger row, by id.
 *
 * RETURNS { error } RATHER THAN THROWING for validation and for "no such row",
 * the same contract paid-periods.ts and entries.ts use: a thrown Error crossing
 * the Server Actions boundary has its message replaced with a generic string
 * plus a digest in a production build, so the real sentence never reaches the
 * tech. DB failures still throw — the caller reports those.
 *
 * Ownership is enforced in db.deleteUnpaidTime's own SQL (`user_id =` the
 * signed-in user) on top of the table's RLS policy, so another account's row
 * matches nothing and comes back as `deleted: false` — the same answer as a row
 * that was already gone. There is no id-list variant and no filter variant on
 * purpose: see the comment on db.deleteUnpaidTime for why an hours-based
 * predicate would destroy real rework.
 */
export async function deleteUnpaidTimeAction(
  id: string,
): Promise<{ error?: string }> {
  const parsed = check(unpaidTimeIdSchema, id);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const deleted = await db.deleteUnpaidTime(supabase, parsed.data);
  if (!deleted) {
    return {
      error:
        "That unpaid-time record is no longer there — it may already have been deleted. Reload the page to see the current list.",
    };
  }

  revalidateUnpaidTimeScreens();
  return {};
}
