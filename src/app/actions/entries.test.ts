// setLineUpsellAction / addOpCodeLineToEntryAction —
// server-action-thrown-refusals-masked (2026-10-01).
//
// A production build masks the message of any error thrown out of a Server
// Action, so db.setLineUpsell's "a comeback can't also be an upsell" and the
// validation sentences must come back as `{ error }` DATA. A real failure
// (DB down) must still throw.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Refusal } from "@/lib/refusal";

const revalidatePath = vi.fn();
const setLineUpsell = vi.fn();
const addEntryLine = vi.fn();
const syncObservations = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __fake: true }),
}));
vi.mock("@/lib/db", () => ({
  setLineUpsell: (...args: unknown[]) => setLineUpsell(...args),
  addEntryLine: (...args: unknown[]) => addEntryLine(...args),
}));
vi.mock("@/lib/true-time-sync", () => ({
  syncObservations: (...args: unknown[]) => syncObservations(...args),
}));

const { setLineUpsellAction, addOpCodeLineToEntryAction } = await import("./entries");

const LINE = "11111111-1111-4111-8111-111111111111";
const ENTRY = "eeeeeeee-0000-4000-8000-000000000001";
const NEW_LINE = {
  opCodeId: null,
  custom: true,
  customCode: "X",
  customDescription: null,
  flagHours: 1,
  actualHours: null,
  notes: "",
  subOpCodeId: null,
  laborType: null,
};

beforeEach(() => {
  revalidatePath.mockReset();
  setLineUpsell.mockReset().mockResolvedValue(undefined);
  addEntryLine.mockReset().mockResolvedValue(undefined);
  syncObservations.mockReset().mockResolvedValue(undefined);
});

describe("setLineUpsellAction", () => {
  it("is {} on success", async () => {
    await expect(setLineUpsellAction(LINE, true)).resolves.toEqual({});
  });

  it("returns the db layer's comeback refusal as data", async () => {
    const sentence =
      "That line is marked as a comeback — unpaid rework can't also be an upsell.";
    setLineUpsell.mockRejectedValue(new Refusal(sentence));
    await expect(setLineUpsellAction(LINE, true)).resolves.toEqual({ error: sentence });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a plain Error (a real failure) still throws", async () => {
    setLineUpsell.mockRejectedValue(new Error("db down"));
    await expect(setLineUpsellAction(LINE, true)).rejects.toThrow("db down");
  });
});

describe("addOpCodeLineToEntryAction", () => {
  it("is {} on success and syncs True Time", async () => {
    await expect(addOpCodeLineToEntryAction(ENTRY, NEW_LINE)).resolves.toEqual({});
    expect(syncObservations).toHaveBeenCalledWith({ __fake: true }, ENTRY);
  });

  it("returns a validation sentence instead of throwing it", async () => {
    const res = await addOpCodeLineToEntryAction(ENTRY, { ...NEW_LINE, flagHours: -1 });
    expect(res).toEqual({ error: "Flag hours must be a non-negative number." });
    expect(addEntryLine).not.toHaveBeenCalled();
  });

  it("a DB failure still throws — it is not a refusal", async () => {
    addEntryLine.mockRejectedValue(new Error("violates check constraint"));
    await expect(addOpCodeLineToEntryAction(ENTRY, NEW_LINE)).rejects.toThrow(
      "violates check constraint",
    );
  });
});
