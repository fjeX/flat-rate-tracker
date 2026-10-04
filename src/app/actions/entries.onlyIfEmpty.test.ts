// setLineActualHoursAction({ onlyIfEmpty }) — the guard the light "how long did
// that take?" asks use so a stale ask can never overwrite (and relabel as an
// estimate) hours a timer added after the ask was issued.
import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
const syncObservations = vi.fn();
let wrote = true;
const setLineActualHours = vi.fn(async (...a: unknown[]) => (void a, { wrote }));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ __fake: true }) }));
vi.mock("@/lib/db", () => ({
  setLineActualHours: (...a: unknown[]) => setLineActualHours(...a),
  getEntryIdForLine: async () => "eeeeeeee-0000-4000-8000-000000000001",
}));
vi.mock("@/lib/true-time-sync", () => ({
  syncObservations: (...a: unknown[]) => syncObservations(...a),
}));

const { setLineActualHoursAction } = await import("./entries");
const LINE = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  wrote = true;
});

describe("setLineActualHoursAction onlyIfEmpty", () => {
  it("passes the guard to the db write and succeeds when the line was empty", async () => {
    const res = await setLineActualHoursAction(LINE, 1.25, "estimate", { onlyIfEmpty: true });
    expect(res).toEqual({});
    expect(setLineActualHours.mock.calls[0][4]).toEqual({ onlyIfEmpty: true });
    expect(syncObservations).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("returns { skipped } and touches nothing else when the line was already filled", async () => {
    wrote = false;
    const res = await setLineActualHoursAction(LINE, 1.25, "estimate", { onlyIfEmpty: true });
    expect(res).toEqual({ skipped: true });
    expect(syncObservations).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("without the option it behaves as before, whatever the write reports", async () => {
    wrote = false;
    const res = await setLineActualHoursAction(LINE, 2, "timer");
    expect(res).toEqual({});
    expect(setLineActualHours.mock.calls[0][4]).toEqual({ onlyIfEmpty: false });
    expect(syncObservations).toHaveBeenCalled();
  });
});
