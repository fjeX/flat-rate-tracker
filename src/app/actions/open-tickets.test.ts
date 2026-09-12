// closeTicketAction — the ordering rule from the plan, pinned.
//
//   1. lines inserted   2. date moved   3. `closed` event   4. status = closed
//
// The status flip is LAST so a failure anywhere before it leaves an OPEN ticket
// with lines on it (visible on the card, retryable) rather than a closed RO
// with no lines and no flag. A test that only checked the happy path would
// pass against a reordered sequence too, so each step is made to fail in turn
// and the ticket's state afterwards is asserted.
//
// The db layer is mocked at the function boundary (the same seam
// unpaid-time.test.ts uses); the order of calls IS the thing under test.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Entry } from "@/lib/types";

const calls: string[] = [];
const revalidatePath = vi.fn();

const state = {
  entry: null as Entry | null,
  events: [] as { kind: string }[],
  fail: null as null | "lines" | "date" | "event" | "status",
  lastClose: null as null | { date: string; loggedTime: string | null },
};

function openEntry(lines = 0): Entry {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    userId: "u",
    createdAt: "2026-06-08T09:00:00Z",
    updatedAt: "2026-06-08T09:00:00Z",
    date: "2026-06-08",
    roNumber: "12345",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: Array.from({ length: lines }, (_, i) => ({
      id: `l${i}`,
      opCodeId: null,
      custom: true,
      customCode: "X",
      customDescription: null,
      flagHours: 1,
      actualHours: null,
      notes: "",
      position: i,
      subOpCodeId: null,
      laborType: null,
    })),
    flagHours: lines,
    notes: "",
    status: "open",
  };
}

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "America/Los_Angeles" }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __fake: true }),
}));
vi.mock("@/lib/report-error-server", () => ({ reportServerError: async () => {} }));
vi.mock("@/lib/db", () => ({
  getEntry: async () => state.entry,
  addEntryLines: async (_c: unknown, _id: string, lines: unknown[]) => {
    calls.push("lines");
    if (state.fail === "lines") throw new Error("boom lines");
    state.entry = openEntry(lines.length);
  },
  setEntryCloseDate: async (
    _c: unknown,
    _id: string,
    date: string,
    loggedTime: string | null,
  ) => {
    calls.push("date");
    state.lastClose = { date, loggedTime };
    if (state.fail === "date") throw new Error("boom date");
    if (state.entry) state.entry = { ...state.entry, date };
  },
  listRoEvents: async () => state.events,
  createRoEvent: async (_c: unknown, input: { kind: string }) => {
    calls.push(`event:${input.kind}`);
    if (state.fail === "event") throw new Error("boom event");
    state.events.push({ kind: input.kind });
    return input;
  },
  setEntryStatus: async (_c: unknown, _id: string, status: "open" | "closed") => {
    calls.push(`status:${status}`);
    if (state.fail === "status") throw new Error("boom status");
    if (state.entry) state.entry = { ...state.entry, status };
  },
  // True Time sync reads these; they can answer nothing.
  getSettings: async () => ({ shareLaborTimes: false }),
  listOpCodes: async () => [],
  syncEntryLaborTimeObservations: async () => {},
}));

const { closeTicketAction } = await import("./open-tickets");

const LINE = {
  opCodeId: null,
  custom: true,
  customCode: "ENG-RR",
  customDescription: "Engine R&R",
  flagHours: 14,
  actualHours: null,
  notes: "",
  position: 0,
  subOpCodeId: null,
  laborType: null,
};

const INPUT = {
  entryId: "aaaaaaaa-0000-4000-8000-000000000001",
  date: "2026-06-12",
  opCodes: [LINE],
};

beforeEach(() => {
  calls.length = 0;
  revalidatePath.mockReset();
  state.entry = openEntry();
  state.events = [{ kind: "opened" }];
  state.fail = null;
  state.lastClose = null;
});

describe("closeTicketAction", () => {
  it("runs lines → date → closed event → status, in that order", async () => {
    const res = await closeTicketAction(INPUT);
    expect(res.error).toBeUndefined();
    expect(calls).toEqual(["lines", "date", "event:closed", "status:closed"]);
    expect(state.entry?.status).toBe("closed");
    expect(state.entry?.date).toBe("2026-06-12");
  });

  it.each(["lines", "date", "event"] as const)(
    "a failure at step %s leaves the ticket OPEN — never closed without its lines",
    async (step) => {
      state.fail = step;
      await expect(closeTicketAction(INPUT)).rejects.toThrow(`boom ${step}`);
      expect(state.entry?.status).toBe("open");
      expect(calls).not.toContain("status:closed");
    },
  );

  it("a retry after a late failure does not double the lines or the closed event", async () => {
    state.fail = "status";
    await expect(closeTicketAction(INPUT)).rejects.toThrow("boom status");
    expect(state.entry?.opCodes).toHaveLength(1);
    expect(state.events.filter((e) => e.kind === "closed")).toHaveLength(1);

    state.fail = null;
    calls.length = 0;
    const res = await closeTicketAction(INPUT);
    expect(res.error).toBeUndefined();
    // Lines already on the ticket, event already written: only the date and
    // the status flip run again.
    expect(calls).toEqual(["date", "status:closed"]);
    expect(state.entry?.opCodes).toHaveLength(1);
    expect(state.events.filter((e) => e.kind === "closed")).toHaveLength(1);
  });

  it("refuses to close a ticket that is already closed (a stale tab, a double-tap)", async () => {
    state.entry = { ...openEntry(1), status: "closed" };
    const res = await closeTicketAction(INPUT);
    expect(res.error).toMatch(/already closed/i);
    expect(calls).toEqual([]);
  });

  it("refuses an empty line list as DATA, not a throw — the close is where the guard lives", async () => {
    const res = await closeTicketAction({ ...INPUT, opCodes: [] });
    expect(res.error).toMatch(/at least one op code/i);
    expect(calls).toEqual([]);
  });

  it("clears the opened-day logged time when the form did not carry one (plan risk #3)", async () => {
    await closeTicketAction(INPUT);
    expect(state.lastClose).toEqual({ date: "2026-06-12", loggedTime: null });
  });

  it("writes the close-day time when the form carried one", async () => {
    await closeTicketAction({ ...INPUT, loggedTime: "16:45" });
    expect(state.lastClose).toEqual({ date: "2026-06-12", loggedTime: "16:45" });
  });

  it("revalidates /dashboard by name — the card is what changes", async () => {
    await closeTicketAction(INPUT);
    expect(revalidatePath.mock.calls.flat()).toContain("/dashboard");
  });
});
