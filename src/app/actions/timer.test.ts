// saveTimerAction (Open Tickets Phase 2 branch) and setTimerStatusAction (hold
// flip -> ro_events). The db layer is mocked at the function boundary, the
// same seam open-tickets.test.ts and unpaid-time.test.ts use — the point under
// test is which db calls happen, with what arguments, in what order, not real
// Postgres behaviour.
//
// See docs/plans/PLAN-open-tickets.md, "Timer (Phase 2)", decisions 4/5/10.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TimerSlot } from "@/lib/timer";
import type { Entry as EntryType } from "@/lib/types";

const calls: string[] = [];
const revalidatePath = vi.fn();
const reportServerError = vi.fn<(err: unknown, ctx?: { url?: string | null }) => Promise<void>>(
  async () => undefined,
);

const state = {
  slots: [] as TimerSlot[],
  entry: null as EntryType | null,
  ledger: [] as { entryId: string | null; kind: string; hours: number; source: string }[],
  events: [] as { entryId: string; kind: string; date: string; time?: string | null }[],
  /** frt_timezone cookie value; undefined = cookie never written. */
  tz: undefined as string | undefined,
  /** When set, getEntry moves the system clock here — simulates wall time
   *  passing (e.g. across midnight) between the action's `now` and its
   *  event write. */
  advanceClockOnGetEntry: null as number | null,
  failCreateUnpaidTime: false,
  failCreateRoEvent: false,
  deletedSlotIds: [] as string[],
  updatedSlots: [] as { id: string; patch: Record<string, unknown> }[],
};

function makeSlot(overrides: Partial<TimerSlot> = {}): TimerSlot {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    slot: 1,
    entryId: "eeeeeeee-0000-4000-8000-000000000001",
    lineId: null,
    status: "paused",
    startTime: null,
    workAccumulated: 0,
    holdPartsAccumulated: 0,
    holdApprovalAccumulated: 0,
    ...overrides,
  };
}

const LINE_ID = "11111111-1111-4111-8111-111111111111";

function makeEntry(overrides: Partial<EntryType> = {}): EntryType {
  return {
    id: "eeeeeeee-0000-4000-8000-000000000001",
    userId: "u",
    createdAt: "2026-09-01T09:00:00Z",
    updatedAt: "2026-09-01T09:00:00Z",
    date: "2026-09-01",
    roNumber: "55555",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: [],
    flagHours: 0,
    notes: "",
    status: "open",
    ...overrides,
  } as EntryType;
}

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("next/headers", () => ({
  // By default no timezone cookie is set: actions fall back to the server's
  // own clock (isoDate()), same as a machine with frt_timezone never written.
  // state.tz opts a test into a real zone.
  cookies: async () => ({
    get: (name: string) =>
      name === "frt_timezone" && state.tz !== undefined ? { value: state.tz } : undefined,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __fake: true }),
}));
vi.mock("@/lib/report-error-server", () => ({
  reportServerError: (err: unknown, ctx?: { url?: string | null }) =>
    reportServerError(err, ctx),
}));
vi.mock("@/lib/db", () => ({
  listTimerSlots: async () => state.slots,
  getEntry: async () => {
    if (state.advanceClockOnGetEntry !== null) vi.setSystemTime(state.advanceClockOnGetEntry);
    return state.entry;
  },
  listWorkSchedulesSafe: async () => null,
  listShiftOverridesSafe: async () => ({}),
  listUnpaidTimeForEntry: async (_c: unknown, entryId: string) =>
    state.ledger.filter((r) => r.entryId === entryId),
  createUnpaidTime: async (
    _c: unknown,
    input: { entryId: string | null; kind: string; hours: number; source: string },
  ) => {
    calls.push(`createUnpaidTime:${input.kind}`);
    if (state.failCreateUnpaidTime) throw new Error("boom unpaid time");
    state.ledger.push(input);
    return { id: "row-1", ...input };
  },
  createUnpaidTimeSafe: async (
    _c: unknown,
    input: { entryId: string | null; kind: string; hours: number; source: string },
  ) => {
    calls.push(`createUnpaidTimeSafe:${input.kind}`);
    state.ledger.push(input);
    return true;
  },
  addLineActualHours: async (_c: unknown, lineId: string, addHours: number) => {
    calls.push(`addLineActualHours:${lineId}`);
    return { previous: 2, total: 2 + addHours };
  },
  deleteTimerSlot: async (_c: unknown, id: string) => {
    calls.push("deleteTimerSlot");
    state.deletedSlotIds.push(id);
  },
  updateTimerSlot: async (_c: unknown, id: string, patch: Record<string, unknown>) => {
    calls.push("updateTimerSlot");
    state.updatedSlots.push({ id, patch });
  },
  createRoEvent: async (
    _c: unknown,
    input: { entryId: string; kind: string; date: string; time?: string | null },
  ) => {
    calls.push(`createRoEvent:${input.kind}`);
    if (state.failCreateRoEvent) throw new Error("boom ro event");
    state.events.push(input);
    return input;
  },
}));

const { saveTimerAction, setTimerStatusAction } = await import("./timer");
const { hhmmInTz, isoDate } = await import("@/lib/periods");

beforeEach(() => {
  calls.length = 0;
  revalidatePath.mockReset();
  reportServerError.mockClear();
  state.slots = [];
  state.entry = null;
  state.ledger = [];
  state.events = [];
  state.failCreateUnpaidTime = false;
  state.failCreateRoEvent = false;
  state.tz = undefined;
  state.advanceClockOnGetEntry = null;
  vi.useRealTimers();
  state.deletedSlotIds = [];
  state.updatedSlots = [];
});

const ONE_HOUR_MS = 3_600_000;

describe("saveTimerAction — open lineless ticket (Open Tickets Phase 2)", () => {
  it("writes exactly one open_work row, source timer, and returns target ticket with correct previous/total", async () => {
    state.slots = [makeSlot({ workAccumulated: ONE_HOUR_MS })];
    state.entry = makeEntry({ status: "open", opCodes: [] });

    const res = await saveTimerAction("aaaaaaaa-1111-4111-8111-111111111111", null);

    const writes = calls.filter((c) => c.startsWith("createUnpaidTime:"));
    expect(writes).toEqual(["createUnpaidTime:open_work"]);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({
      hours: 1,
      kind: "open_work",
      entryId: "eeeeeeee-0000-4000-8000-000000000001",
      source: "timer",
    });
    expect(res.target).toBe("ticket");
    expect(res.previousHours).toBeNull();
    expect(res.totalHours).toBe(1);
    expect(res.workHours).toBe(1);
    expect(calls).toContain("deleteTimerSlot");
  });

  it("sums onto whatever the ticket already had", async () => {
    state.slots = [makeSlot({ workAccumulated: ONE_HOUR_MS })];
    state.entry = makeEntry({ status: "open", opCodes: [] });
    state.ledger = [
      { entryId: state.entry.id, kind: "open_work", hours: 2.5, source: "manual" },
    ];

    const res = await saveTimerAction("aaaaaaaa-1111-4111-8111-111111111111", null);

    expect(res.previousHours).toBe(2.5);
    expect(res.totalHours).toBe(3.5);
  });

  it("throws when a lineId is passed for a lineless open ticket", async () => {
    state.slots = [makeSlot({ workAccumulated: ONE_HOUR_MS })];
    state.entry = makeEntry({ status: "open", opCodes: [] });

    await expect(
      saveTimerAction("aaaaaaaa-1111-4111-8111-111111111111", LINE_ID),
    ).rejects.toThrow("That op code line isn't on this RO.");
    expect(calls).not.toContain("deleteTimerSlot");
    expect(state.ledger).toHaveLength(0);
  });

  it("writes no open_work row when workHours is 0", async () => {
    state.slots = [makeSlot({ workAccumulated: 0 })];
    state.entry = makeEntry({ status: "open", opCodes: [] });

    const res = await saveTimerAction("aaaaaaaa-1111-4111-8111-111111111111", null);

    expect(calls.filter((c) => c.startsWith("createUnpaidTime:"))).toHaveLength(0);
    expect(res.target).toBe("ticket");
    expect(res.previousHours).toBeNull();
    expect(res.totalHours).toBe(0);
    expect(calls).toContain("deleteTimerSlot");
  });

  it("propagates a write failure and does NOT delete the slot", async () => {
    state.slots = [makeSlot({ workAccumulated: ONE_HOUR_MS })];
    state.entry = makeEntry({ status: "open", opCodes: [] });
    state.failCreateUnpaidTime = true;

    await expect(
      saveTimerAction("aaaaaaaa-1111-4111-8111-111111111111", null),
    ).rejects.toThrow("boom unpaid time");
    expect(calls).not.toContain("deleteTimerSlot");
    expect(state.deletedSlotIds).toHaveLength(0);
  });
});

describe("saveTimerAction — entries with lines (unchanged path)", () => {
  it("throws 'Pick an op code' when the entry has lines and lineId is null", async () => {
    state.slots = [makeSlot({ workAccumulated: ONE_HOUR_MS })];
    state.entry = makeEntry({
      status: "open",
      opCodes: [
        {
          id: LINE_ID,
          opCodeId: null,
          custom: true,
          customCode: "X",
          customDescription: null,
          flagHours: 1,
          actualHours: null,
          notes: "",
          position: 0,
          subOpCodeId: null,
          laborType: null,
        },
      ],
    });

    await expect(saveTimerAction("aaaaaaaa-1111-4111-8111-111111111111", null)).rejects.toThrow(
      "Pick an op code to save this time to.",
    );
    expect(calls).not.toContain("deleteTimerSlot");
  });

  it("calls addLineActualHours and returns target line for a closed entry", async () => {
    state.slots = [makeSlot({ workAccumulated: ONE_HOUR_MS, lineId: LINE_ID })];
    state.entry = makeEntry({
      status: "closed",
      opCodes: [
        {
          id: LINE_ID,
          opCodeId: null,
          custom: true,
          customCode: "X",
          customDescription: null,
          flagHours: 1,
          actualHours: null,
          notes: "",
          position: 0,
          subOpCodeId: null,
          laborType: null,
        },
      ],
    });

    const res = await saveTimerAction("aaaaaaaa-1111-4111-8111-111111111111", LINE_ID);

    expect(calls).toContain(`addLineActualHours:${LINE_ID}`);
    expect(res.target).toBe("line");
    expect(res.previousHours).toBe(2);
    expect(res.totalHours).toBe(3);
    expect(state.ledger).toHaveLength(0);
  });
});

describe("setTimerStatusAction — hold flips write ro_events on open tickets", () => {
  it("writes one ro_events row on a flip into a hold on an open entry", async () => {
    state.slots = [makeSlot({ status: "working", startTime: 1 })];
    state.entry = makeEntry({ status: "open" });

    await setTimerStatusAction("aaaaaaaa-1111-4111-8111-111111111111", "hold_parts");

    expect(calls.filter((c) => c === "createRoEvent:hold_parts")).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      entryId: "eeeeeeee-0000-4000-8000-000000000001",
      kind: "hold_parts",
    });
  });

  // timeline-timer-event-untimed: the hold starts NOW, so it carries a time like
  // the opened/reopened/closed transitions do. An untimed row sorts after every
  // timed event that day (sortRoEvents, nulls last).
  it("stamps the hold event with date AND HH:MM from the flip's own instant (no tz cookie)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const at = new Date(2026, 8, 15, 8, 5, 42); // local 08:05:42
    vi.setSystemTime(at);
    state.slots = [makeSlot({ status: "working", startTime: 1 })];
    state.entry = makeEntry({ status: "open" });

    await setTimerStatusAction("aaaaaaaa-1111-4111-8111-111111111111", "hold_parts");

    expect(state.events).toHaveLength(1);
    expect(state.events[0].time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    expect(state.events[0]).toMatchObject({ date: isoDate(at), time: hhmmInTz("", at) });
    expect(state.events[0].time).toBe("08:05");
  });

  it("takes date and time from ONE instant — a flip at 23:59 whose write lands after midnight stays on the flip's day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    state.tz = "America/Los_Angeles";
    // 2026-09-15T06:59:30Z = 23:59:30 PDT on Sep 14. By the time the event is
    // written (after the updateTimerSlot + getEntry awaits) the wall clock has
    // crossed midnight: 07:00:30Z = 00:00:30 PDT Sep 15.
    const flipAt = Date.UTC(2026, 8, 15, 6, 59, 30);
    vi.setSystemTime(flipAt);
    state.advanceClockOnGetEntry = Date.UTC(2026, 8, 15, 7, 0, 30);
    state.slots = [makeSlot({ status: "working", startTime: 1 })];
    state.entry = makeEntry({ status: "open" });

    await setTimerStatusAction("aaaaaaaa-1111-4111-8111-111111111111", "hold_approval");

    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      kind: "hold_approval",
      date: "2026-09-14",
      time: "23:59",
    });
    // Same instant the slot's hold clock restarted at.
    expect(state.updatedSlots.at(-1)?.patch.startTime).toBe(flipAt);
  });

  it("writes nothing when the status doesn't actually change", async () => {
    state.slots = [makeSlot({ status: "hold_parts", startTime: 1 })];
    state.entry = makeEntry({ status: "open" });

    await setTimerStatusAction("aaaaaaaa-1111-4111-8111-111111111111", "hold_parts");

    expect(calls.filter((c) => c.startsWith("createRoEvent"))).toHaveLength(0);
  });

  it("writes nothing on a flip back to working", async () => {
    state.slots = [makeSlot({ status: "hold_parts", startTime: 1 })];
    state.entry = makeEntry({ status: "open" });

    await setTimerStatusAction("aaaaaaaa-1111-4111-8111-111111111111", "working");

    expect(calls.filter((c) => c.startsWith("createRoEvent"))).toHaveLength(0);
  });

  it("writes nothing for a closed entry", async () => {
    state.slots = [makeSlot({ status: "working", startTime: 1 })];
    state.entry = makeEntry({ status: "closed" });

    await setTimerStatusAction("aaaaaaaa-1111-4111-8111-111111111111", "hold_approval");

    expect(calls.filter((c) => c.startsWith("createRoEvent"))).toHaveLength(0);
  });

  it("does not throw when the event write fails — the status change still lands", async () => {
    state.slots = [makeSlot({ status: "working", startTime: 1 })];
    state.entry = makeEntry({ status: "open" });
    state.failCreateRoEvent = true;

    await expect(setTimerStatusAction("aaaaaaaa-1111-4111-8111-111111111111", "hold_parts")).resolves.toBeUndefined();
    expect(reportServerError).toHaveBeenCalledTimes(1);
    expect(calls).toContain("updateTimerSlot");
  });
});
