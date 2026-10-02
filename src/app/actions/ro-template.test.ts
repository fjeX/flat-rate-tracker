// saveRoTemplateMetadata: refusals come back as { error }; faults still throw.
import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
const getSettings = vi.fn();
const updateSettings = vi.fn();
const upload = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a) }) },
  }),
}));
vi.mock("@/lib/db", () => ({
  getSettings: (...a: unknown[]) => getSettings(...a),
  updateSettings: (...a: unknown[]) => updateSettings(...a),
}));

const { saveRoTemplateMetadata } = await import("./ro-template");
const REGIONS = JSON.stringify([{ field: "roNumber", x: 1, y: 2, width: 30, height: 10 }]);

function form(fields: Record<string, string>, image?: File): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (image) fd.append("image", image);
  return fd;
}

beforeEach(() => {
  revalidatePath.mockReset();
  getSettings.mockReset().mockResolvedValue({ roTemplates: [] });
  updateSettings.mockReset().mockResolvedValue(undefined);
  upload.mockReset().mockResolvedValue({ error: null });
});

describe("saveRoTemplateMetadata", () => {
  it("an empty region list is a schema refusal in a sentence", async () => {
    const res = await saveRoTemplateMetadata(form({ id: "t1", name: "Front desk", regions: "[]" }));
    expect(res).toEqual({ error: "At least one region is required." });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("malformed regions JSON is a refusal, not a crash", async () => {
    const res = await saveRoTemplateMetadata(form({ id: "t1", name: "Front desk", regions: "{not json" }));
    expect(res).toEqual({ error: "Template regions are malformed." });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("a new template without an image is refused in a sentence", async () => {
    const res = await saveRoTemplateMetadata(form({ id: "t1", name: "Front desk", regions: REGIONS }));
    expect(res).toEqual({ error: "Image is required for new templates." });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("an existing template saves without a new image; a DB fault still throws", async () => {
    const ok = await saveRoTemplateMetadata(
      form({ id: "t1", name: "Front desk", regions: REGIONS, existingStoragePath: "user-1/template_t1" }),
    );
    expect(ok).toEqual({ ok: true });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    updateSettings.mockRejectedValue(new Error("db down"));
    await expect(
      saveRoTemplateMetadata(
        form({ id: "t1", name: "Front desk", regions: REGIONS, existingStoragePath: "user-1/template_t1" }),
      ),
    ).rejects.toThrow("db down");
  });
});
