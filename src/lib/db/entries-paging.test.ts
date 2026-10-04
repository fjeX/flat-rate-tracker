import { describe, it, expect } from "vitest";
import { listEntries } from "./entries";
import type { DbClient } from "./_client";

// A fake of the one chain listEntries issues, with PostgREST's max_rows cap
// built in: whatever range is asked for, at most MAX_ROWS rows come back and no
// error is raised. That silent cap is the whole bug — an unpaged read of an
// account past 1000 ROs used to come back short.
const MAX_ROWS = 1000;

function fakeDb(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `e${String(i).padStart(5, "0")}`,
    user_id: "u",
    date: "2026-01-01",
    ro_number: String(i),
    flag_hours: 1,
    notes: "",
    vehicle_year: "",
    vehicle_make: "",
    vehicle_model: "",
    vehicle_vin: "",
    vehicle_mileage: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    entry_op_codes: [],
  }));
  const ranges: Array<[number, number]> = [];
  const builder = {
    from: () => builder,
    select: () => builder,
    order: () => builder,
    gte: () => builder,
    lte: () => builder,
    range(from: number, to: number) {
      ranges.push([from, to]);
      const end = Math.min(to + 1, from + MAX_ROWS);
      return Promise.resolve({ data: rows.slice(from, end), error: null });
    },
  };
  return { db: builder as unknown as DbClient, ranges };
}

describe("listEntries without a limit reads past PostgREST's max_rows", () => {
  it("returns all 2350 rows, not the first 1000", async () => {
    const { db, ranges } = fakeDb(2350);
    const out = await listEntries(db);
    expect(out).toHaveLength(2350);
    expect(new Set(out.map((e) => e.id)).size).toBe(2350);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("an exact multiple of the page size ends on the empty page", async () => {
    const { db } = fakeDb(2000);
    expect(await listEntries(db)).toHaveLength(2000);
  });

  it("an explicit limit is still one request", async () => {
    const { db, ranges } = fakeDb(2350);
    expect(await listEntries(db, { limit: 100, offset: 200 })).toHaveLength(100);
    expect(ranges).toEqual([[200, 299]]);
  });
});
