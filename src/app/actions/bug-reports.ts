"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import {
  MAX_BUG_PHOTOS,
  MAX_BUG_PHOTO_BYTES,
  MAX_BUG_DESCRIPTION_CHARS,
  BUG_SEVERITIES,
  BUG_CATEGORIES,
  BUG_STATUSES,
} from "@/lib/bug-reports";

const BUCKET = "bug-photos";
const SIGNED_URL_TTL_SECONDS = 60;

export type SubmitBugResult = {
  reportId: string;
  photosAttached: number;
  photosFailed: number;
};

// Submit a bug report. FormData carries the description, the silently
// auto-captured client context, and 0..MAX_BUG_PHOTOS already-compressed photos
// (repeated "photo" field). The description is the payload that matters — if a
// screenshot fails to upload we keep the report and report the miss, we don't
// throw the whole thing away.
export async function submitBugReport(
  formData: FormData,
): Promise<SubmitBugResult> {
  const description = (formData.get("description") as string | null)?.trim() ?? "";
  if (!description) throw new Error("Please describe the bug before sending.");
  if (description.length > MAX_BUG_DESCRIPTION_CHARS) {
    throw new Error(
      `Description is too long — keep it under ${MAX_BUG_DESCRIPTION_CHARS} characters.`,
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const report = await db.insertBugReport(supabase, {
    description,
    pageUrl: (formData.get("page_url") as string | null) || null,
    userAgent: (formData.get("user_agent") as string | null) || null,
    viewport: (formData.get("viewport") as string | null) || null,
    appBuild: process.env.NEXT_PUBLIC_APP_BUILD || null,
  });

  const files = formData
    .getAll("photo")
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, MAX_BUG_PHOTOS);

  let photosAttached = 0;
  let photosFailed = 0;
  for (const file of files) {
    if (file.size > MAX_BUG_PHOTO_BYTES) {
      photosFailed++;
      continue;
    }
    const storagePath = `${user.id}/${report.id}/${crypto.randomUUID()}.jpg`;
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, { contentType: "image/jpeg", upsert: false });
    if (uploadErr) {
      photosFailed++;
      continue;
    }
    try {
      await db.insertBugReportPhoto(supabase, report.id, storagePath, file.size);
      photosAttached++;
    } catch {
      // Row insert failed — don't leave an orphaned storage object behind.
      await supabase.storage.from(BUCKET).remove([storagePath]);
      photosFailed++;
    }
  }

  return { reportId: report.id, photosAttached, photosFailed };
}

// Mint a short-lived signed URL for viewing a report screenshot. Admin-only in
// practice — the bug-photos RLS only lets the owner or an admin read the object.
export async function getBugPhotoSignedUrl(storagePath: string): Promise<string> {
  if (!storagePath) throw new Error("Storage path is required.");
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

// --- Admin inbox actions -------------------------------------------------------
// RLS already gates every read/write to admins; these add an explicit check so a
// non-admin call fails fast with a clear message instead of a silent empty result.

async function requireAdmin() {
  const supabase = await createClient();
  const isAdmin = await db.isCurrentUserAdmin(supabase);
  if (!isAdmin) throw new Error("Not authorized.");
  return supabase;
}

// One report's screenshots, each with a freshly-minted signed URL. Called when
// the admin opens a report's detail view.
export async function listBugPhotosWithUrls(
  reportId: string,
): Promise<Array<{ id: string; url: string }>> {
  const supabase = await requireAdmin();
  const photos = await db.listBugReportPhotos(supabase, reportId);
  const withUrls = await Promise.all(
    photos.map(async (p) => {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(p.storagePath, SIGNED_URL_TTL_SECONDS);
      return { id: p.id, url: data?.signedUrl ?? "" };
    }),
  );
  return withUrls.filter((p) => p.url);
}

// Patch a report's triage fields. Values are validated against the allowed
// vocabularies; empty string clears severity/category back to untriaged.
export async function setBugTriage(
  reportId: string,
  patch: {
    severity?: string;
    category?: string;
    status?: string;
    triageNotes?: string;
  },
): Promise<void> {
  if (!reportId) throw new Error("Report id is required.");
  const supabase = await requireAdmin();

  const clean: {
    severity?: string | null;
    category?: string | null;
    status?: string;
    triageNotes?: string | null;
  } = {};

  if (patch.severity !== undefined) {
    if (patch.severity === "") clean.severity = null;
    else if ((BUG_SEVERITIES as readonly string[]).includes(patch.severity))
      clean.severity = patch.severity;
    else throw new Error("Invalid severity.");
  }
  if (patch.category !== undefined) {
    if (patch.category === "") clean.category = null;
    else if ((BUG_CATEGORIES as readonly string[]).includes(patch.category))
      clean.category = patch.category;
    else throw new Error("Invalid category.");
  }
  if (patch.status !== undefined) {
    if (!(BUG_STATUSES as readonly string[]).includes(patch.status))
      throw new Error("Invalid status.");
    clean.status = patch.status;
  }
  if (patch.triageNotes !== undefined) {
    clean.triageNotes = patch.triageNotes.trim() || null;
  }

  await db.updateBugReportTriage(supabase, reportId, clean);
  revalidatePath("/admin/bugs");
}
