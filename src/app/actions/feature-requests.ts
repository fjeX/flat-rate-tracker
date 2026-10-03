"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { formText, validate } from "@/lib/validation/core";
import { featureReviewSchema, submitFeatureSchema } from "@/lib/validation/actions";

// Submit a feature request. Unlike a bug report there is nothing to attach and
// no automation to fire: the request is the whole payload, and a human reads it.
export async function submitFeatureRequest(formData: FormData): Promise<{ requestId: string }> {
  const clean = validate(submitFeatureSchema, {
    description: formText(formData, "description") ?? "",
    pageUrl: formText(formData, "page_url"),
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  await enforceRateLimit(
    "feature-submit",
    user.id,
    LIMITS.featureSubmit,
    "You've sent a lot of requests in the last hour — please wait a bit before sending another.",
  );

  const request = await db.insertFeatureRequest(supabase, {
    description: clean.description,
    pageUrl: clean.pageUrl || null,
    // Server-side, never the client's to claim (same rule as bug reports).
    appBuild: process.env.NEXT_PUBLIC_APP_BUILD || null,
  });

  return { requestId: request.id };
}

// --- Admin inbox actions -------------------------------------------------------
// RLS already gates reads/writes to admins; the explicit check makes a non-admin
// call fail fast with a clear message instead of a silent empty result.

export async function setFeatureReview(
  requestId: string,
  patch: { status?: string; adminNotes?: string },
): Promise<void> {
  const parsed = validate(featureReviewSchema, { requestId, patch });
  const supabase = await createClient();
  if (!(await db.isCurrentUserAdmin(supabase))) throw new Error("Not authorized.");

  await db.updateFeatureRequestReview(supabase, parsed.requestId, {
    status: parsed.patch.status,
    adminNotes:
      parsed.patch.adminNotes === undefined ? undefined : parsed.patch.adminNotes.trim() || null,
  });

  revalidatePath("/admin/requests");
}
