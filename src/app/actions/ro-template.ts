"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { FieldRegion } from "@/lib/types";

// Called after the client has already uploaded the image to Supabase Storage.
// Just saves the metadata (storage path + region coordinates) to user_settings.
export async function saveRoTemplateMetadata(
  imageStoragePath: string,
  regions: FieldRegion[],
): Promise<void> {
  if (!imageStoragePath) throw new Error("Image storage path is required.");
  if (!Array.isArray(regions) || regions.length === 0)
    throw new Error("At least one region is required.");

  const supabase = await createClient();
  await db.updateSettings(supabase, {
    roTemplate: { imageStoragePath, regions },
  });

  revalidatePath("/settings");
  revalidatePath("/log");
}

// Removes the template: deletes the storage file and clears the DB column.
export async function deleteRoTemplateAction(): Promise<void> {
  const supabase = await createClient();
  const settings = await db.getSettings(supabase);

  if (settings.roTemplate?.imageStoragePath) {
    await supabase.storage
      .from("ro-templates")
      .remove([settings.roTemplate.imageStoragePath]);
  }

  await db.updateSettings(supabase, { roTemplate: null });

  revalidatePath("/settings");
  revalidatePath("/log");
}
