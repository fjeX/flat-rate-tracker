import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { AdminNav } from "@/components/admin/AdminNav";
import { FeatureInbox } from "@/components/admin/FeatureInbox";

// Admin-only feature request inbox. The /admin layout already guarantees the
// caller is an admin; RLS independently scopes listAllFeatureRequests to admins.
export default async function AdminRequestsPage() {
  const supabase = await createClient();
  const [requests, replies] = await Promise.all([
    db.listAllFeatureRequests(supabase),
    db.listAllSubmissionReplies(supabase).catch(() => []),
  ]);
  const submitters = await db.getSubmittersSafe(supabase, requests.map((r) => r.userId));

  return (
    <main className="app-main">
      <div className="pagehead">
        <div className="grow">
          <h1>Feature requests</h1>
          <p>What techs wish the app did. Read each one, give it a status, and keep notes on the ones worth building.</p>
        </div>
      </div>
      <AdminNav current="/admin/requests" />
      <FeatureInbox
        initialRequests={requests}
        submitters={submitters}
        initialReplies={replies.filter((r) => r.featureRequestId)}
      />
    </main>
  );
}
