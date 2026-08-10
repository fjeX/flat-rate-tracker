/**
 * A stand-in for the Supabase server client, backed by the frozen fixture data.
 *
 * WHY HERE AND NOT AT THE DB LAYER
 * src/lib/db/ exports ~18 functions across 15 files, and every one takes the
 * client as its first argument — so wrapping "the db module" means wrapping 18
 * things. Worse, it would miss the auth calls: dashboard, pay-period,
 * dispute-pack and (app)/layout.tsx all call supabase.auth.getUser() directly,
 * never through db/. Gating db/ alone would leave every page hitting real auth
 * and redirecting to /signin, and the snapshots would be of the sign-in screen.
 *
 * createClient() is the one thing they all share. Swap what it returns and every
 * query and every auth check goes to fixtures, with zero changes to any route or
 * any db function.
 *
 * FIDELITY
 * This implements the slice of the PostgREST builder that db/ actually uses
 * (verified by inventory: from/select/eq/order/single/maybeSingle/filter/in/
 * range/lte/gte/match/limit/not, plus the write verbs). It is not a Postgres.
 * Filters are applied in JS against the fixture rows, which is enough for the
 * read paths the snapshot routes exercise. Writes are accepted and discarded —
 * the visual suite is read-only, and a canary that could write would be a
 * loaded gun pointed at prod.
 */
import { FIXTURE_EMAIL, FIXTURE_USER_ID, TABLES } from "./data";
import { FIXTURE_NOW_ISO } from "./enabled";

type Row = Record<string, unknown>;
type Result<T> = { data: T; error: null };

const ok = <T,>(data: T): Result<T> => ({ data, error: null });

/** Loose compare — fixture values are primitives, and PostgREST coerces too. */
const eq = (a: unknown, b: unknown) => String(a) === String(b);

class Query implements PromiseLike<Result<Row[]>> {
  private rows: Row[];
  /** Populated by the write verbs so insert().select().single() echoes back. */
  private written: Row[] | null = null;

  constructor(table: string) {
    // Unknown table → empty, never an error. See the note on TABLES in data.ts.
    this.rows = [...((TABLES[table] ?? []) as Row[])];
  }

  // ── shaping ───────────────────────────────────────────────────────────────
  // select() is a no-op: fixture rows are already stored in the shape the real
  // mappers expect, embedded relations included (see `entries` in data.ts).
  select() {
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    const dir = opts?.ascending === false ? -1 : 1;
    // Stable sort — chained .order() calls compose the way PostgREST's do.
    this.rows = [...this.rows].sort((a, b) => {
      const x = a[column];
      const y = b[column];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * dir;
    });
    return this;
  }

  limit(n: number) {
    this.rows = this.rows.slice(0, n);
    return this;
  }

  /** PostgREST range is inclusive on both ends. */
  range(from: number, to: number) {
    this.rows = this.rows.slice(from, to + 1);
    return this;
  }

  // ── filters ───────────────────────────────────────────────────────────────
  eq(column: string, value: unknown) {
    this.rows = this.rows.filter((r) => eq(r[column], value));
    return this;
  }

  neq(column: string, value: unknown) {
    this.rows = this.rows.filter((r) => !eq(r[column], value));
    return this;
  }

  gte(column: string, value: unknown) {
    this.rows = this.rows.filter((r) => (r[column] as never) >= (value as never));
    return this;
  }

  lte(column: string, value: unknown) {
    this.rows = this.rows.filter((r) => (r[column] as never) <= (value as never));
    return this;
  }

  gt(column: string, value: unknown) {
    this.rows = this.rows.filter((r) => (r[column] as never) > (value as never));
    return this;
  }

  lt(column: string, value: unknown) {
    this.rows = this.rows.filter((r) => (r[column] as never) < (value as never));
    return this;
  }

  in(column: string, values: unknown[]) {
    this.rows = this.rows.filter((r) => values.some((v) => eq(r[column], v)));
    return this;
  }

  is(column: string, value: unknown) {
    this.rows = this.rows.filter((r) => (r[column] ?? null) === value);
    return this;
  }

  match(criteria: Row) {
    for (const [k, v] of Object.entries(criteria)) this.eq(k, v);
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is") {
      this.rows = this.rows.filter((r) => (r[column] ?? null) !== value);
    } else {
      this.rows = this.rows.filter((r) => !eq(r[column], value));
    }
    return this;
  }

  /** Generic escape hatch: .filter(col, "gte", v) and friends. */
  filter(column: string, operator: string, value: unknown) {
    switch (operator) {
      case "eq": return this.eq(column, value);
      case "neq": return this.neq(column, value);
      case "gte": return this.gte(column, value);
      case "lte": return this.lte(column, value);
      case "gt": return this.gt(column, value);
      case "lt": return this.lt(column, value);
      case "in": return this.in(column, value as unknown[]);
      case "is": return this.is(column, value);
      default: return this;
    }
  }

  /** or() would need a PostgREST expression parser; nothing read-only uses it. */
  or() {
    return this;
  }

  // ── writes: accepted, never persisted ─────────────────────────────────────
  insert(payload: Row | Row[]) {
    this.written = Array.isArray(payload) ? payload : [payload];
    this.rows = this.written;
    return this;
  }

  upsert(payload: Row | Row[]) {
    return this.insert(payload);
  }

  update(payload: Row) {
    this.written = [payload];
    this.rows = [payload];
    return this;
  }

  delete() {
    this.written = [];
    this.rows = [];
    return this;
  }

  // ── terminators ───────────────────────────────────────────────────────────
  // Returning {data: null, error: null} rather than a PGRST116 error on empty:
  // callers do `if (error) throw error`, and a fixture gap should render an
  // empty state, not take down the page mid-snapshot.
  async single(): Promise<Result<Row | null>> {
    return ok(this.rows[0] ?? null);
  }

  async maybeSingle(): Promise<Result<Row | null>> {
    return ok(this.rows[0] ?? null);
  }

  then<R1 = Result<Row[]>, R2 = never>(
    onfulfilled?: ((value: Result<Row[]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(ok(this.rows)).then(onfulfilled, onrejected);
  }
}

const FIXTURE_USER = {
  id: FIXTURE_USER_ID,
  email: FIXTURE_EMAIL,
  // The header avatar and the dispute pack's tech name read these. Left blank
  // they render as an empty chip, which snapshots as a silent layout hole.
  user_metadata: { first_name: "Liem", last_name: "M", email: FIXTURE_EMAIL },
  app_metadata: {},
  aud: "authenticated",
  created_at: FIXTURE_NOW_ISO,
};

export function createFixtureClient() {
  return {
    from: (table: string) => new Query(table),
    rpc: async () => ok(null),
    auth: {
      getUser: async () => ok({ user: FIXTURE_USER }),
      getSession: async () => ok({ session: { user: FIXTURE_USER } }),
      signOut: async () => ({ error: null }),
    },
    storage: {
      from: () => ({
        list: async () => ok([]),
        createSignedUrl: async () => ok({ signedUrl: "" }),
        createSignedUrls: async () => ok([]),
        remove: async () => ok([]),
        upload: async () => ok({ path: "" }),
      }),
    },
  };
}
