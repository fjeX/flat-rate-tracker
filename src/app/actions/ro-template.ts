"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { FieldRegion } from "@/lib/types";

// Upsert one template in the user's template array.
// Called after the client has already uploaded the image to Supabase Storage.
export async function saveRoTemplateMetadata(
  id: string,
  name: string,
  imageStoragePath: string,
  regions: FieldRegion[],
): Promise<void> {
  if (!imageStoragePath) throw new Error("Image storage path is required.");
  if (!Array.isArray(regions) || regions.length === 0)
    throw new Error("At least one region is required.");

  const supabase = await createClient();
  const settings = await db.getSettings(supabase);

  const updated = [
    ...settings.roTemplates.filter((t) => t.id !== id),
    { id, name, imageStoragePath, regions },
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
