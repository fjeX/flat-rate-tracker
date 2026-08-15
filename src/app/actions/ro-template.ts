"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { FieldRegion } from "@/lib/types";

// Upsert one template in the user's template array.
// Accepts FormData so the image upload and DB write happen in the same server
// call — eliminates the orphaned-storage bug from the old split client/server flow.
export async function saveRoTemplateMetadata(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const name = ((formData.get("name") as string | null) ?? "").trim() || "Page 1";
  const imageFile = formData.get("image") as File | null;
  const existingStoragePath = formData.get("existingStoragePath") as string | null;
  const regionsJson = formData.get("regions") as string;

  if (!id) throw new Error("Template ID is required.");
  const regions = JSON.parse(regionsJson) as FieldRegion[];
  if (!Array.isArray(regions) || regions.length === 0)
    throw new Error("At least one region is required.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  // existingStoragePath arrives from the client, and it is handed straight to
  // storage.upload() with upsert:true below — so unchecked it is an offer to
  // overwrite any object in the bucket by naming it. The bucket's RLS policy
  // (own_ro_template_images, folder-scoped to auth.uid()) does refuse it, which
  // is why this was never exploitable. But that leaves the guarantee resting on
  // one policy in one migration, and the bug-photos bucket right next door
  // already carries a cross-user admin read policy — the day someone adds the
  // equivalent here, this line becomes the hole. Two independent checks.
  //
  // Rejecting rather than silently rewriting: a path outside the caller's own
  // folder is not a mistake the server should quietly correct.
  if (existingStoragePath && !existingStoragePath.startsWith(`${user.id}/`)) {
    throw new Error("Invalid template image path.");
  }

  const storagePath = existingStoragePath ?? `${user.id}/template_${id}`;

  if (imageFile && imageFile.size > 0) {
    const { error } = await supabase.storage
      .from("ro-templates")
      .upload(storagePath, imageFile, { upsert: true, contentType: imageFile.type || "image/jpeg" });
    if (error) throw error;
  } else if (!existingStoragePath) {
    throw new Error("Image is required for new templates.");
  }

  const settings = await db.getSettings(supabase);
  const updated = [
    ...settings.roTemplates.filter((t) => t.id !== id),
    { id, name, imageStoragePath: storagePath, regions },
  ];

  await db.updateSettings(supabase, { roTemplates: updated });
  revalidatePath("/settings");
  revalidatePath("/log");
}

// Delete one template by id — removes the storage file and splices it from the array.
export async function deleteRoTemplateAction(templateId: string): Promise<void> {
  const supabase = await createClient();
  const settings = await db.getSettings(supabase);

  const target = settings.roTemplates.find((t) => t.id === templateId);
  if (target?.imageStoragePath) {
    await supabase.storage
      .from("ro-templates")
      .remove([target.imageStoragePath]);
  }

  const updated = settings.roTemplates.filter((t) => t.id !== templateId);
  await db.updateSettings(supabase, { roTemplates: updated });

  revalidatePath("/settings");
  revalidatePath("/log");
}
