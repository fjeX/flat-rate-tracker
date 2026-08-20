import { describe, it, expect, vi, afterEach } from "vitest";
import { listTimerSlots } from "./timers";
import type { DbClient } from "./_client";

/**
 * The (app) layout awaits listTimerSlots before React can render ANY
 * authenticated page, so it is the first PostgREST read of every authed
 * request — landing immediately after the proxy's getUser(), which is the call
 * that mints or refreshes the token. That is exactly the window PGRST303 lives
 * in.
 *
 * The original fix wrapped every read inside dashboard/page.tsx and stopped
 * there. It missed this one, so the escalated 500 still reproduced on every
 * page while the page's own reads were fully covered. This test exists so that
 * gap cannot silently reopen.
 *
 * It drives the real listTimerSlots, not the retry helper — the helper already
 * has its own tests and they pass whether or not anything calls it. Only
 * exercising the read proves the wrap is actually applied here.
 *
 * SCOPE: the client here is a hand-written fake, so this file proves the wrap
 * is APPLIED — nothing more. It stays green even when the retry cannot reach
 * PostgREST, which is exactly what happened for four weeks (Next's per-render
 * fetch dedupe served attempt 2 attempt 1's cached failure). That the retry
 * reaches the wire is pinned separately, over real HTTP, in dedupe-retry.test.ts.
 */

const PGRST303 = {
  code: "PGRST303",
  details: null,
  hint: null,
  message: "JWT issued at future",
};

const ROW = {
  id: "t1",
  slot: 1,
  entry_id: null,
  started_at: null,
  state: "idle",
  work_accumulated: 0,
  hold_parts_accumulated: 0,
  hold_approval_accumulated: 0,
};

/** Rejects the first `failures` attempts with PGRST303, then succeeds. */
function flakyClient(failures: number, err: unknown = PGRST303) {
  let attempts = 0;
  const client = {
    from: () => ({
      select: () => ({
        order: () => {
          attempts++;
          return attempts <= failures
            ? Promise.resolve({ data: null, error: err })
            : Promise.resolve({ data: [ROW], error: null });
        },
      }),
    }),
  };
  return { client: client as unknown as DbClient, attempts: () => attempts };
}

afterEach(() => vi.useRealTimers());

describe("listTimerSlots — the layout's pre-page read", () => {
  it("retries a PGRST303 instead of throwing it into the layout", async () => {
    vi.useFakeTimers();
    const { client, attempts } = flakyClient(1);

    const promise = listTimerSlots(client);
    await vi.runAllTimersAsync();
    const slots = await promise;

    expect(attempts()).toBe(2);
    expect(slots).toHaveLength(1);
  });

  it("still throws when the retry also fails — no silent empty timer list", async () => {
    // A silent [] here would be worse than the 500: the nav dot and PiP would
    // vanish and the tech would believe no timer was running.
    vi.useFakeTimers();
    const { client } = flakyClient(99);

    const promise = listTimerSlots(client);
    const assertion = expect(promise).rejects.toMatchObject({ code: "PGRST303" });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("does not retry an unrelated error", async () => {
    // The control. If this retried too, the first test would pass for the
    // wrong reason — a blanket retry rather than a PGRST303-specific one.
    const { client, attempts } = flakyClient(1, { code: "PGRST205", message: "no table" });

    await expect(listTimerSlots(client)).rejects.toMatchObject({ code: "PGRST205" });
    expect(attempts()).toBe(1);
  });
});
