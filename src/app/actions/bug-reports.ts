"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { MAX_BUG_PHOTOS, MAX_BUG_PHOTO_BYTES } from "@/lib/bug-reports";
import { formText, validate } from "@/lib/validation/core";
import {
  bugTriageSchema,
  reportIdSchema,
  submitBugSchema,
} from "@/lib/validation/actions";

const BUCKET = "bug-photos";
const SIGNED_URL_TTL_SECONDS = 60;

// Fire a bug-automation webhook (n8n → SSH → headless Claude). Best-effort and
// fire-and-forget: the relevant DB write already happened, so a webhook failure
// never surfaces to the caller. Both the triage (on submit) and investigate (on
// Verify) hooks share one secret and this one poster.
async function fireBugWebhook(url: string | undefined, reportId: string): Promise<void> {
  const secret = process.env.BUG_TRIAGE_WEBHOOK_SECRET;
  if (!url || !secret) return; // automation not configured — skip silently
  try {
    await fetch(url, {
      method: "POST",
      // Explicit UA: the n8n instance sits behind Cloudflare, which rejects
      // some default/empty user-agents.
      headers: { "content-type": "application/json", "user-agent": "FRT-BugBot/1.0" },
      body: JSON.stringify({ reportId, secret }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // swallow — automation is fire-and-forget
  }
}

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
  const clean = validate(submitBugSchema, {
    description: formText(formData, "description") ?? "",
    pageUrl: formText(formData, "page_url"),
    userAgent: formText(formData, "user_agent"),
    viewport: formText(formData, "viewport"),
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const report = await db.insertBugReport(supabase, {
    description: clean.description,
    pageUrl: clean.pageUrl || null,
    userAgent: clean.userAgent || null,
    viewport: clean.viewport || null,
    // Server-side, never the client's to claim: which build a report came from
    // is evidence, and evidence a caller can set is not evidence.
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

  await fireBugWebhook(process.env.BUG_TRIAGE_WEBHOOK_URL, report.id);

  return { reportId: report.id, photosAttached, photosFailed };
}

// REMOVED: getBugPhotoSignedUrl(storagePath).
//
// It signed an arbitrary caller-supplied path in the bug-photos bucket and had
// NO callers — the inbox reads screenshots through listBugPhotosWithUrls below,
// which is behind requireAdmin(). Being unused did not make it harmless: every
// export from a "use server" module is a live endpoint, so it stayed reachable
// by any signed-in caller with any string.
//
// It is deleted rather than fixed because a guard would have to be written
// around a question nothing asks. This bucket is also the one with a cross-user
// admin read policy (admin_read_bug_photos), so an unguarded signer here is the
// single worst place in the app for one to sit. If a per-reporter view of their
// own screenshots is ever built, it needs its own action with its own ownership
// check — not this one restored.

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
  const id = validate(reportIdSchema, reportId);
  const supabase = await requireAdmin();
  const photos = await db.listBugReportPhotos(supabase, id);
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
  const parsed = validate(bugTriageSchema, { reportId, patch });
  const supabase = await requireAdmin();

  // "" is the clear-it answer for the two nullable axes; the schema has already
  // refused anything that is neither "" nor a member of the vocabulary.
  const clean: {
    severity?: string | null;
    category?: string | null;
    status?: string;
    triageNotes?: string | null;
  } = {};

  if (parsed.patch.severity !== undefined) {
    clean.severity = parsed.patch.severity || null;
  }
  if (parsed.patch.category !== undefined) {
    clean.category = parsed.patch.category || null;
  }
  if (parsed.patch.status !== undefined) {
    clean.status = parsed.patch.status;
  }
  if (parsed.patch.triageNotes !== undefined) {
    clean.triageNotes = parsed.patch.triageNotes.trim() || null;
  }

  await db.updateBugReportTriage(supabase, parsed.reportId, clean);

  // Marking a report "Verify" kicks off auto-investigation: headless Claude
  // drafts a fix on a branch for review (fire-and-forget).
  if (clean.status === "Verify") {
    await fireBugWebhook(process.env.BUG_INVESTIGATE_WEBHOOK_URL, parsed.reportId);
  }

  revalidatePath("/admin/bugs");
}
