// The shared True Time sync: re-reads the entry, passes consent through, and
// never throws — a failure is reported, not surfaced to the tech's save.
import { describe, it, expect, vi, beforeEach } from "vitest";

const reportServerError = vi.fn(async () => undefined);
const syncCall = vi.fn(async () => undefined);
const state = {
  entry: null as unknown,
  share: false,
  failGetEntry: false,
};

vi.mock("@/lib/report-error-server", () => ({
  reportServerError: (...a: unknown[]) => reportServerError(...(a as [])),
}));
vi.mock("@/lib/db", () => ({
  getSettings: async () => ({ shareLaborTimes: state.share }),
  getEntry: async () => {
    if (state.failGetEntry) throw new Error("boom read");
    return state.entry;
  },
  listOpCodes: async () => [],
  syncEntryLaborTimeObservations: (...a: unknown[]) => syncCall(...(a as [])),
}));

const { syncObservations } = await import("./true-time-sync");
const client = { __fake: true } as never;

beforeEach(() => {
  reportServerError.mockClear();
  syncCall.mockClear();
  state.entry = null;
  state.share = false;
  state.failGetEntry = false;
});

describe("syncObservations", () => {
  it("does nothing when the entry is gone", async () => {
    await syncObservations(client, "e1");
    expect(syncCall).not.toHaveBeenCalled();
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it("passes the entry's observations and the consent setting through", async () => {
    state.share = false;
    state.entry = {
      id: "e1",
      date: "2026-09-01",
      vehicle: { year: "2020", make: "Toyota", model: "Camry", vin: "", mileage: "" },
      opCodes: [
        {
          id: "l1",
          opCodeId: null,
          custom: true,
          customCode: "BRK",
          customDescription: null,
          flagHours: 1,
          actualHours: 1.5,
          notes: "",
          position: 0,
          subOpCodeId: null,
          laborType: null,
        },
      ],
    };
    await syncObservations(client, "e1");
    expect(syncCall).toHaveBeenCalledWith(
      client,
      "e1",
      [expect.objectContaining({ lineId: "l1", actualHours: 1.5 })],
      false,
    );
  });

  it("swallows and reports a failure instead of throwing", async () => {
    state.failGetEntry = true;
    await expect(syncObservations(client, "e1")).resolves.toBeUndefined();
    expect(reportServerError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom read" }),
      { url: "true-time/syncObservations" },
    );
  });
});
