"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { EntryPhoto } from "@/lib/types";
import { MAX_PHOTOS_PER_ENTRY, MAX_PHOTO_BYTES } from "@/lib/photos";
import { validate } from "@/lib/validation/core";
import {
  entryIdSchema,
  photoIdSchema,
  photoStoragePathSchema,
} from "@/lib/validation/actions";

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
  const id = validate(entryIdSchema, entryId);
  const photo0 = formData.get("photo");
  // `formData.get` returns `File | string | null`, so a caller can send a plain
  // string here — the old cast made that a File as far as the compiler knew,
  // and it reached storage.upload() as one.
  const file = photo0 instanceof File ? photo0 : null;
  if (!file || file.size === 0) throw new Error("No photo provided.");
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error("Photo is too large — try again.");
  }
  // Uploaded with contentType image/jpeg regardless of what arrives, so a file
  // that announces itself as something else is announcing a mismatch. An empty
  // type is still allowed: some clients send nothing at all.
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Only image files can be attached to an RO.");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  // Enforce the per-entry cap server-side.
  const existing = await db.countEntryPhotos(supabase, id);
  if (existing >= MAX_PHOTOS_PER_ENTRY) {
    throw new Error(`Limit reached — up to ${MAX_PHOTOS_PER_ENTRY} photos per RO.`);
  }

  const storagePath = `${user.id}/${id}/${crypto.randomUUID()}.jpg`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: "image/jpeg", upsert: false });
  if (uploadErr) throw uploadErr;

  let photo: EntryPhoto;
  try {
    photo = await db.insertEntryPhoto(supabase, id, storagePath, file.size);
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
  const id = validate(entryIdSchema, entryId);
  const supabase = await createClient();
  return db.listEntryPhotos(supabase, id);
}

// Delete one photo: remove the storage object first (storage does NOT cascade),
// then the DB row.
export async function deleteEntryPhoto(photoId: string): Promise<void> {
  const id = validate(photoIdSchema, photoId);
  const supabase = await createClient();

  const photo = await db.getEntryPhoto(supabase, id);
  if (!photo) return; // already gone

  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .remove([photo.storagePath]);
  if (storageErr) throw storageErr;

  await db.deleteEntryPhotoRow(supabase, id);

  revalidatePath("/history");
  revalidatePath("/");
}

// Mint a short-lived signed URL for viewing a photo. Called on open — the result
// is never cached in persistent state.
//
// Every exported function in a "use server" module is a public endpoint: any
// signed-in caller can invoke this with any string, not just the paths the UI
// happens to pass. Storage RLS (own_ro_photos, folder-scoped to auth.uid())
// already refuses to sign someone else's object, so this was never exploitable
// — but "safe because one policy in one migration says so" is a thinner
// guarantee than it looks, and signing a URL is precisely the operation that
// converts a path into readable bytes.
//
// Paths are {user_id}/{entry_id}/{uuid}.jpg, so the owner is the first segment.
export async function getPhotoSignedUrl(storagePath: string): Promise<string> {
  const path = validate(photoStoragePathSchema, storagePath);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  if (!path.startsWith(`${user.id}/`)) {
    throw new Error("Not authorized to view that photo.");
  }
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

// Purge every storage object attached to an entry. Storage does not cascade on
// row/entry delete, so callers that delete an entry must call this FIRST.
export async function removeEntryPhotoStorage(entryId: string): Promise<void> {
  const id = validate(entryIdSchema, entryId);
  const supabase = await createClient();
  const paths = await db.listEntryPhotoPaths(supabase, id);
  if (paths.length > 0) {
    await supabase.storage.from(BUCKET).remove(paths);
  }
}
