// setPeriodOverrideAction — the "would leave N days in no pay period" refusal
// must come back as DATA (server-action-thrown-refusals-masked): a thrown
// message is replaced by a generic string in a production build, and this one
// names the exact days the tech would orphan.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSettings = vi.fn();
const updateSettings = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/db", () => ({
  getSettings: (...a: unknown[]) => getSettings(...a),
  updateSettings: (...a: unknown[]) => updateSettings(...a),
}));

const { setPeriodOverrideAction } = await import("./settings");
const { getNeighborPeriodKeys } = await import("@/lib/periods");

// A mid-month period key and its neighbours, derived rather than hand-typed so
// the test follows whatever key format lib/periods uses.
const KEY = "2026-07-P2";
const N = getNeighborPeriodKeys(KEY)!;

beforeEach(() => {
  vi.clearAllMocks();
  updateSettings.mockResolvedValue(undefined);
});

describe("setPeriodOverrideAction", () => {
  it("returns the previous-neighbour hole as { error } and writes nothing", async () => {
    getSettings.mockResolvedValue({
      periodOverrides: { [N.prev]: { start: "2026-07-01", end: "2026-07-14" } },
    });
    const res = await setPeriodOverrideAction(KEY, "2026-07-18", "2026-07-31");
    expect(res).toHaveProperty("error");
    expect((res as { error: string }).error).toMatch(/^That would leave .* in no pay period\. The previous one ends/);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the next-neighbour hole as { error } and writes nothing", async () => {
    getSettings.mockResolvedValue({
      periodOverrides: { [N.next]: { start: "2026-08-05", end: "2026-08-15" } },
    });
    const res = await setPeriodOverrideAction(KEY, "2026-07-16", "2026-07-31");
    expect((res as { error: string }).error).toMatch(/^That would leave .* in no pay period\. The next one starts/);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("saves and answers { ok: true } when nothing is orphaned", async () => {
    getSettings.mockResolvedValue({ periodOverrides: {} });
    await expect(setPeriodOverrideAction(KEY, "2026-07-16", "2026-07-31")).resolves.toEqual({ ok: true });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("a plain Error (a genuine fault) still throws", async () => {
    getSettings.mockRejectedValue(new Error("db down"));
    await expect(setPeriodOverrideAction(KEY, "2026-07-16", "2026-07-31")).rejects.toThrow("db down");
  });

  it("a schema failure comes back as { error } too (validate() throws a Refusal)", async () => {
    await expect(setPeriodOverrideAction(KEY, "nope", "2026-07-31")).resolves.toEqual({
      error: expect.stringMatching(/YYYY-MM-DD/),
    });
    expect(getSettings).not.toHaveBeenCalled();
  });
});
