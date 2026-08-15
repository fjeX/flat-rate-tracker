"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { formText, validate } from "@/lib/validation/core";
import { roTemplateSchema, templateIdSchema } from "@/lib/validation/actions";

// Upsert one template in the user's template array.
// Accepts FormData so the image upload and DB write happen in the same server
// call — eliminates the orphaned-storage bug from the old split client/server flow.
export async function saveRoTemplateMetadata(formData: FormData): Promise<void> {
  const image = formData.get("image");
  const imageFile = image instanceof File ? image : null;

  // The regions arrive as a JSON string in a form field, so this is the one
  // place in the app where the server parses caller-supplied JSON. A malformed
  // body used to surface as a raw SyntaxError from JSON.parse.
  let regionsRaw: unknown;
  try {
    regionsRaw = JSON.parse(formText(formData, "regions") ?? "");
  } catch {
    throw new Error("Template regions are malformed.");
  }

  const { id, name: rawName, existingStoragePath, regions } = validate(
    roTemplateSchema,
    {
      id: formText(formData, "id") ?? "",
      name: formText(formData, "name") ?? "",
      existingStoragePath: formText(formData, "existingStoragePath"),
      regions: regionsRaw,
    },
  );
  const name = rawName.trim() || "Page 1";

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
  const id = validate(templateIdSchema, templateId);
  const supabase = await createClient();
  const settings = await db.getSettings(supabase);

  const target = settings.roTemplates.find((t) => t.id === id);
  if (target?.imageStoragePath) {
    await supabase.storage
      .from("ro-templates")
      .remove([target.imageStoragePath]);
  }

  const updated = settings.roTemplates.filter((t) => t.id !== id);
  await db.updateSettings(supabase, { roTemplates: updated });

  revalidatePath("/settings");
  revalidatePath("/log");
}
