// Data layer for admin replies to bug reports / feature requests, and the
// admin-only "who sent this" lookup. RLS: recipients read their own replies and
// may only touch seen_at; admins insert (to the true submitter only) and read all.
import type { Database } from "@/lib/supabase/database.types";
import type { ReplyNotice, SubmissionReply, Submitter } from "@/lib/types";
import type { ReplyKind } from "@/lib/feature-requests";
import { getCurrentUserId, type DbClient, retryOnce } from "./_client";

type ReplyRow = Database["public"]["Tables"]["submission_replies"]["Row"];

function toReply(row: ReplyRow): SubmissionReply {
  return {
    id: row.id,
    userId: row.user_id,
    bugReportId: row.bug_report_id,
    featureRequestId: row.feature_request_id,
    kind: row.kind as SubmissionReply["kind"],
    message: row.message,
    createdAt: row.created_at,
    seenAt: row.seen_at,
  };
}

export async function insertSubmissionReply(
  supabase: DbClient,
  fields: {
    recipientId: string;
    bugReportId: string | null;
    featureRequestId: string | null;
    kind: ReplyKind;
    message: string;
  },
): Promise<SubmissionReply> {
  const { data, error } = await supabase
    .from("submission_replies")
    .insert({
      user_id: fields.recipientId,
      bug_report_id: fields.bugReportId,
      feature_request_id: fields.featureRequestId,
      kind: fields.kind,
      message: fields.message,
    })
    .select()
    .single();
  if (error) throw error;
  return toReply(data);
}

// Every reply, oldest-first, for the admin inboxes' "sent / seen" history.
// retryOnce: renders /admin/bugs and /admin/requests.
export async function listAllSubmissionReplies(supabase: DbClient): Promise<SubmissionReply[]> {
  const data = await retryOnce(async () => {
    const { data, error } = await supabase
      .from("submission_replies")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  });
  return (data ?? []).map(toReply);
}

/**
 * The signed-in user's undismissed replies, oldest first, each with a snippet
 * of what they originally sent. Runs on EVERY authenticated render (the (app)
 * layout), so it never throws: a notice that can't load is a notice shown
 * next time, never a crashed page — and before the migration lands the table
 * doesn't exist at all.
 */
export async function listUnseenRepliesSafe(supabase: DbClient): Promise<ReplyNotice[]> {
  try {
    const userId = await getCurrentUserId(supabase);
    const rows = await retryOnce(async () => {
      const { data, error } = await supabase
        .from("submission_replies")
        .select("*")
        .eq("user_id", userId)
        .is("seen_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    });
    if (rows.length === 0) return [];
    const replies = rows.map(toReply);

    const bugIds = replies.map((r) => r.bugReportId).filter((id): id is string => !!id);
    const featureIds = replies.map((r) => r.featureRequestId).filter((id): id is string => !!id);
    const [bugs, features] = await Promise.all([
      bugIds.length
        ? supabase.from("bug_reports").select("id, description").in("id", bugIds)
        : Promise.resolve({ data: [] as { id: string; description: string }[] }),
      featureIds.length
        ? supabase.from("feature_requests").select("id, description").in("id", featureIds)
        : Promise.resolve({ data: [] as { id: string; description: string }[] }),
    ]);
    const text = new Map<string, string>();
    for (const row of [...(bugs.data ?? []), ...(features.data ?? [])]) {
      text.set(row.id, row.description);
    }

    return replies.map((r) => ({
      ...r,
      originalText: text.get(r.bugReportId ?? r.featureRequestId ?? "") ?? null,
    }));
  } catch {
    return [];
  }
}

// Recipient dismisses a notice. The column grant means seen_at is the only
// thing this role can write on the row, and RLS means only on their own.
export async function markReplySeen(supabase: DbClient, replyId: string): Promise<void> {
  const { error } = await supabase
    .from("submission_replies")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", replyId);
  if (error) throw error;
}

/**
 * Names + emails for a set of submitters, keyed by user id. Admin-only (the
 * function raises for anyone else). Never throws: an inbox that can't say who
 * sent something should still list what they sent.
 */
export async function getSubmittersSafe(
  supabase: DbClient,
  userIds: string[],
): Promise<Record<string, Submitter>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return {};
  try {
    const data = await retryOnce(async () => {
      const { data, error } = await supabase.rpc("admin_submitter_profiles", {
        p_user_ids: unique,
      });
      if (error) throw error;
      return data;
    });
    const out: Record<string, Submitter> = {};
    for (const row of data ?? []) {
      out[row.user_id] = {
        userId: row.user_id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
      };
    }
    return out;
  } catch {
    return {};
  }
}
