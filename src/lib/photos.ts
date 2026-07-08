// Shared constants for the entry-photo (Evidence Locker) feature. Kept out of the
// "use server" action module because that file may only export async functions.

// Per-entry photo cap (RO front + back + a couple of extras). Enforced in the
// server action; surfaced in the UI to disable the attach control at the limit.
export const MAX_PHOTOS_PER_ENTRY = 4;

// Post-compress size ceiling. The client downscales to a ~1.5 MB target; anything
// materially larger means compression didn't run, so the server rejects it.
export const MAX_PHOTO_BYTES = 1_572_864; // 1.5 MB
