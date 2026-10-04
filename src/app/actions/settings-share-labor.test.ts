// setShareLaborTimesAction: on => backfill; off => purge (which also
// nulls the backfill stamp inside clearAllLaborTimeObservations).
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSettings = vi.fn();
const clearAll = vi.fn();
const backfill = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ __c: 1 }) }));
vi.mock("@/lib/db", () => ({
  updateSettings: (...a: unknown[]) => updateSettings(...a),
  clearAllLaborTimeObservations: (...a: unknown[]) => clearAll(...a),
}));
vi.mock("@/lib/true-time-sync", () => ({
  backfillLaborTimeObservations: (...a: unknown[]) => backfill(...a),
}));

const { setShareLaborTimesAction } = await import("./settings");

beforeEach(() => vi.clearAllMocks());

describe("setShareLaborTimesAction", () => {
  it("turning ON saves the flag, then runs the backfill", async () => {
    await setShareLaborTimesAction(true);
    expect(updateSettings).toHaveBeenCalledWith(expect.anything(), { shareLaborTimes: true });
    expect(backfill).toHaveBeenCalledWith(expect.anything());
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("turning OFF purges every observation and does not backfill", async () => {
    await setShareLaborTimesAction(false);
    expect(updateSettings).toHaveBeenCalledWith(expect.anything(), { shareLaborTimes: false });
    expect(clearAll).toHaveBeenCalledTimes(1);
    expect(backfill).not.toHaveBeenCalled();
  });
});
