// uploadEntryPhoto — server-action-thrown-refusals-masked (2026-10-01).
//
// A production build masks the message of any error thrown out of a Server
// Action, so "Photo is too large", "Only image files…", the per-RO cap and the
// rate-limit sentence must come back as `{ error }` DATA. A storage/DB failure
// and the auth guard must still throw.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_ENTRY } from "@/lib/photos";

const revalidatePath = vi.fn();
const countEntryPhotos = vi.fn();
const insertEntryPhoto = vi.fn();
const enforceRateLimit = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
let user: { id: string } | null = { id: "user-1" };

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    storage: { from: () => ({ upload, remove }) },
  }),
}));
vi.mock("@/lib/db", () => ({
  countEntryPhotos: (...args: unknown[]) => countEntryPhotos(...args),
  insertEntryPhoto: (...args: unknown[]) => insertEntryPhoto(...args),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args),
}));

const { uploadEntryPhoto } = await import("./entry-photos");
const { RateLimitError } = await import("@/lib/rate-limit");

const ENTRY = "eeeeeeee-0000-4000-8000-000000000001";

function form(file: File | string | null): FormData {
  const fd = new FormData();
  if (file !== null) fd.append("photo", file);
  return fd;
}

function jpeg(bytes = 10, type = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], "ro.jpg", { type });
}

beforeEach(() => {
  user = { id: "user-1" };
  revalidatePath.mockReset();
  countEntryPhotos.mockReset().mockResolvedValue(0);
  insertEntryPhoto.mockReset().mockResolvedValue({ id: "p1" });
  enforceRateLimit.mockReset().mockResolvedValue(undefined);
  upload.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
});

describe("uploadEntryPhoto — refusals come back as data", () => {
  it("returns the photo on success", async () => {
    await expect(uploadEntryPhoto(ENTRY, form(jpeg()))).resolves.toEqual({ id: "p1" });
  });

  it("refuses a missing photo, an oversized one, and a non-image", async () => {
    await expect(uploadEntryPhoto(ENTRY, form(null))).resolves.toEqual({
      error: "No photo provided.",
    });
    await expect(
      uploadEntryPhoto(ENTRY, form(jpeg(MAX_PHOTO_BYTES + 1))),
    ).resolves.toEqual({ error: "Photo is too large — try again." });
    await expect(
      uploadEntryPhoto(ENTRY, form(jpeg(10, "application/pdf"))),
    ).resolves.toEqual({ error: "Only image files can be attached to an RO." });
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses at the per-RO cap", async () => {
    countEntryPhotos.mockResolvedValue(MAX_PHOTOS_PER_ENTRY);
    await expect(uploadEntryPhoto(ENTRY, form(jpeg()))).resolves.toEqual({
      error: `Limit reached — up to ${MAX_PHOTOS_PER_ENTRY} photos per RO.`,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns the rate-limit sentence instead of throwing it", async () => {
    enforceRateLimit.mockRejectedValue(
      new RateLimitError("Too many photo uploads in a short time — please wait a few minutes.", 60),
    );
    await expect(uploadEntryPhoto(ENTRY, form(jpeg()))).resolves.toEqual({
      error: "Too many photo uploads in a short time — please wait a few minutes.",
    });
  });

  it("a validation sentence (bad entry id) is returned too", async () => {
    const res = await uploadEntryPhoto("nope", form(jpeg()));
    expect(typeof (res as { error?: string }).error).toBe("string");
  });

  it("a real failure, and the auth guard, still throw", async () => {
    upload.mockResolvedValue({ error: new Error("storage down") });
    await expect(uploadEntryPhoto(ENTRY, form(jpeg()))).rejects.toThrow("storage down");

    user = null;
    await expect(uploadEntryPhoto(ENTRY, form(jpeg()))).rejects.toThrow("Not authenticated.");
  });
});
