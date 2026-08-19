import { describe, it, expect, vi, afterEach } from "vitest";
import { listEntryIdsWithPhotos } from "./entry-photos";
import { listBonuses } from "./bonuses";
import { listAllBugReports, isCurrentUserAdmin } from "./bug-reports";
import type { DbClient } from "./_client";

/**
 * Every read here sits in the top-level `Promise.all` of an authenticated
 * server render, with nothing between it and the RSC boundary. A PGRST303
 * rejects the whole render into (app)/error.tsx — the "App crashed" screen the
 * jwt-clock-skew escalation reported.
 *
 * Two earlier rounds of that fix each audited one layer and missed these:
 * round 1 covered dashboard/page.tsx, round 2 covered the (app) layout. These
 * live on /history, /pay-period, the dispute pack and /admin/bugs. The point of
 * driving the READ rather than the retry helper is that the helper's own tests
 * pass whether or not anything calls it.
 */

// Verbatim from the FRT production app log, `docker compose logs app`.
const PGRST303 = {
  code: "PGRST303",
  details: null,
  hint: null,
  message: "JWT issued at future",
};

/** Fails the first `failures` attempts, then returns `rows`. */
function flaky(failures: number, rows: unknown[], err: unknown = PGRST303) {
  let attempts = 0;
  const result = () => {
    attempts++;
    return attempts <= failures
      ? Promise.resolve({ data: null, error: err })
      : Promise.resolve({ data: rows, error: null });
  };
  // Each read uses a different builder tail, so every link is thenable AND
  // chainable rather than modelling one specific chain.
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.order = () => node;
  node.eq = () => node;
  node.maybeSingle = () => result();
  node.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    result().then(res, rej);
  const client = {
    from: () => node,
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  };
  return { client: client as unknown as DbClient, attempts: () => attempts };
}

afterEach(() => vi.useRealTimers());

async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const p = run();
  await vi.runAllTimersAsync();
  return p;
}

describe("reads on an authenticated render path retry PGRST303", () => {
  it("listEntryIdsWithPhotos — /history, /pay-period, dispute pack", async () => {
    const { client, attempts } = flaky(1, [{ entry_id: "e1" }, { entry_id: "e1" }]);
    const ids = await withFakeTimers(() => listEntryIdsWithPhotos(client));
    expect(attempts()).toBe(2);
    expect(ids).toEqual(["e1"]);
  });

  it("listBonuses — /pay-period", async () => {
    const { client, attempts } = flaky(1, []);
    const rows = await withFakeTimers(() => listBonuses(client));
    expect(attempts()).toBe(2);
    expect(rows).toEqual([]);
  });

  it("listAllBugReports — /admin/bugs", async () => {
    const { client, attempts } = flaky(1, []);
    const rows = await withFakeTimers(() => listAllBugReports(client));
    expect(attempts()).toBe(2);
    expect(rows).toEqual([]);
  });

  it("isCurrentUserAdmin retries before it fails closed", async () => {
    // Failing closed is correct for a missing column; it is wrong for a
    // transient token blip, because (app)/admin/layout.tsx turns `false` into
    // notFound() — a real admin gets a 404 on the whole /admin tree.
    const { client, attempts } = flaky(1, { is_admin: true } as never);
    const isAdmin = await withFakeTimers(() => isCurrentUserAdmin(client));
    expect(attempts()).toBe(2);
    expect(isAdmin).toBe(true);
  });

  it("still fails closed on a non-PGRST303 error, without retrying", async () => {
    // The control. Without it, "retries" could pass by retrying everything —
    // which would also undo the deliberate migration-lag behaviour.
    const { client, attempts } = flaky(1, { is_admin: true } as never, {
      code: "42703",
      message: "column user_settings.is_admin does not exist",
    });
    expect(await isCurrentUserAdmin(client)).toBe(false);
    expect(attempts()).toBe(1);
  });
});
