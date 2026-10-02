// setShiftOverrideAction / resolveZeroDayAction —
// server-action-thrown-refusals-masked (2026-10-01).
//
// A production build masks the message of any error thrown out of a Server
// Action, so "That shift doesn't work…" and the zero-day validation sentences
// must come back as `{ error }` DATA. A real failure (DB down) must still throw.
import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
const upsertShiftOverride = vi.fn();
const addConfirmedZeroDay = vi.fn();
const addDayOff = vi.fn();
const createUnpaidTime = vi.fn();
const upsertWorkSchedule = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __fake: true }),
}));
vi.mock("@/lib/db", () => ({
  upsertShiftOverride: (...args: unknown[]) => upsertShiftOverride(...args),
  addConfirmedZeroDay: (...args: unknown[]) => addConfirmedZeroDay(...args),
  addDayOff: (...args: unknown[]) => addDayOff(...args),
  createUnpaidTime: (...args: unknown[]) => createUnpaidTime(...args),
  upsertWorkSchedule: (...args: unknown[]) => upsertWorkSchedule(...args),
}));

const { setShiftOverrideAction, resolveZeroDayAction, saveWorkScheduleAction } = await import("./schedule");

beforeEach(() => {
  revalidatePath.mockReset();
  upsertShiftOverride.mockReset().mockResolvedValue(undefined);
  addConfirmedZeroDay.mockReset().mockResolvedValue(undefined);
  addDayOff.mockReset().mockResolvedValue(undefined);
  createUnpaidTime.mockReset().mockResolvedValue(undefined);
  upsertWorkSchedule.mockReset().mockResolvedValue({ id: "ws-1", effectiveFrom: "2026-10-06" });
});

describe("saveWorkScheduleAction", () => {
  const shift = { start: "08:00", end: "17:00", breakMin: 60 };
  const week = { mon: shift, tue: shift, wed: shift, thu: shift, fri: shift, sat: null, sun: null };
  const emptyWeek = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

  it("a pattern validateWeeks rejects comes back as { error } and nothing is written", async () => {
    const res = await saveWorkScheduleAction({
      effectiveFrom: "2026-10-06",
      rotationWeeks: 1,
      weeks: [emptyWeek],
    });
    expect(res).toHaveProperty("error");
    expect(typeof (res as { error: string }).error).toBe("string");
    expect(upsertWorkSchedule).not.toHaveBeenCalled();
  });

  it("a schema failure is a refusal too", async () => {
    const res = await saveWorkScheduleAction({
      effectiveFrom: "not-a-date",
      rotationWeeks: 1,
      weeks: [week],
    });
    expect(res).toHaveProperty("error");
    expect(upsertWorkSchedule).not.toHaveBeenCalled();
  });

  it("a valid schedule saves and returns it; a DB fault still throws", async () => {
    const res = await saveWorkScheduleAction({ effectiveFrom: "2026-10-06", rotationWeeks: 1, weeks: [week] });
    expect(res).toEqual({ id: "ws-1", effectiveFrom: "2026-10-06" });
    upsertWorkSchedule.mockRejectedValue(new Error("db down"));
    await expect(
      saveWorkScheduleAction({ effectiveFrom: "2026-10-06", rotationWeeks: 1, weeks: [week] }),
    ).rejects.toThrow("db down");
  });
});

describe("setShiftOverrideAction", () => {
  it("returns the stored shift on success", async () => {
    await expect(
      setShiftOverrideAction("2026-10-02", { paidHours: 8, start: "07:00", breakMin: 30 }),
    ).resolves.toEqual({ start: "07:00", end: "15:30", breakMin: 30 });
  });

  it("refuses a shift that runs past midnight, as data", async () => {
    await expect(
      setShiftOverrideAction("2026-10-02", { paidHours: 10, start: "20:00", breakMin: 0 }),
    ).resolves.toEqual({
      error:
        "That shift doesn't work — check the hours, start time, and lunch (it must end before midnight).",
    });
    expect(upsertShiftOverride).not.toHaveBeenCalled();
  });

  it("a plain Error (a real failure) still throws", async () => {
    upsertShiftOverride.mockRejectedValue(new Error("db down"));
    await expect(
      setShiftOverrideAction("2026-10-02", { paidHours: 8, start: "07:00", breakMin: 30 }),
    ).rejects.toThrow("db down");
  });
});

describe("resolveZeroDayAction", () => {
  it("is {} on success", async () => {
    await expect(resolveZeroDayAction("2026-10-01", "worked-zero")).resolves.toEqual({});
    await expect(resolveZeroDayAction("2026-10-01", "day-off")).resolves.toEqual({});
  });

  it("refuses worked-unpaid with no ledger block", async () => {
    await expect(resolveZeroDayAction("2026-10-01", "worked-unpaid")).resolves.toEqual({
      error: "Unpaid hours and reason are required.",
    });
    expect(createUnpaidTime).not.toHaveBeenCalled();
    expect(addConfirmedZeroDay).not.toHaveBeenCalled();
  });

  it("returns a validation sentence instead of throwing it", async () => {
    await expect(
      resolveZeroDayAction("2026-10-01", "worked-unpaid", {
        hours: 0,
        kind: "comeback_own",
      }),
    ).resolves.toEqual({ error: "Unpaid hours must be greater than zero." });
  });

  it("a plain Error (a real failure) still throws", async () => {
    addConfirmedZeroDay.mockRejectedValue(new Error("db down"));
    await expect(resolveZeroDayAction("2026-10-01", "worked-zero")).rejects.toThrow(
      "db down",
    );
  });
});
