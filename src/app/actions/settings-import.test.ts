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
// The read-only ro_events head count importDataAction makes for a file with no
// `roEvents` key. Records the table and filter so a test can prove it is scoped.
const roEventsCount = vi.fn();
const fromCalls: { table: string; eq?: [string, unknown] }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => {
      const call: { table: string; eq?: [string, unknown] } = { table };
      fromCalls.push(call);
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            call.eq = [col, val];
            return roEventsCount();
          },
        }),
      };
    },
    storage: { from: () => ({ remove: (...a: unknown[]) => storageRemove(...a) }) },
  }),
}));
vi.mock("@/lib/db", () => ({
  getCurrentUserId: async () => "user-1",
  listAllUserPhotoPaths: (...a: unknown[]) => listAllUserPhotoPaths(...a),
  isMissingTable: (e: { code?: string }) => e?.code === "PGRST205" || e?.code === "42P01",
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
    paidPeriods: [],
    bonuses: [],
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
  roEventsCount.mockResolvedValue({ count: 0, error: null });
  fromCalls.length = 0;
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

// import_replace_account deletes these five tables UNCONDITIONALLY. An absent
// key used to become `[]` in the payload and wipe the account — while the
// confirm dialog called it "untouched". Liem's rule: refuse the file.
describe("importDataAction — core sections must be present", () => {
  const CORE: [string, string][] = [
    ["entries", "repair orders"],
    ["opCodes", "op codes"],
    ["dailyClocks", "daily clock records"],
    ["paidPeriods", "paid period records"],
    ["bonuses", "spiffs & bonuses"],
  ];
  const sentence = (label: string) =>
    `This backup is missing its ${label} section, so nothing was imported — your current data is unchanged.`;

  it.each(CORE)("refuses a bundle with no %s key, before the limiter, never calling the RPC", async (key, label) => {
    const b = bundle();
    delete (b as unknown as Record<string, unknown>)[key];
    await expect(importDataAction(b)).resolves.toEqual({ error: sentence(label) });
    expect(rpc).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(CORE)("refuses %s: null as missing", async (key, label) => {
    await expect(importDataAction(bundle({ [key]: null }))).resolves.toEqual({
      error: sentence(label),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("imports when every core key is an empty array, sending empty tables", async () => {
    await expect(importDataAction(bundle())).resolves.toEqual({});
    expect(rpc).toHaveBeenCalledTimes(1);
    const [, args] = rpc.mock.calls[0] as [string, { payload: Record<string, unknown> }];
    for (const t of ["entries", "op_codes", "daily_clock_hours", "paid_period_hours", "bonuses"]) {
      expect(args.payload[t], t).toEqual([]);
    }
  });

  it("still imports with every OPTIONAL key absent, and doesn't send those tables", async () => {
    await expect(importDataAction(bundle())).resolves.toEqual({});
    const [, args] = rpc.mock.calls[0] as [string, { payload: Record<string, unknown> }];
    for (const t of ["disputes", "unpaid_time", "labor_rates", "work_schedules", "days_off"]) {
      expect(args.payload, t).not.toHaveProperty(t);
    }
  });
});

describe("importDataAction — v1 predates spiffs", () => {
  it.each([["absent"], ["null"]])("a v1 file with bonuses %s imports and sends bonuses: []", async (how) => {
    const b = bundle({ version: 1 });
    if (how === "absent") delete (b as unknown as Record<string, unknown>).bonuses;
    else (b as unknown as Record<string, unknown>).bonuses = null;
    await expect(importDataAction(b)).resolves.toEqual({});
    const [, args] = rpc.mock.calls[0] as [string, { payload: { bonuses: unknown[] } }];
    expect(args.payload.bonuses).toEqual([]);
  });

  it.each([2, 3, 4, 5])("a v%i file without bonuses is still refused", async (version) => {
    const b = bundle({ version });
    delete (b as unknown as Record<string, unknown>).bonuses;
    await expect(importDataAction(b)).resolves.toEqual({
      error:
        "This backup is missing its spiffs & bonuses section, so nothing was imported — your current data is unchanged.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a v1 file without dailyClocks is still refused", async () => {
    const b = bundle({ version: 1 });
    delete (b as unknown as Record<string, unknown>).dailyClocks;
    await expect(importDataAction(b)).resolves.toEqual({
      error:
        "This backup is missing its daily clock records section, so nothing was imported — your current data is unchanged.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

// A refused file must not spend one of the tech's 5 imports/hour. Every check
// that reads only the file — shape, dates, the claim-total integrity checks in
// buildImportPayload — and the ticket-timeline refusal run before the limiter.
describe("importDataAction — refused files are refused for free", () => {
  it.each<[string, Bundle]>([
    ["a bad entry date", bundle({ entries: [{ date: "09/01/2026", roNumber: "4411" }] })],
    ["a bad clock date", bundle({ dailyClocks: [{ date: "yesterday" }] })],
    ["a bad bonus date", bundle({ bonuses: [{ date: "x" }] })],
    ["a bad unpaid-time date", bundle({ unpaidTime: [{ date: "x" }] })],
    [
      "a self-contradicting dispute claim",
      bundle({
        disputes: [
          {
            id: "D1",
            periodKey: "2026-08-01",
            claimedHours: 5,
            lines: [{ id: "L0", claimedHours: 1 }],
          },
        ],
      }),
    ],
    ["a nested shape the builder would crash on", bundle({ disputes: [{ id: "D1", lines: "abc" }] })],
  ])("%s never calls enforceRateLimit", async (_l, b) => {
    const res = await importDataAction(b);
    expect(res.error).toBeTruthy();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an accepted file does spend a slot, keyed to the signed-in user", async () => {
    await expect(importDataAction(bundle({ roEvents: [] }))).resolves.toEqual({});
    expect(enforceRateLimit).toHaveBeenCalledTimes(1);
    expect(enforceRateLimit.mock.calls[0][1]).toBe("user-1");
  });
});

// import-nested-shape-crashes-masked: these used to pass the schema and throw
// a TypeError inside buildImportPayload — masked in production.
describe("importDataAction — malformed nested shapes come back as a sentence", () => {
  it.each<[string, Bundle, string]>([
    ["disputes[].lines as a string", bundle({ disputes: [{ id: "D1", lines: "abc" }] }), "A dispute's lines must be a list."],
    ["opCodes[].subOpCodes holding null", bundle({ opCodes: [{ id: "O1", subOpCodes: [null] }] }), "An op code's variants must be a list of records."],
    ["entries[].opCodes as a number", bundle({ entries: [{ id: "E1", date: "2026-01-01", opCodes: 5 }] }), "An RO's op code lines must be a list."],
    ["confirmedZeroDays as a string", bundle({ confirmedZeroDays: "2026-01-01" }), "Confirmed zero days must be a list of dates."],
    ["roEvents holding null", bundle({ roEvents: [null] }), "Ticket timelines must be a list of records."],
    ["shiftOverrides as a number", bundle({ shiftOverrides: 5 }), "Shift overrides are malformed."],
  ])("%s", async (_l, b, msg) => {
    await expect(importDataAction(b)).resolves.toEqual({ error: msg });
    expect(rpc).not.toHaveBeenCalled();
  });
});

// import-dialog-undisclosed-deletes: import_replace_account (v6) deletes
// ro_events unconditionally and restores them only when the file carries the
// key. A pre-open-tickets file would erase every timeline. Liem's rule:
// refuse it when the account has any.
describe("importDataAction — a backup without ticket timelines can't erase the account's", () => {
  const sentence = (n: number, noun: string) =>
    `This backup is from before open tickets existed, and this account has ${n} ticket timeline ${noun} that importing it would erase, so nothing was imported. Export a fresh backup first, or import on an account without open tickets.`;

  it.each<[string, Bundle]>([
    ["absent", bundle()],
    ["absent on a v4 file", bundle({ version: 4 })],
  ])("refuses when roEvents is %s and the account has timelines", async (_l, b) => {
    roEventsCount.mockResolvedValue({ count: 7, error: null });
    await expect(importDataAction(b)).resolves.toEqual({ error: sentence(7, "events") });
    expect(rpc).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    // A read-only count on the right table, scoped to the signed-in user.
    expect(fromCalls).toEqual([{ table: "ro_events", eq: ["user_id", "user-1"] }]);
  });

  it("singular wording for one event", async () => {
    roEventsCount.mockResolvedValue({ count: 1, error: null });
    await expect(importDataAction(bundle())).resolves.toEqual({ error: sentence(1, "event") });
  });

  it("imports when the account has no timelines to lose", async () => {
    roEventsCount.mockResolvedValue({ count: 0, error: null });
    await expect(importDataAction(bundle())).resolves.toEqual({});
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("imports when the database predates the ro_events table", async () => {
    roEventsCount.mockResolvedValue({ count: null, error: { code: "PGRST205", message: "schema cache" } });
    await expect(importDataAction(bundle())).resolves.toEqual({});
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("still throws a genuine fault from the count", async () => {
    roEventsCount.mockResolvedValue({ count: null, error: { code: "08006", message: "connection lost" } });
    await expect(importDataAction(bundle())).rejects.toMatchObject({ code: "08006" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a file that carries roEvents (even empty) never asks — it replaces them", async () => {
    roEventsCount.mockResolvedValue({ count: 7, error: null });
    await expect(importDataAction(bundle({ roEvents: [] }))).resolves.toEqual({});
    expect(fromCalls).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
