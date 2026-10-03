// Data layer for feature requests (Request a Feature). The insert runs as the
// requester; the list/update paths only return data when RLS says the caller
// is_admin — the /admin route guards the UI, this guards the data.
import type { Database } from "@/lib/supabase/database.types";
import type { FeatureRequest } from "@/lib/types";
import { getCurrentUserId, type DbClient, retryOnce } from "./_client";

type FeatureRequestRow = Database["public"]["Tables"]["feature_requests"]["Row"];

function toFeatureRequest(row: FeatureRequestRow): FeatureRequest {
  return {
    id: row.id,
    userId: row.user_id,
    description: row.description,
    pageUrl: row.page_url,
    appBuild: row.app_build,
    status: row.status,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertFeatureRequest(
  supabase: DbClient,
  fields: { description: string; pageUrl: string | null; appBuild: string | null },
): Promise<FeatureRequest> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("feature_requests")
    .insert({
      user_id: userId,
      description: fields.description,
      page_url: fields.pageUrl,
      app_build: fields.appBuild,
    })
    .select()
    .single();
  if (error) throw error;
  return toFeatureRequest(data);
}

// --- Admin-only reads/writes (RLS returns nothing to non-admins) ---------------

// Every request, newest-first. Used by the /admin/requests inbox.
// retryOnce: renders /admin/requests.
export async function listAllFeatureRequests(supabase: DbClient): Promise<FeatureRequest[]> {
  const data = await retryOnce(async () => {
    const { data, error } = await supabase
      .from("feature_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });
  return (data ?? []).map(toFeatureRequest);
}

// Patch status / notes. `updated_at` is bumped explicitly (no DB trigger).
export async function updateFeatureRequestReview(
  supabase: DbClient,
  requestId: string,
  patch: { status?: string; adminNotes?: string | null },
): Promise<FeatureRequest> {
  const row: Database["public"]["Tables"]["feature_requests"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.adminNotes !== undefined) row.admin_notes = patch.adminNotes;

  const { data, error } = await supabase
    .from("feature_requests")
    .update(row)
    .eq("id", requestId)
    .select()
    .single();
  if (error) throw error;
  return toFeatureRequest(data);
}
