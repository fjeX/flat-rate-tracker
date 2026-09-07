// updateBonus / deleteBonus — the two write paths that can reach ONE spiff row.
//
// This is the dollar ledger. Three properties, and every one of them was absent
// before 2026-09-07:
//
//   1. They touch the row asked for, BY PRIMARY KEY. Spiffs are not
//      distinguishable by value — two $25 "spiff" rows on the same date are
//      routine — so a write phrased as a predicate over amount/date/category
//      cannot be told apart from the right one, and destroys money the tech is
//      about to reconcile against a paystub.
//
//   2. They cannot reach another account's row. RLS (`own_bonuses`) is the
//      production guard, but a policy in a migration is not something a unit
//      test can see; the `user_id` filter is in the functions' own SQL so the
//      guarantee is testable and does not rest on one layer alone.
//
//   3. They can tell "row changed" from "matched nothing". Without `.select()`
//      PostgREST returns no rows on either, and a no-op reported as success is
//      how "it worked, the screen just didn't repaint" gets believed about
//      money — the $35 spiff lost in August had no audit trail to argue with.
//
// The fake below applies `.eq()` filters FOR REAL and records the exact filter
// list, so a missing filter *or an extra one* fails rather than passing quietly.
// It also refuses to return rows from a write that never called `.select()`,
// which is what makes property 3 mutation-testable.
import { describe, it, expect } from "vitest";
import { updateBonus, deleteBonus } from "./bonuses";
import type { DbClient } from "./_client";

type Row = Record<string, unknown>;
type Filter = { col: string; val: unknown };

class FakeStore {
  rows: Row[] = [];
  /** Filter list of the last query issued, in call order. */
  lastFilters: Filter[] = [];
  /** How many queries reached the "database" at all. */
  queries = 0;
}

class Builder {
  private filters: Filter[] = [];
  private op: "select" | "update" | "delete" = "select";
  private patch: Row = {};
  private selected = false;

  constructor(private store: FakeStore) {}

  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  // On a write chain `.select()` only asks for the affected rows back; it must
  // not turn the write into a read. Recording that it was called is the point:
  // PostgREST hands back nothing without it, and the function must not then
  // claim a row was touched.
  select() {
    this.selected = true;
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
    this.store.queries += 1;
    this.store.lastFilters = this.filters;

    if (this.op === "delete") {
      const hit = this.store.rows.filter((r) => this.matches(r));
      this.store.rows = this.store.rows.filter((r) => !this.matches(r));
      return { data: this.selected ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    if (this.op === "update") {
      const hit: Row[] = [];
      this.store.rows = this.store.rows.map((r) => {
        if (!this.matches(r)) return r;
        const next = { ...r, ...this.patch };
        hit.push(next);
        return next;
      });
      return { data: this.selected ? hit : null, error: null };
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

type AuthState =
  | { kind: "signed-in"; userId: string }
  | { kind: "signed-out" }
  | { kind: "auth-error" };

function makeFakeDb(store: FakeStore, auth: AuthState = { kind: "signed-in", userId: "user-1" }): DbClient {
  const client = {
    from() {
      return new Builder(store);
    },
    auth: {
      getUser: () => {
        // Mirrors getCurrentUserId's actual contract in _client.ts: it throws
        // the auth error if there is one, throws "Not authenticated" when the
        // session is empty, and only otherwise returns an id.
        if (auth.kind === "auth-error") {
          return Promise.resolve({
            data: { user: null },
            error: { name: "AuthApiError", message: "session missing" },
          });
        }
        if (auth.kind === "signed-out") {
          return Promise.resolve({ data: { user: null }, error: null });
        }
        return Promise.resolve({ data: { user: { id: auth.userId } }, error: null });
      },
    },
  };
  return client as unknown as DbClient;
}

const MINE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const MINE_B = "aaaaaaaa-0000-4000-8000-000000000002";
const MINE_C = "aaaaaaaa-0000-4000-8000-000000000003";
const THEIRS = "bbbbbbbb-0000-4000-8000-000000000001";
const GONE = "cccccccc-0000-4000-8000-000000000009";

function row(id: string, userId: string, over: Row = {}): Row {
  return {
    id,
    user_id: userId,
    date: "2026-08-14",
    amount: "25.00",
    category: "spiff",
    source: "Service manager",
    note: null,
    entry_id: null,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    ...over,
  };
}

function seeded(): FakeStore {
  const store = new FakeStore();
  store.rows.push(
    // MINE_A and MINE_B are byte-identical apart from the id: same date, same
    // $25, same category, same source. That is a normal week — nothing but the
    // id can tell one spiff from the other.
    row(MINE_A, "user-1"),
    row(MINE_B, "user-1"),
    row(MINE_C, "user-1", { date: "2026-08-15", amount: "35.00" }),
    // Another tech's row. RLS keeps it out of reach in production; here it
    // proves the user_id filter is present in the query itself.
    row(THEIRS, "user-2"),
  );
  return store;
}

const ids = (store: FakeStore) => store.rows.map((r) => r.id);
const find = (store: FakeStore, id: string) => store.rows.find((r) => r.id === id);

describe("deleteBonus", () => {
  it("filters on BOTH id and user_id, and on nothing else", async () => {
    const store = seeded();
    await deleteBonus(makeFakeDb(store), MINE_A);
    // Full argument list on purpose: a missing filter and a surplus filter are
    // both failures, and toEqual catches either.
    expect(store.lastFilters).toEqual([
      { col: "id", val: MINE_A },
      { col: "user_id", val: "user-1" },
    ]);
  });

  it("removes exactly the one row asked for, and reports it deleted", async () => {
    const store = seeded();
    await expect(deleteBonus(makeFakeDb(store), MINE_A)).resolves.toBe(true);
    expect(ids(store)).toEqual([MINE_B, MINE_C, THEIRS]);
  });

  // THE test in this file. Drop `.eq("id", id)` and the delete takes every row
  // the account owns — the assertion above still says "MINE_A is gone", so it
  // passes. Only asserting on what SURVIVED catches it.
  it("leaves the account's other rows alone, including its identical twin", async () => {
    const store = seeded();
    await deleteBonus(makeFakeDb(store), MINE_A);
    expect(find(store, MINE_B)).toBeDefined();
    expect(store.rows).toHaveLength(3);
  });

  it("cannot delete another user's row, and says so rather than lying", async () => {
    const store = seeded();
    await expect(deleteBonus(makeFakeDb(store), THEIRS)).resolves.toBe(false);
    expect(ids(store)).toEqual([MINE_A, MINE_B, MINE_C, THEIRS]);
  });

  it("reports false for a row that is already gone", async () => {
    const store = seeded();
    await expect(deleteBonus(makeFakeDb(store), GONE)).resolves.toBe(false);
    expect(store.rows).toHaveLength(4);
  });

  it("scopes to the signed-in user, whoever that is", async () => {
    const store = seeded();
    const theirs = makeFakeDb(store, { kind: "signed-in", userId: "user-2" });
    await expect(deleteBonus(theirs, THEIRS)).resolves.toBe(true);
    expect(ids(store)).toEqual([MINE_A, MINE_B, MINE_C]);
    await expect(deleteBonus(theirs, MINE_A)).resolves.toBe(false);
    expect(ids(store)).toEqual([MINE_A, MINE_B, MINE_C]);
  });

  // getCurrentUserId THROWS on a missing session — it never returns undefined —
  // so a signed-out delete must reject before any SQL is built. If it were ever
  // allowed to proceed, `.eq("user_id", undefined)` is a filter PostgREST does
  // not honour the way this code assumes.
  it("rejects when signed out, without issuing a query", async () => {
    const store = seeded();
    await expect(
      deleteBonus(makeFakeDb(store, { kind: "signed-out" }), MINE_A),
    ).rejects.toThrow("Not authenticated");
    expect(store.queries).toBe(0);
    expect(store.rows).toHaveLength(4);
  });

  it("rethrows an auth error rather than deleting", async () => {
    const store = seeded();
    await expect(
      deleteBonus(makeFakeDb(store, { kind: "auth-error" }), MINE_A),
    ).rejects.toMatchObject({ message: "session missing" });
    expect(store.queries).toBe(0);
    expect(store.rows).toHaveLength(4);
  });
});

describe("updateBonus", () => {
  it("filters on BOTH id and user_id, and on nothing else", async () => {
    const store = seeded();
    await updateBonus(makeFakeDb(store), MINE_A, { amount: 40 });
    expect(store.lastFilters).toEqual([
      { col: "id", val: MINE_A },
      { col: "user_id", val: "user-1" },
    ]);
  });

  it("patches the one row asked for and returns it", async () => {
    const store = seeded();
    const saved = await updateBonus(makeFakeDb(store), MINE_A, { amount: 40 });
    expect(saved).toMatchObject({ id: MINE_A, amount: 40 });
    expect(find(store, MINE_A)).toMatchObject({ amount: 40 });
  });

  // Same shape as the delete case: without the id filter the patch lands on
  // every row the account owns, and the assertion above is still green.
  it("leaves the account's other rows alone, including its identical twin", async () => {
    const store = seeded();
    await updateBonus(makeFakeDb(store), MINE_A, { amount: 40 });
    expect(find(store, MINE_B)).toMatchObject({ amount: "25.00" });
    expect(find(store, MINE_C)).toMatchObject({ amount: "35.00" });
  });

  it("cannot patch another user's row, and returns null rather than lying", async () => {
    const store = seeded();
    await expect(
      updateBonus(makeFakeDb(store), THEIRS, { amount: 999 }),
    ).resolves.toBeNull();
    expect(find(store, THEIRS)).toMatchObject({ amount: "25.00" });
  });

  it("returns null for a row that is already gone", async () => {
    const store = seeded();
    await expect(
      updateBonus(makeFakeDb(store), GONE, { amount: 40 }),
    ).resolves.toBeNull();
    expect(store.rows).toHaveLength(4);
  });

  it("scopes to the signed-in user, whoever that is", async () => {
    const store = seeded();
    const theirs = makeFakeDb(store, { kind: "signed-in", userId: "user-2" });
    await expect(
      updateBonus(theirs, THEIRS, { amount: 60 }),
    ).resolves.toMatchObject({ id: THEIRS, amount: 60 });
    await expect(updateBonus(theirs, MINE_A, { amount: 60 })).resolves.toBeNull();
    expect(find(store, MINE_A)).toMatchObject({ amount: "25.00" });
  });

  it("rejects when signed out, without issuing a query", async () => {
    const store = seeded();
    await expect(
      updateBonus(makeFakeDb(store, { kind: "signed-out" }), MINE_A, { amount: 40 }),
    ).rejects.toThrow("Not authenticated");
    expect(store.queries).toBe(0);
    expect(find(store, MINE_A)).toMatchObject({ amount: "25.00" });
  });

  it("rethrows an auth error rather than patching", async () => {
    const store = seeded();
    await expect(
      updateBonus(makeFakeDb(store, { kind: "auth-error" }), MINE_A, { amount: 40 }),
    ).rejects.toMatchObject({ message: "session missing" });
    expect(store.queries).toBe(0);
    expect(find(store, MINE_A)).toMatchObject({ amount: "25.00" });
  });
});
