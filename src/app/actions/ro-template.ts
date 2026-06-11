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
