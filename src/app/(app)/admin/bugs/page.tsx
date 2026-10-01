import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { BugInbox } from "@/components/admin/BugInbox";

// Admin-only bug inbox. The /admin layout already guarantees the caller is an
// admin; RLS independently scopes listAllBugReports to admins only.
export default async function AdminBugsPage() {
  const supabase = await createClient();
  const reports = await db.listAllBugReports(supabase);

  return (
    <main className="app-main">
      <div className="pagehead">
        <div className="grow">
          <h1>Bug reports</h1>
          <p>User-submitted reports. Triage each one, then work the verified ones into a fix.</p>
        </div>
      </div>
      <BugInbox initialReports={reports} />
    </main>
  );
}
