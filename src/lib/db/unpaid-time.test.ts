// deleteUnpaidTime — the first and only way to remove ONE unpaid-time row.
//
// Two properties, and the second is the reason this file exists:
//
//   1. It deletes the row asked for, by PRIMARY KEY. Not by hours, not by date,
//      not by kind. msToHours quantises to hundredths, so a stored 0.01h covers
//      18s–54s of real hold time and the 30s ledger gate sits INSIDE that band:
//      a genuine 30–54s rework and an old pre-gate phantom are the same number.
//      Any predicate over `hours` destroys real rework a tech is about to hand a
//      service manager.
//
//   2. It cannot reach another account's row. RLS (`own_unpaid_time`) is the
//      production guard, but a policy in a migration is not something a unit
//      test can see; the `user_id` filter is in this function's own SQL so the
//      guarantee is testable and does not depend on one layer alone.
//
// The fake below applies `.eq()` filters FOR REAL — a fake that ignored them
// would pass a delete missing its id filter, which would wipe the account's
// whole ledger.
import { describe, it, expect } from "vitest";
import { deleteUnpaidTime } from "./unpaid-time";
import type { DbClient } from "./_client";

type Row = Record<string, unknown>;
type Filter = { col: string; val: unknown };

class FakeStore {
  rows: Row[] = [];
}

class Builder {
  private filters: Filter[] = [];
  private op: "select" | "delete" = "select";

  constructor(private store: FakeStore) {}

  delete() {
    this.op = "delete";
    return this;
  }

  // On a delete chain `.select()` only asks for the deleted rows back; it must
  // not turn the write into a read.
  select() {
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ col, val });
    return this;
  }

  private matches(row: Row): boolean {
    // An unfiltered chain matching everything is the failure this whole file is
    // about, so make it loud rather than letting `every` return true on [].
    if (this.filters.length === 0) throw new Error("unfiltered query");
    return this.filters.every((f) => row[f.col] === f.val);
  }

  private run(): { data: unknown; error: null } {
    if (this.op === "delete") {
      const hit = this.store.rows.filter((r) => this.matches(r));
      this.store.rows = this.store.rows.filter((r) => !this.matches(r));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    return { data: this.store.rows.filter((r) => this.matches(r)), error: null };
  }

  then<T1 = unknown, T2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => T1 | PromiseLike<T1>)
      | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

function makeFakeDb(store: FakeStore, userId = "user-1"): DbClient {
  const client = {
    from() {
      return new Builder(store);
    },
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: userId } }, error: null }),
    },
  };
  return client as unknown as DbClient;
}

const MINE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const MINE_B = "aaaaaaaa-0000-4000-8000-000000000002";
const MINE_C = "aaaaaaaa-0000-4000-8000-000000000003";
const THEIRS = "bbbbbbbb-0000-4000-8000-000000000001";

function seeded(): FakeStore {
  const store = new FakeStore();
  store.rows.push(
    // Three rows of MINE that share a date and an hours value. This is the
    // 0.01h band: 30s of real rework and a pre-gate phantom are stored
    // identically, so nothing but the id can tell these apart.
    { id: MINE_A, user_id: "user-1", date: "2026-08-14", hours: 0.01, kind: "shop_time" },
    { id: MINE_B, user_id: "user-1", date: "2026-08-14", hours: 0.01, kind: "shop_time" },
    { id: MINE_C, user_id: "user-1", date: "2026-08-15", hours: 3.3, kind: "wait_parts" },
    // Another tech's row. RLS keeps it out of reach in production; here it
    // proves the user_id filter is present in the query itself.
    { id: THEIRS, user_id: "user-2", date: "2026-08-14", hours: 0.01, kind: "shop_time" },
  );
  return store;
}

const ids = (store: FakeStore) => store.rows.map((r) => r.id);

describe("deleteUnpaidTime", () => {
  it("removes exactly the one row asked for, and reports it deleted", async () => {
    const store = seeded();
    await expect(deleteUnpaidTime(makeFakeDb(store), MINE_A)).resolves.toBe(true);
    expect(ids(store)).toEqual([MINE_B, MINE_C, THEIRS]);
  });

  // THE test in this file. Drop `.eq("id", id)` and the delete takes every row
  // the account owns — the assertion above still says "MINE_A is gone", so it
  // passes. Only asserting on what SURVIVED catches it.
  it("leaves the account's other rows alone, including its identical twin", async () => {
    const store = seeded();
    await deleteUnpaidTime(makeFakeDb(store), MINE_A);

    // MINE_B has the same date, hours and kind as the row just deleted. If the
    // delete were ever phrased as a value predicate, this row would be gone too
    // — and it may be the real 30s comeback rather than the phantom.
    expect(store.rows.find((r) => r.id === MINE_B)).toBeDefined();
    expect(store.rows).toHaveLength(3);
  });

  it("cannot delete another user's row, and says so rather than lying", async () => {
    const store = seeded();
    // A real uuid, a real row — just not this account's.
    await expect(deleteUnpaidTime(makeFakeDb(store), THEIRS)).resolves.toBe(false);
    expect(ids(store)).toEqual([MINE_A, MINE_B, MINE_C, THEIRS]);
  });

  it("reports false for a row that is already gone", async () => {
    const store = seeded();
    await expect(
      deleteUnpaidTime(makeFakeDb(store), "cccccccc-0000-4000-8000-000000000009"),
    ).resolves.toBe(false);
    expect(store.rows).toHaveLength(4);
  });

  it("scopes to the signed-in user, whoever that is", async () => {
    // Same store, the OTHER account signed in: now their row goes and mine stay.
    const store = seeded();
    await expect(
      deleteUnpaidTime(makeFakeDb(store, "user-2"), THEIRS),
    ).resolves.toBe(true);
    expect(ids(store)).toEqual([MINE_A, MINE_B, MINE_C]);

    await expect(
      deleteUnpaidTime(makeFakeDb(store, "user-2"), MINE_A),
    ).resolves.toBe(false);
    expect(ids(store)).toEqual([MINE_A, MINE_B, MINE_C]);
  });
});
