import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Entry, EntryOpCode } from "./types";

const LINE = "11111111-1111-4111-8111-111111111111";
const ENTRY = "22222222-2222-4222-8222-222222222222";

let entryIdForLine: string | null = ENTRY;
let entry: Entry | null = null;
const getEntryIdForLine = vi.fn(async (...a: unknown[]) => (void a, entryIdForLine));
const getEntry = vi.fn(async (...a: unknown[]) => (void a, entry));
vi.mock("@/lib/db", () => ({
  getEntryIdForLine: (...a: unknown[]) => getEntryIdForLine(...a),
  getEntry: (...a: unknown[]) => getEntry(...a),
}));

import { resolveLightAsk } from "./light-ask";

function mkLine(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: LINE,
    opCodeId: null,
    custom: true,
    customCode: "ALIGN",
    customDescription: "Alignment",
    flagHours: 1.5,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    paidHours: null,
    ...over,
  };
}
function mkEntry(lines: EntryOpCode[]): Entry {
  return {
    id: ENTRY,
    userId: "u",
    createdAt: "",
    updatedAt: "",
    date: "2026-10-04",
    roNumber: "1",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: lines,
    flagHours: 1.5,
    notes: "",
  };
}

const client = {} as never;
const opts = { optedIn: true, library: [] };

beforeEach(() => {
  vi.clearAllMocks();
  entryIdForLine = ENTRY;
  entry = mkEntry([mkLine()]);
});

describe("resolveLightAsk (the dashboard's server-side re-check)", () => {
  it("resolves an eligible line of the signed-in user's own", async () => {
    const out = await resolveLightAsk(client, LINE, opts);
    expect(out?.lineId).toBe(LINE);
    expect(out?.code).toBe("ALIGN");
    expect(out?.chips.length).toBeLessThanOrEqual(6);
  });

  it("renders nothing for a line that is already timed", async () => {
    entry = mkEntry([mkLine({ actualHours: 1.2 })]);
    expect(await resolveLightAsk(client, LINE, opts)).toBeNull();
  });

  it("renders nothing for a comeback, or a line outside 1-2h", async () => {
    entry = mkEntry([mkLine({ isComeback: true })]);
    expect(await resolveLightAsk(client, LINE, opts)).toBeNull();
    entry = mkEntry([mkLine({ flagHours: 0.9 })]);
    expect(await resolveLightAsk(client, LINE, opts)).toBeNull();
    entry = mkEntry([mkLine({ flagHours: 2 })]);
    expect(await resolveLightAsk(client, LINE, opts)).toBeNull();
  });

  it("renders nothing for another user's line id (RLS hides the row)", async () => {
    entryIdForLine = null;
    expect(await resolveLightAsk(client, LINE, opts)).toBeNull();
    expect(getEntry).not.toHaveBeenCalled();
    // ...and when the line is visible but the entry is not.
    entryIdForLine = ENTRY;
    entry = null;
    expect(await resolveLightAsk(client, LINE, opts)).toBeNull();
  });

  it("renders nothing when the id is not on the entry it names", async () => {
    entry = mkEntry([mkLine({ id: "33333333-3333-4333-8333-333333333333" })]);
    expect(await resolveLightAsk(client, LINE, opts)).toBeNull();
  });

  it("renders nothing, and never queries, when not opted in", async () => {
    expect(await resolveLightAsk(client, LINE, { ...opts, optedIn: false })).toBeNull();
    expect(getEntryIdForLine).not.toHaveBeenCalled();
  });

  it("renders nothing without the param, with a repeated param, or a malformed id", async () => {
    expect(await resolveLightAsk(client, undefined, opts)).toBeNull();
    expect(await resolveLightAsk(client, [LINE, LINE], opts)).toBeNull();
    expect(await resolveLightAsk(client, "71845", opts)).toBeNull();
    expect(getEntryIdForLine).not.toHaveBeenCalled();
  });

  it("a database error is silence, not a 500", async () => {
    getEntryIdForLine.mockRejectedValueOnce(new Error("boom"));
    expect(await resolveLightAsk(client, LINE, opts)).toBeNull();
  });
});
