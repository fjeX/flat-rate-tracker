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
