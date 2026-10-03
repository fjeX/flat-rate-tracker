"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { replyKindFor } from "@/lib/feature-requests";
import type { SubmissionReply } from "@/lib/types";
import { validate } from "@/lib/validation/core";
import { replyIdSchema, sendReplySchema } from "@/lib/validation/actions";

// Admin → submitter. The recipient and the kind are both decided HERE, from the
// submission's saved row, never taken from the client: the reply goes to whoever
// actually sent the report, and it's a "fixed"/"shipped" thank-you only if the
// saved status says so. (The insert policy re-checks the recipient in the DB.)
export async function sendSubmissionReply(
  source: string,
  submissionId: string,
  message: string,
): Promise<SubmissionReply> {
  const clean = validate(sendReplySchema, { source, submissionId, message });
  const supabase = await createClient();
  if (!(await db.isCurrentUserAdmin(supabase))) throw new Error("Not authorized.");

  const table = clean.source === "bug" ? "bug_reports" : "feature_requests";
  const { data: row, error } = await supabase
    .from(table)
    .select("user_id, status")
    .eq("id", clean.submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("That submission no longer exists.");

  const reply = await db.insertSubmissionReply(supabase, {
    recipientId: row.user_id,
    bugReportId: clean.source === "bug" ? clean.submissionId : null,
    featureRequestId: clean.source === "feature" ? clean.submissionId : null,
    kind: replyKindFor(clean.source, row.status),
    message: clean.message,
  });

  revalidatePath(clean.source === "bug" ? "/admin/bugs" : "/admin/requests");
  return reply;
}

// Recipient dismisses the notice. No revalidate: the client already hid it, and
// the next navigation's layout read won't return it.
export async function dismissReplyNotice(replyId: string): Promise<void> {
  const id = validate(replyIdSchema, replyId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  await db.markReplySeen(supabase, id);
}
