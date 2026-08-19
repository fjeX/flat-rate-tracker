import { describe, it, expect } from "vitest";
import { deletePaidPeriod, getPaidPeriod, upsertPaidPeriod } from "./paid-periods";
import type { DbClient } from "./_client";

// ---------------------------------------------------------------------------
// Minimal in-memory fake of the slice of the Supabase query builder these three
// functions use. It applies `.eq()` filters FOR REAL — that is the entire point
// of this file. A fake that ignored filters would happily pass a delete missing
// its period_key, which is the one mistake here that costs the tech every paid
// figure they have ever entered (the PK is (user_id, period_key), so a delete
// filtered on user_id alone matches the whole account).
//
// Supported chains:
//   from(t).select("*").eq(c, v).eq(c, v).maybeSingle()
//   from(t).upsert(row, opts).select().single()
//   from(t).delete().eq(c, v)[.eq(c, v)]        (awaited directly)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Filter = { col: string; val: unknown };

class FakeStore {
  rows: Row[] = [];
}

class Builder {
  private filters: Filter[] = [];
  private op: "select" | "upsert" | "delete" = "select";
  private payload: Row | null = null;

  constructor(private store: FakeStore) {}

  select() {
    // On an upsert chain `.select()` only asks for the row back; it must not
    // reset the pending write.
    if (this.op !== "upsert") this.op = "select";
    return this;
  }

  upsert(row: Row) {
    this.op = "upsert";
    this.payload = row;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ col, val });
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => row[f.col] === f.val);
  }

  private run(): { data: unknown; error: null } {
    if (this.op === "delete") {
      const before = this.store.rows.length;
      this.store.rows = this.store.rows.filter((r) => !this.matches(r));
      return { data: { deleted: before - this.store.rows.length }, error: null };
    }
    if (this.op === "upsert") {
      const row = this.payload!;
      const i = this.store.rows.findIndex(
        (r) => r.user_id === row.user_id && r.period_key === row.period_key,
      );
      if (i === -1) this.store.rows.push({ ...row });
      else this.store.rows[i] = { ...this.store.rows[i], ...row };
      return { data: { ...row }, error: null };
    }
    const hit = this.store.rows.filter((r) => this.matches(r));
    return { data: hit[0] ?? null, error: null };
  }

  maybeSingle() {
    return Promise.resolve(this.run());
  }

  single() {
    return Promise.resolve(this.run());
  }

  // Awaiting the builder itself is how the delete chain terminates.
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

function seeded(): FakeStore {
  const store = new FakeStore();
  store.rows.push(
    { user_id: "user-1", period_key: "2026-07-P1", paid_flag_hours: 61.5 },
    { user_id: "user-1", period_key: "2026-07-P2", paid_flag_hours: 70 },
    { user_id: "user-1", period_key: "2026-08-P1", paid_flag_hours: 55.25 },
    // Another tech's row. RLS keeps it out of reach in production; here it also
    // proves the user_id filter is present in the query itself.
    { user_id: "user-2", period_key: "2026-07-P2", paid_flag_hours: 99 },
  );
  return store;
}

describe("deletePaidPeriod", () => {
  it("removes exactly the one period asked for", async () => {
    const store = seeded();
    await deletePaidPeriod(makeFakeDb(store), "2026-07-P2");

    expect(store.rows.map((r) => `${r.user_id}/${r.period_key}`)).toEqual([
      "user-1/2026-07-P1",
      "user-1/2026-08-P1",
      "user-2/2026-07-P2",
    ]);
  });

  // THE test in this file. Drop `.eq("period_key", periodKey)` from
  // deletePaidPeriod and the delete matches every row the user owns — the
  // assertion above still says "2026-07-P2 is gone", so it passes. Only
  // asserting on what SURVIVED catches it.
  it("does not touch the account's other periods", async () => {
    const store = seeded();
    await deletePaidPeriod(makeFakeDb(store), "2026-07-P2");

    const mine = store.rows.filter((r) => r.user_id === "user-1");
    expect(mine).toHaveLength(2);
    expect(mine.map((r) => r.period_key)).toEqual(["2026-07-P1", "2026-08-P1"]);
    expect(mine.map((r) => r.paid_flag_hours)).toEqual([61.5, 55.25]);
  });

  it("leaves another user's identical period_key alone", async () => {
    const store = seeded();
    await deletePaidPeriod(makeFakeDb(store), "2026-07-P2");

    expect(
      store.rows.filter((r) => r.user_id === "user-2"),
    ).toEqual([{ user_id: "user-2", period_key: "2026-07-P2", paid_flag_hours: 99 }]);
  });

  it("is a no-op when the period was never entered", async () => {
    const store = seeded();
    await deletePaidPeriod(makeFakeDb(store), "2026-09-P1");
    expect(store.rows).toHaveLength(4);
  });

  // The real point of the feature: getPaidPeriod reads the deleted period back
  // as null, which is what the UI treats as "awaiting pay" — a 0 would read as
  // "the shop paid zero hours", which is a different and much worse claim.
  it("returns the period to unset, not to zero", async () => {
    const store = seeded();
    const db = makeFakeDb(store);

    await upsertPaidPeriod(db, "2026-09-P1", 42);
    expect(await getPaidPeriod(db, "2026-09-P1")).toEqual({
      userId: "user-1",
      periodKey: "2026-09-P1",
      paidFlagHours: 42,
    });

    await deletePaidPeriod(db, "2026-09-P1");
    expect(await getPaidPeriod(db, "2026-09-P1")).toBeNull();
  });
});
