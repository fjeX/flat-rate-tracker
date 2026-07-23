// Data layer for bug reports (Report a Bug). Insert paths run as the reporter;
// the read/triage paths (listAllBugReports, updateBugReportTriage) only return
// data when RLS says the caller is_admin — the /admin route guards the UI, this
// guards the data.
import type { Database } from "@/lib/supabase/database.types";
import type { BugReport, BugReportPhoto } from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";

type BugReportRow = Database["public"]["Tables"]["bug_reports"]["Row"];
type BugReportPhotoRow = Database["public"]["Tables"]["bug_report_photos"]["Row"];

function toBugReport(row: BugReportRow): BugReport {
  return {
    id: row.id,
    userId: row.user_id,
    description: row.description,
    pageUrl: row.page_url,
    userAgent: row.user_agent,
    viewport: row.viewport,
    appBuild: row.app_build,
    severity: row.severity,
    category: row.category,
    status: row.status,
    triageNotes: row.triage_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBugReportPhoto(row: BugReportPhotoRow): BugReportPhoto {
  return {
    id: row.id,
    reportId: row.report_id,
    storagePath: row.storage_path,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

// Insert a new report and return it (needs .select() so the caller gets the id
// to build photo storage paths — own_read_bug_reports RLS permits reading it back).
export async function insertBugReport(
  supabase: DbClient,
  fields: {
    description: string;
    pageUrl: string | null;
    userAgent: string | null;
    viewport: string | null;
    appBuild: string | null;
  },
): Promise<BugReport> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("bug_reports")
    .insert({
      user_id: userId,
      description: fields.description,
      page_url: fields.pageUrl,
      user_agent: fields.userAgent,
      viewport: fields.viewport,
      app_build: fields.appBuild,
    })
    .select()
    .single();
  if (error) throw error;
  return toBugReport(data);
}

export async function insertBugReportPhoto(
  supabase: DbClient,
  reportId: string,
  storagePath: string,
  byteSize: number,
): Promise<BugReportPhoto> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("bug_report_photos")
    .insert({
      user_id: userId,
      report_id: reportId,
      storage_path: storagePath,
      byte_size: byteSize,
    })
    .select()
    .single();
  if (error) throw error;
  return toBugReportPhoto(data);
}

// --- Admin-only reads/writes (RLS returns nothing to non-admins) ---------------

// Every report, newest-first. Used by the /admin/bugs inbox.
export async function listAllBugReports(supabase: DbClient): Promise<BugReport[]> {
  const { data, error } = await supabase
    .from("bug_reports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toBugReport);
}

export async function listBugReportPhotos(
  supabase: DbClient,
  reportId: string,
): Promise<BugReportPhoto[]> {
  const { data, error } = await supabase
    .from("bug_report_photos")
    .select("*")
    .eq("report_id", reportId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toBugReportPhoto);
}

// Patch triage fields. `updated_at` is bumped explicitly (no DB trigger).
export async function updateBugReportTriage(
  supabase: DbClient,
  reportId: string,
  patch: {
    severity?: string | null;
    category?: string | null;
    status?: string;
    triageNotes?: string | null;
  },
): Promise<BugReport> {
  const row: Database["public"]["Tables"]["bug_reports"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.severity !== undefined) row.severity = patch.severity;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.triageNotes !== undefined) row.triage_notes = patch.triageNotes;

  const { data, error } = await supabase
    .from("bug_reports")
    .update(row)
    .eq("id", reportId)
    .select()
    .single();
  if (error) throw error;
  return toBugReport(data);
}

// Is the current user an admin? Reads their own user_settings row.
//
// Fails CLOSED: any error (not signed in, or — during the migration lag where
// code can be deployed before the is_admin column exists — a missing-column
// error) resolves to `false`. An admin gate must never fault a user *into*
// admin, and this keeps the app rendering before the migration is applied.
export async function isCurrentUserAdmin(supabase: DbClient): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("user_settings")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return false;
  return data?.is_admin ?? false;
}
