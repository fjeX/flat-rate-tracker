import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { BugInbox } from "@/components/admin/BugInbox";

// Admin-only bug inbox. The /admin layout already guarantees the caller is an
// admin; RLS independently scopes listAllBugReports to admins only.
export default async function AdminBugsPage() {
  const supabase = await createClient();
  const reports = await db.listAllBugReports(supabase);

  return (
    <main className="app-main" style={{ paddingBottom: 64 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="section-title" style={{ marginBottom: 4 }}>
          Bug reports
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--fg-2)" }}>
          User-submitted reports. Triage each one, then work the verified ones into a fix.
        </p>
      </div>
      <BugInbox initialReports={reports} />
    </main>
  );
}
