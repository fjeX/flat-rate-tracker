// backfillLaborTimeObservations: one-time rebuild of the pool from existing ROs.
import { describe, it, expect, vi, beforeEach } from "vitest";

const reportServerError = vi.fn(async () => undefined);
const state = {
  share: true,
  claim: true,
  entries: [] as unknown[],
  failReplace: false,
  revokeMidFlight: false,
};
let settingsReads = 0;
const clearCall = vi.fn();
const claimCall = vi.fn();
const replaceCall = vi.fn();
const completeCall = vi.fn();

vi.mock("@/lib/report-error-server", () => ({
  reportServerError: (...a: unknown[]) => reportServerError(...(a as [])),
}));
vi.mock("@/lib/db", () => ({
  getSettings: async () => {
    settingsReads += 1;
    return { shareLaborTimes: settingsReads > 1 && state.revokeMidFlight ? false : state.share };
  },
  clearAllLaborTimeObservations: async (...a: unknown[]) => clearCall(...a),
  listEntries: async () => state.entries,
  listOpCodes: async () => [],
  claimLaborTimeBackfill: async (...a: unknown[]) => {
    claimCall(...a);
    return state.claim;
  },
  replaceAllLaborTimeObservations: async (...a: unknown[]) => {
    replaceCall(...a);
    if (state.failReplace) throw new Error("boom insert");
  },
  completeLaborTimeBackfill: async (...a: unknown[]) => completeCall(...a),
}));

const { backfillLaborTimeObservations } = await import("./true-time-sync");
const client = { __fake: true } as never;

function timedEntry(id: string) {
  return {
    id,
    date: "2026-09-01",
    vehicle: { year: "2020", make: "Toyota", model: "Camry", vin: "", mileage: "" },
    opCodes: [
      {
        id: `l-${id}`,
        opCodeId: null,
        custom: true,
        customCode: "BRK",
        customDescription: null,
        flagHours: 2,
        actualHours: 2,
        actualSource: "timer",
        notes: "",
        position: 0,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.share = true;
  state.claim = true;
  state.entries = [];
  state.failReplace = false;
  state.revokeMidFlight = false;
  settingsReads = 0;
});

describe("backfillLaborTimeObservations", () => {
  it("is a no-op when sharing is off", async () => {
    state.share = false;
    expect(await backfillLaborTimeObservations(client)).toBe(false);
    expect(claimCall).not.toHaveBeenCalled();
    expect(replaceCall).not.toHaveBeenCalled();
  });

  it("does nothing when another run already holds the claim", async () => {
    state.claim = false;
    expect(await backfillLaborTimeObservations(client)).toBe(false);
    expect(replaceCall).not.toHaveBeenCalled();
    expect(completeCall).not.toHaveBeenCalled();
  });

  it("builds observations from every entry, past the 1000-row page", async () => {
    state.entries = Array.from({ length: 1200 }, (_, i) => timedEntry(`e${i}`));
    expect(await backfillLaborTimeObservations(client)).toBe(true);
    const obs = replaceCall.mock.calls[0][1] as unknown[];
    expect(obs).toHaveLength(1200);
    expect(claimCall).toHaveBeenCalledWith(client);
    // success: stamped done (which also clears the lease)
    expect(completeCall).toHaveBeenCalledTimes(1);
    expect(clearCall).not.toHaveBeenCalled();
  });

  it("purges its own rows when consent was revoked mid-flight", async () => {
    state.entries = [timedEntry("e1")];
    state.revokeMidFlight = true;
    expect(await backfillLaborTimeObservations(client)).toBe(false);
    expect(clearCall).toHaveBeenCalledTimes(1);
    expect(completeCall).not.toHaveBeenCalled();
  });

  it("leaves rows alone when the recheck still reads consent", async () => {
    state.entries = [timedEntry("e1")];
    await backfillLaborTimeObservations(client);
    expect(settingsReads).toBe(2);
    expect(clearCall).not.toHaveBeenCalled();
  });

  it("reports a failure instead of throwing, and keeps the lease (backoff)", async () => {
    state.entries = [timedEntry("e1")];
    state.failReplace = true;
    await expect(backfillLaborTimeObservations(client)).resolves.toBe(false);
    expect(reportServerError).toHaveBeenCalledTimes(1);
    expect(completeCall).not.toHaveBeenCalled();
  });
});
