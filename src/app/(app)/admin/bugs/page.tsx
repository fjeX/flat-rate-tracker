import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { AdminNav } from "@/components/admin/AdminNav";
import { BugInbox } from "@/components/admin/BugInbox";

// Admin-only bug inbox. The /admin layout already guarantees the caller is an
// admin; RLS independently scopes listAllBugReports to admins only.
export default async function AdminBugsPage() {
  const supabase = await createClient();
  const [reports, replies] = await Promise.all([
    db.listAllBugReports(supabase),
    db.listAllSubmissionReplies(supabase).catch(() => []),
  ]);
  const submitters = await db.getSubmittersSafe(supabase, reports.map((r) => r.userId));

  return (
    <main className="app-main">
      <div className="pagehead">
        <div className="grow">
          <h1>Bug reports</h1>
          <p>User-submitted reports. Triage each one, then work the verified ones into a fix.</p>
        </div>
      </div>
      <AdminNav current="/admin/bugs" />
      <BugInbox
        initialReports={reports}
        submitters={submitters}
        initialReplies={replies.filter((r) => r.bugReportId)}
      />
    </main>
  );
}
