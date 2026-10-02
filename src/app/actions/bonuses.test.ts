// server-action-thrown-refusals-masked (2026-10-01): a production build masks
// the message of any error thrown out of a Server Action, so the spiff
// refusals ("no longer exists", "was not deleted") and validation sentences
// must come back as `{ error }` DATA. A real failure (DB down) must still throw.
import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
const createBonus = vi.fn();
const updateBonus = vi.fn();
const deleteBonus = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __fake: true }),
}));
vi.mock("@/lib/db", () => ({
  createBonus: (...args: unknown[]) => createBonus(...args),
  updateBonus: (...args: unknown[]) => updateBonus(...args),
  deleteBonus: (...args: unknown[]) => deleteBonus(...args),
}));

const { createBonusAction, updateBonusAction, deleteBonusAction } = await import(
  "./bonuses"
);

const ID = "bbbbbbbb-0000-4000-8000-000000000001";
const INPUT = {
  date: "2026-09-30",
  amount: 25,
  category: "spiff" as const,
  source: "Tires",
  note: null,
  entryId: null,
};
const BONUS = { id: ID, ...INPUT };

beforeEach(() => {
  revalidatePath.mockReset();
  createBonus.mockReset();
  updateBonus.mockReset();
  deleteBonus.mockReset();
});

describe("bonus actions — refusals come back as data", () => {
  it("createBonusAction returns the saved bonus on success", async () => {
    createBonus.mockResolvedValue(BONUS);
    await expect(createBonusAction(INPUT)).resolves.toEqual(BONUS);
  });

  it("createBonusAction returns a validation sentence instead of throwing", async () => {
    const res = await createBonusAction({ ...INPUT, amount: -5 });
    expect(res).toHaveProperty("error");
    expect(typeof (res as { error: string }).error).toBe("string");
    expect(createBonus).not.toHaveBeenCalled();
  });

  it("updateBonusAction refuses a spiff that no longer exists", async () => {
    updateBonus.mockResolvedValue(null);
    await expect(updateBonusAction(ID, INPUT)).resolves.toEqual({
      error: "That spiff no longer exists — nothing was saved.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("deleteBonusAction refuses when nothing was deleted, and is {} when it was", async () => {
    deleteBonus.mockResolvedValue(false);
    await expect(deleteBonusAction(ID)).resolves.toEqual({
      error:
        "That spiff was not deleted — it may already be gone. Refresh and try again.",
    });
    deleteBonus.mockResolvedValue(true);
    await expect(deleteBonusAction(ID)).resolves.toEqual({});
  });

  it("a plain Error (a real failure) still throws", async () => {
    deleteBonus.mockRejectedValue(new Error("db down"));
    await expect(deleteBonusAction(ID)).rejects.toThrow("db down");
    updateBonus.mockRejectedValue(new Error("db down"));
    await expect(updateBonusAction(ID, INPUT)).rejects.toThrow("db down");
  });
});
