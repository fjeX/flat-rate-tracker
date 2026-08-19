// deletePaidPeriodAction — the "I typed the wrong number" way out.
//
// The contract under test is the one the comment in paid-periods.ts spells out:
// a thrown Error crossing the Server Actions boundary is replaced with a generic
// string plus a digest in a production build, so validation failures have to
// come back as DATA. A test that only checked "bad input is rejected" would pass
// against a `throw` too, which is exactly the regression this guards.
import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
const deletePaidPeriod = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __fake: true }),
}));
vi.mock("@/lib/db", () => ({
  deletePaidPeriod: (...args: unknown[]) => deletePaidPeriod(...args),
}));

const { deletePaidPeriodAction } = await import("./paid-periods");

beforeEach(() => {
  revalidatePath.mockReset();
  deletePaidPeriod.mockReset();
});

describe("deletePaidPeriodAction", () => {
  it("deletes the period and answers {} on success", async () => {
    await expect(deletePaidPeriodAction("2026-07-P2")).resolves.toEqual({});

    expect(deletePaidPeriod).toHaveBeenCalledTimes(1);
    expect(deletePaidPeriod).toHaveBeenCalledWith({ __fake: true }, "2026-07-P2");
  });

  it("revalidates the same paths the setter does", async () => {
    await deletePaidPeriodAction("2026-07-P2");
    expect(revalidatePath.mock.calls.flat()).toEqual([
      "/pay-period",
      "/insights",
      "/",
    ]);
  });

  // Every one of these is rejected by periodKeySchema — the SAME schema
  // settings.ts already validates a period key with. No new bounds were
  // invented here: anything the setter accepts, this accepts.
  it.each([
    ["blank", ""],
    ["not a period key", "july"],
    ["month out of range", "2026-13-P1"],
    ["half of a key", "2026-07"],
    ["a third period", "2026-07-P3"],
    ["a path traversal attempt", "../../etc/passwd"],
  ])("returns { error } as DATA for %s, and writes nothing", async (_label, key) => {
    const res = await deletePaidPeriodAction(key);

    expect(res.error).toBeTruthy();
    expect(typeof res.error).toBe("string");
    expect(deletePaidPeriod).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("never throws on invalid input, even for a non-string", async () => {
    // The client is typed, but a server action's argument arrives over the wire
    // and the type is not a guarantee.
    await expect(
      deletePaidPeriodAction(null as unknown as string),
    ).resolves.toMatchObject({ error: expect.any(String) });
    await expect(
      deletePaidPeriodAction({ periodKey: "2026-07-P2" } as unknown as string),
    ).resolves.toMatchObject({ error: expect.any(String) });
    expect(deletePaidPeriod).not.toHaveBeenCalled();
  });

  it("carries the real sentence, not a zod dump", async () => {
    const { error } = await deletePaidPeriodAction("nope");
    expect(error).toBe("Period key is required.");
  });

  // DB failures are the one thing that still throws — the component catches
  // those and shows the message. Pinning it keeps a well-meaning `try/catch`
  // from swallowing a failed delete into a silent "cleared!".
  it("lets a DB failure through rather than reporting success", async () => {
    deletePaidPeriod.mockRejectedValueOnce(new Error("permission denied"));
    await expect(deletePaidPeriodAction("2026-07-P2")).rejects.toThrow(
      "permission denied",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
