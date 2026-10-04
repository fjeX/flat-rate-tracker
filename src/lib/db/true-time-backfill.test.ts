// The db half of the backfill: chunked replace and the atomic claim.
import { describe, it, expect, vi } from "vitest";
import {
  claimLaborTimeBackfill,
  clearAllLaborTimeObservations,
  completeLaborTimeBackfill,
  resetLaborTimeBackfill,
  replaceAllLaborTimeObservations,
} from "./true-time";
import type { DbClient } from "./_client";
import type { NewLaborTimeObservation } from "@/lib/true-time";

vi.mock("@/lib/report-error-server", () => ({ reportServerError: async () => undefined }));

function obs(i: number): NewLaborTimeObservation {
  return {
    entryId: `e${i}`,
    lineId: `l${i}`,
    codeNorm: "BRK",
    makeNorm: "",
    modelNorm: "",
    vehicleYear: null,
    flagHours: 1,
    actualHours: 1,
    observedMonth: "2026-09-01",
    source: "measured",
  };
}

function fakeDb(opts: { claimRows?: unknown[]; claimError?: unknown } = {}) {
  const inserts: unknown[][] = [];
  const calls: string[] = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from(table: string) {
      const b = {
        delete: () => {
          calls.push(`delete:${table}`);
          return b;
        },
        insert: async (rows: unknown[]) => {
          inserts.push(rows);
          return { error: null };
        },
        update: () => {
          calls.push(`update:${table}`);
          return b;
        },
        eq: () => b,
        is: () => {
          calls.push("is-null");
          return b;
        },
        or: () => b,
        select: async () => ({ data: opts.claimRows ?? [], error: opts.claimError ?? null }),
        then: (res: (v: unknown) => void) => res({ error: null }),
      };
      return b;
    },
  };
  return { db: db as unknown as DbClient, inserts, calls };
}

describe("replaceAllLaborTimeObservations", () => {
  it("deletes first, then inserts in chunks of 500 with the source column", async () => {
    const { db, inserts, calls } = fakeDb();
    await replaceAllLaborTimeObservations(db, Array.from({ length: 1100 }, (_, i) => obs(i)));
    expect(calls[0]).toBe("delete:labor_time_observations");
    expect(inserts.map((r) => r.length)).toEqual([500, 500, 100]);
    expect((inserts[0][0] as { source: string }).source).toBe("measured");
  });
});

// A stateful user_settings row so the lease semantics are exercised, not mocked.
function leaseDb(row: { done: string | null; started: string | null }) {
  const writes: Record<string, unknown>[] = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from() {
      let payload: Record<string, unknown> = {};
      let needDoneNull = false;
      let cutoff: string | null = null;
      const b = {
        update: (p: Record<string, unknown>) => {
          payload = p;
          return b;
        },
        delete: () => b,
        eq: () => b,
        is: () => {
          needDoneNull = true;
          return b;
        },
        or: (expr: string) => {
          cutoff = expr.split(".lt.")[1];
          return b;
        },
        select: async () => {
          const leaseFree = row.started === null || (cutoff !== null && row.started < cutoff);
          if ((needDoneNull && row.done !== null) || !leaseFree) return { data: [], error: null };
          writes.push(payload);
          row.started = payload.true_time_backfill_started_at as string;
          return { data: [{ user_id: "u1" }], error: null };
        },
        then: (res: (v: unknown) => void) => {
          writes.push(payload);
          if ("true_time_backfilled_at" in payload) row.done = payload.true_time_backfilled_at as string | null;
          if ("true_time_backfill_started_at" in payload) row.started = payload.true_time_backfill_started_at as string | null;
          res({ error: null });
        },
      };
      return b;
    },
  };
  return { db: db as unknown as DbClient, row, writes };
}

describe("claimLaborTimeBackfill (lease)", () => {
  const t0 = new Date("2026-10-04T12:00:00Z");
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);

  it("wins on a fresh account and takes the lease", async () => {
    const { db, row } = leaseDb({ done: null, started: null });
    expect(await claimLaborTimeBackfill(db, t0)).toBe(true);
    expect(row.started).toBe(t0.toISOString());
  });

  it("blocks a second runner inside 15 minutes", async () => {
    const { db } = leaseDb({ done: null, started: null });
    expect(await claimLaborTimeBackfill(db, t0)).toBe(true);
    expect(await claimLaborTimeBackfill(db, at(14))).toBe(false);
  });

  it("allows a takeover once the lease has expired", async () => {
    const { db, row } = leaseDb({ done: null, started: null });
    await claimLaborTimeBackfill(db, t0);
    expect(await claimLaborTimeBackfill(db, at(16))).toBe(true);
    expect(row.started).toBe(at(16).toISOString());
  });

  it("never claims once the backfill is done", async () => {
    const { db } = leaseDb({ done: t0.toISOString(), started: null });
    expect(await claimLaborTimeBackfill(db, at(60))).toBe(false);
  });

  it("answers false on a pre-migration DB (missing column)", async () => {
    const { db } = fakeDb({ claimError: { code: "42703", message: "column does not exist" } });
    expect(await claimLaborTimeBackfill(db)).toBe(false);
  });
});

describe("complete / reset", () => {
  it("success sets done and clears the lease", async () => {
    const { db, row } = leaseDb({ done: null, started: "2026-10-04T12:00:00.000Z" });
    await completeLaborTimeBackfill(db);
    expect(row.done).not.toBeNull();
    expect(row.started).toBeNull();
  });

  it("reset nulls BOTH columns (opt-out / import)", async () => {
    const { db, row } = leaseDb({ done: "2026-10-04T12:00:00.000Z", started: "2026-10-04T11:59:00.000Z" });
    await resetLaborTimeBackfill(db);
    expect(row.done).toBeNull();
    expect(row.started).toBeNull();
  });

  it("clearAllLaborTimeObservations resets both columns too", async () => {
    const { db, row } = leaseDb({ done: "x", started: "y" });
    await clearAllLaborTimeObservations(db);
    expect(row.done).toBeNull();
    expect(row.started).toBeNull();
  });
});

// ---- syncEntryLaborTimeObservations consent recheck ----
import { syncEntryLaborTimeObservations } from "./true-time";

function syncDb(shareAfterInsert: boolean) {
  const calls: string[] = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from(table: string) {
      const b = {
        delete: () => {
          calls.push(`delete:${table}`);
          return b;
        },
        insert: async () => {
          calls.push(`insert:${table}`);
          return { error: null };
        },
        update: () => b,
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({
          data: { user_id: "u1", share_labor_times: shareAfterInsert },
          error: null,
        }),
        then: (res: (v: unknown) => void) => res({ error: null }),
      };
      return b;
    },
  };
  return { db: db as unknown as DbClient, calls };
}

describe("syncEntryLaborTimeObservations consent recheck", () => {
  it("purges everything when consent was revoked during the write", async () => {
    const { db, calls } = syncDb(false);
    expect(await syncEntryLaborTimeObservations(db, "e1", [obs(1)], true)).toBe(true);
    const insertAt = calls.indexOf("insert:labor_time_observations");
    expect(insertAt).toBeGreaterThan(-1);
    // a delete of the whole user's rows follows the insert
    expect(calls.slice(insertAt + 1)).toContain("delete:labor_time_observations");
  });

  it("keeps the rows when the recheck still reads consent", async () => {
    const { db, calls } = syncDb(true);
    await syncEntryLaborTimeObservations(db, "e1", [obs(1)], true);
    const insertAt = calls.indexOf("insert:labor_time_observations");
    expect(calls.slice(insertAt + 1)).not.toContain("delete:labor_time_observations");
  });
});
