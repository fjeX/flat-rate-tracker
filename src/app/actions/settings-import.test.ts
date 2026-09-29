// importDataAction — every refusal must come back as DATA.
//
// Incident fingerprint `import-error-text-masked`: a thrown Error crossing the
// Server Actions boundary has its message replaced with a generic string plus a
// digest in a production build, so a refused backup reached the tech as "An
// error occurred in the Server Components render". A test that only checked
// "bad file is rejected" would pass against a `throw` too — so each case here
// asserts the action RESOLVES with the exact sentence, and that the one write
// (the import_replace_account RPC) never ran.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const storageRemove = vi.fn();
const enforceRateLimit = vi.fn();
const reportServerError = vi.fn();
const listAllUserPhotoPaths = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    storage: { from: () => ({ remove: (...a: unknown[]) => storageRemove(...a) }) },
  }),
}));
vi.mock("@/lib/db", () => ({
  getCurrentUserId: async () => "user-1",
  listAllUserPhotoPaths: (...a: unknown[]) => listAllUserPhotoPaths(...a),
}));
vi.mock("@/lib/report-error-server", () => ({
  reportServerError: (...a: unknown[]) => reportServerError(...a),
}));
vi.mock("@/lib/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/lib/rate-limit")>();
  return {
    ...real,
    enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
  };
});

// Passthrough to the real builder by default; one test swaps in a genuine
// bug to prove only ImportRefusal is converted to data.
let buildOverride: ((...a: unknown[]) => unknown) | null = null;
vi.mock("@/lib/import-remap", async (orig) => {
  const real = await orig<typeof import("@/lib/import-remap")>();
  return {
    ...real,
    buildImportPayload: (...a: unknown[]) =>
      buildOverride
        ? buildOverride(...a)
        : (real.buildImportPayload as (...x: unknown[]) => unknown)(...a),
  };
});

const { importDataAction } = await import("./settings");
const { RateLimitError } = await import("@/lib/rate-limit");
type Bundle = Parameters<typeof importDataAction>[0];

function bundle(over: Record<string, unknown> = {}): Bundle {
  return {
    version: 5,
    exportedAt: "2026-09-01T00:00:00.000Z",
    settings: {},
    entries: [],
    opCodes: [],
    dailyClocks: [],
    ...over,
  } as unknown as Bundle;
}

beforeEach(() => {
  vi.clearAllMocks();
  buildOverride = null;
  rpc.mockResolvedValue({ error: null });
  storageRemove.mockResolvedValue({ error: null });
  enforceRateLimit.mockResolvedValue(undefined);
  listAllUserPhotoPaths.mockResolvedValue([]);
});

describe("importDataAction refusals come back as data", () => {
  it.each<[string, Bundle, string]>([
    ["an unsupported version", bundle({ version: 99 }), "Unsupported backup version 99."],
    [
      "a file that fails the schema",
      bundle({ entries: "nope" }),
      "Invalid backup format.",
    ],
    [
      "a bad entry date",
      bundle({ entries: [{ date: "09/01/2026", roNumber: "4411" }] }),
      "Invalid date in entry RO#4411.",
    ],
    [
      "a bad clock date",
      bundle({ dailyClocks: [{ date: "yesterday" }] }),
      "Invalid date in clock record.",
    ],
    [
      "a bad bonus date",
      bundle({ bonuses: [{ date: "x" }] }),
      "Invalid date in bonus record.",
    ],
    [
      "a bad unpaid-time date",
      bundle({ unpaidTime: [{ date: "x" }] }),
      "Invalid date in unpaid time record.",
    ],
  ])("refuses %s with its sentence and never calls the RPC", async (_l, b, msg) => {
    await expect(importDataAction(b)).resolves.toEqual({ error: msg });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a non-object without throwing", async () => {
    await expect(importDataAction(null as unknown as Bundle)).resolves.toEqual({
      error: "Unsupported backup version undefined.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the rate-limit sentence instead of throwing it", async () => {
    enforceRateLimit.mockRejectedValue(
      new RateLimitError("Too many imports in a short time — please wait a few minutes.", 60),
    );
    await expect(importDataAction(bundle())).resolves.toEqual({
      error: "Too many imports in a short time — please wait a few minutes.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still throws a non-limit fault from the limiter step", async () => {
    enforceRateLimit.mockRejectedValue(new Error("boom"));
    await expect(importDataAction(bundle())).rejects.toThrow("boom");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a data/constraint rejection from Postgres to a sentence and reports the raw error", async () => {
    const pgErr = {
      code: "23514",
      message: 'new row for relation "entries" violates check constraint "x"',
    };
    rpc.mockResolvedValue({ error: pgErr });
    const res = await importDataAction(bundle());
    expect(res.error).toMatch(/nothing was imported/);
    expect(res.error).not.toMatch(/relation|constraint/);
    expect(reportServerError).toHaveBeenCalledWith(pgErr, {
      url: "importDataAction:rpc-refused",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("still throws an infrastructure RPC error", async () => {
    rpc.mockResolvedValue({ error: { code: "PGRST202", message: "no function" } });
    await expect(importDataAction(bundle())).rejects.toMatchObject({ code: "PGRST202" });
  });

  it("answers {} on success and revalidates", async () => {
    await expect(importDataAction(bundle())).resolves.toEqual({});
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalled();
  });
});

// The dispute claim-total checks live in buildImportPayload (import-remap), one
// layer below the action. They are refusals of the FILE, so they must cross the
// boundary as data too — before this they were thrown and reached the tech as
// the masked production error.
describe("importDataAction — dispute claim-total refusals come back as data", () => {
  const line = (id: string, claimedHours: number) => ({
    id,
    entryId: null,
    lineId: null,
    roNumber: "4411",
    code: "A1",
    workDate: "2026-08-03",
    flaggedHours: 3,
    paidHours: 0,
    claimedHours,
    recoveredHours: 0,
    hadPhoto: false,
    position: 0,
  });
  const claim = (claimedHours: number, asks: number[]) =>
    bundle({
      disputes: [
        {
          id: "D1",
          periodKey: "2026-08-01",
          periodLabel: "Aug 1–15",
          scope: "period",
          status: "open",
          claimedHours,
          recoveredHours: 0,
          lines: asks.map((a, k) => line(`L${k}`, a)),
        },
      ],
    });

  it.each<[string, Bundle, string]>([
    [
      "a negative claim-line ask",
      claim(2, [3, -1]),
      "This backup can't be restored: the dispute claim for Aug 1–15 has a line asking for -1.00h, and a claim line can't ask for negative hours. The file looks edited or damaged. Nothing was imported.",
    ],
    [
      "an itemized claim whose asks are all zero",
      claim(0, [0, 0]),
      "This backup can't be restored: the dispute claim for Aug 1–15 lists 2 lines but none of them asks for any hours. The file looks edited or damaged. Nothing was imported.",
    ],
    [
      "a header that disagrees with its lines",
      claim(5, [1, 2]),
      "This backup can't be restored: the dispute claim for Aug 1–15 says 5.00h but its lines add up to 3.00h. The file looks edited or damaged. Nothing was imported.",
    ],
  ])("refuses %s with its sentence and never calls the RPC", async (_l, b, msg) => {
    await expect(importDataAction(b)).resolves.toEqual({ error: msg });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("imports a claim whose lines agree with its header", async () => {
    await expect(importDataAction(claim(3, [1, 2]))).resolves.toEqual({});
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("still throws a genuine bug from payload building (only ImportRefusal becomes data)", async () => {
    buildOverride = () => {
      throw new TypeError("x is undefined");
    };
    await expect(importDataAction(bundle())).rejects.toThrow("x is undefined");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("importDataAction — optional sections", () => {
  it("imports a bundle with no dailyClocks key, sending no clock rows", async () => {
    const b = bundle();
    delete (b as { dailyClocks?: unknown }).dailyClocks;
    await expect(importDataAction(b)).resolves.toEqual({});
    expect(rpc).toHaveBeenCalledTimes(1);
    const [, args] = rpc.mock.calls[0] as [string, { payload: { daily_clock_hours: unknown[] } }];
    expect(args.payload.daily_clock_hours).toEqual([]);
  });
});
