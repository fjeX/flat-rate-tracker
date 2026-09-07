// deleteUnpaidTimeAction — the only way to strike one row off the unpaid-time
// ledger, and therefore off the dispute pack.
//
// The contract under test is paid-periods.ts's: a thrown Error crossing the
// Server Actions boundary is replaced with a generic string plus a digest in a
// production build, so anything the tech needs to READ has to come back as
// DATA. A test that only checked "bad input is rejected" would pass against a
// `throw` too.
//
// The other half is the shape of the call into the data layer: ONE row, BY ID.
// Not by hours — msToHours quantises to hundredths, so a stored 0.01h spans
// 18s–54s of hold time and the 30s ledger gate sits inside that band, making a
// real rework and an old phantom the same value.
import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
const deleteUnpaidTime = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __fake: true }),
}));
vi.mock("@/lib/db", () => ({
  deleteUnpaidTime: (...args: unknown[]) => deleteUnpaidTime(...args),
}));

const { deleteUnpaidTimeAction } = await import("./unpaid-time");

const ID = "aaaaaaaa-0000-4000-8000-000000000001";

beforeEach(() => {
  revalidatePath.mockReset();
  deleteUnpaidTime.mockReset();
  deleteUnpaidTime.mockResolvedValue(true);
});

describe("deleteUnpaidTimeAction", () => {
  it("deletes exactly one row, by id, and answers {} on success", async () => {
    await expect(deleteUnpaidTimeAction(ID)).resolves.toEqual({});

    expect(deleteUnpaidTime).toHaveBeenCalledTimes(1);
    expect(deleteUnpaidTime).toHaveBeenCalledWith({ __fake: true }, ID);
    // The whole argument list, pinned: an id and nothing else. No hours, no
    // date, no kind, no array — there is no bulk or predicate path, and a
    // second argument appearing here would be the beginning of one.
    expect(deleteUnpaidTime.mock.calls[0]).toHaveLength(2);
  });

  it("revalidates every surface that counts unpaid hours, /dashboard by name", async () => {
    await deleteUnpaidTimeAction(ID);
    const paths = revalidatePath.mock.calls.flat();

    // /dashboard is asserted explicitly because revalidating "/" does NOT reach
    // it — the documented FRT trap. Losing this line looks like "the delete
    // didn't work" on the dashboard card.
    expect(paths).toContain("/dashboard");
    expect(paths).toEqual([
      "/pay-period",
      "/pay-period/dispute-pack",
      "/insights",
      "/dashboard",
      "/",
    ]);
  });

  it("returns { error } as DATA for a bad id, and writes nothing", async () => {
    for (const bad of ["", "nope", "12345", "../../etc/passwd", "1;drop table"]) {
      revalidatePath.mockReset();
      deleteUnpaidTime.mockClear();

      const res = await deleteUnpaidTimeAction(bad);

      expect(res.error).toBeTruthy();
      expect(typeof res.error).toBe("string");
      expect(deleteUnpaidTime).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });

  it("never throws on invalid input, even for a non-string", async () => {
    // The client is typed, but a server action's argument arrives over the wire
    // and the type is not a guarantee.
    await expect(
      deleteUnpaidTimeAction(null as unknown as string),
    ).resolves.toMatchObject({ error: expect.any(String) });
    await expect(
      deleteUnpaidTimeAction({ id: ID } as unknown as string),
    ).resolves.toMatchObject({ error: expect.any(String) });
    // An array of ids is the shape a bulk delete would arrive in. It is not a
    // string, so it never reaches the data layer.
    await expect(
      deleteUnpaidTimeAction([ID, ID] as unknown as string),
    ).resolves.toMatchObject({ error: expect.any(String) });
    expect(deleteUnpaidTime).not.toHaveBeenCalled();
  });

  it("carries the real sentence, not a zod dump", async () => {
    const { error } = await deleteUnpaidTimeAction("");
    expect(error).toBe("Unpaid time ID is required.");
  });

  // A row that isn't this account's matches nothing (the data layer filters on
  // user_id on top of RLS), which is the same answer as a row already deleted.
  // Reporting that as success would tell the tech a row is gone while it is
  // still printing on their dispute pack.
  it("reports a row it could not delete instead of claiming success", async () => {
    deleteUnpaidTime.mockResolvedValue(false);

    const res = await deleteUnpaidTimeAction(ID);

    expect(res.error).toMatch(/no longer there/i);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // DB failures are the one thing that still throws — the component catches
  // those and shows the message. Pinning it keeps a well-meaning try/catch from
  // swallowing a failed delete into a silent "deleted!".
  it("lets a DB failure through rather than reporting success", async () => {
    deleteUnpaidTime.mockRejectedValueOnce(new Error("permission denied"));
    await expect(deleteUnpaidTimeAction(ID)).rejects.toThrow("permission denied");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
