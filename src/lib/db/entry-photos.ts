// Data layer for entry photos (RO ticket evidence). Kept as its own module —
// separate from db/entries.ts — so the photo feature never touches the entry
// line-mapper columns.
import type { Database } from "@/lib/supabase/database.types";
import type { EntryPhoto } from "@/lib/types";
import { getCurrentUserId, type DbClient } from "./_client";

type EntryPhotoRow = Database["public"]["Tables"]["entry_photos"]["Row"];

function toEntryPhoto(row: EntryPhotoRow): EntryPhoto {
  return {
    id: row.id,
    entryId: row.entry_id,
    storagePath: row.storage_path,
    capturedAt: row.captured_at,
    byteSize: row.byte_size,
  };
}

// All photos for one entry, oldest-first (RO front before back).
export async function listEntryPhotos(
  supabase: DbClient,
  entryId: string,
): Promise<EntryPhoto[]> {
  const { data, error } = await supabase
    .from("entry_photos")
    .select("*")
    .eq("entry_id", entryId)
    .order("captured_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toEntryPhoto);
}

// One photo by id (used before deletion to resolve its storage path).
export async function getEntryPhoto(
  supabase: DbClient,
  id: string,
): Promise<EntryPhoto | null> {
  const { data, error } = await supabase
    .from("entry_photos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toEntryPhoto(data) : null;
}

export async function countEntryPhotos(
  supabase: DbClient,
  entryId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("entry_photos")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entryId);
  if (error) throw error;
  return count ?? 0;
}

// Insert one photo row. captured_at + byte_size default server-side / are set here.
export async function insertEntryPhoto(
  supabase: DbClient,
  entryId: string,
  storagePath: string,
  byteSize: number,
): Promise<EntryPhoto> {
  const userId = await getCurrentUserId(supabase);
  const { data, error } = await supabase
    .from("entry_photos")
    .insert({
      user_id: userId,
      entry_id: entryId,
      storage_path: storagePath,
      byte_size: byteSize,
    })
    .select()
    .single();
  if (error) throw error;
  return toEntryPhoto(data);
}

export async function deleteEntryPhotoRow(
  supabase: DbClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("entry_photos").delete().eq("id", id);
  if (error) throw error;
}

// Storage paths for every photo attached to one entry — used to purge storage
// objects before the entry (and its cascading rows) are deleted.
export async function listEntryPhotoPaths(
  supabase: DbClient,
  entryId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("entry_photos")
    .select("storage_path")
    .eq("entry_id", entryId);
  if (error) throw error;
  return (data ?? []).map((r) => r.storage_path);
}

// Distinct entry ids that have at least one photo — powers the camera icon on
// history rows without loading every photo row.
export async function listEntryIdsWithPhotos(
  supabase: DbClient,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("entry_photos")
    .select("entry_id");
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.entry_id))];
}

// Every photo for the current user — metadata only, for the JSON export.
export async function listAllEntryPhotos(
  supabase: DbClient,
): Promise<EntryPhoto[]> {
  const { data, error } = await supabase
    .from("entry_photos")
    .select("*")
    .order("captured_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toEntryPhoto);
}

// All storage paths for the current user — used when wiping all data so the
// storage bucket doesn't retain orphaned objects.
export async function listAllUserPhotoPaths(
  supabase: DbClient,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("entry_photos")
    .select("storage_path");
  if (error) throw error;
  return (data ?? []).map((r) => r.storage_path);
}
