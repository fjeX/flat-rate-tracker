"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { EntryPhoto } from "@/lib/types";
import { MAX_PHOTOS_PER_ENTRY, MAX_PHOTO_BYTES } from "@/lib/photos";

const BUCKET = "ro-photos";

// Short-lived signed URL TTL. Generated on demand, never persisted — the viewer
// re-mints them each time it opens so links can't leak across sessions.
const SIGNED_URL_TTL_SECONDS = 60;

// Upload one already-compressed photo and link it to an entry.
// Path: {user_id}/{entry_id}/{uuid}.jpg
export async function uploadEntryPhoto(
  entryId: string,
  formData: FormData,
): Promise<EntryPhoto> {
  if (!entryId) throw new Error("Entry ID is required.");
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) throw new Error("No photo provided.");
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error("Photo is too large — try again.");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  // Enforce the per-entry cap server-side.
  const existing = await db.countEntryPhotos(supabase, entryId);
  if (existing >= MAX_PHOTOS_PER_ENTRY) {
    throw new Error(`Limit reached — up to ${MAX_PHOTOS_PER_ENTRY} photos per RO.`);
  }

  const storagePath = `${user.id}/${entryId}/${crypto.randomUUID()}.jpg`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: "image/jpeg", upsert: false });
  if (uploadErr) throw uploadErr;

  let photo: EntryPhoto;
  try {
    photo = await db.insertEntryPhoto(supabase, entryId, storagePath, file.size);
  } catch (err) {
    // Row insert failed — don't leave an orphaned storage object behind.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw err;
  }

  revalidatePath("/history");
  revalidatePath("/");
  return photo;
}

export async function listEntryPhotosAction(entryId: string): Promise<EntryPhoto[]> {
  if (!entryId) return [];
  const supabase = await createClient();
  return db.listEntryPhotos(supabase, entryId);
}

// Delete one photo: remove the storage object first (storage does NOT cascade),
// then the DB row.
export async function deleteEntryPhoto(photoId: string): Promise<void> {
  if (!photoId) throw new Error("Photo ID is required.");
  const supabase = await createClient();

  const photo = await db.getEntryPhoto(supabase, photoId);
  if (!photo) return; // already gone

  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .remove([photo.storagePath]);
  if (storageErr) throw storageErr;

  await db.deleteEntryPhotoRow(supabase, photoId);

  revalidatePath("/history");
  revalidatePath("/");
}

// Mint a short-lived signed URL for viewing a photo. Called on open — the result
// is never cached in persistent state.
export async function getPhotoSignedUrl(storagePath: string): Promise<string> {
  if (!storagePath) throw new Error("Storage path is required.");
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

// Purge every storage object attached to an entry. Storage does not cascade on
// row/entry delete, so callers that delete an entry must call this FIRST.
export async function removeEntryPhotoStorage(entryId: string): Promise<void> {
  const supabase = await createClient();
  const paths = await db.listEntryPhotoPaths(supabase, entryId);
  if (paths.length > 0) {
    await supabase.storage.from(BUCKET).remove(paths);
  }
}
