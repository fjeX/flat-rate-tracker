import { describe, it, expect, vi, afterEach } from "vitest";
import { isJwtFutureError, isMissingTable, retryOnce, JWT_FUTURE_RETRY_MS } from "./_client";

// A PostgrestError as the client actually throws it: a plain object carrying a
// string `code`. The discriminator under test is that code, nothing else.
function pgError(code: string, message = "boom") {
  return { code, message, details: "", hint: "" };
}

const JWT_FUTURE = () => pgError("PGRST303", "JWT issued at future");

afterEach(() => {
  vi.useRealTimers();
});

describe("isJwtFutureError", () => {
  it("is true only for PGRST303", () => {
    expect(isJwtFutureError(pgError("PGRST303"))).toBe(true);
  });

  /**
   * The one assertion in this file that is not circular.
   *
   * Every other case here builds its own error object and then checks the
   * predicate against the shape this file chose — which proves the predicate
   * matches a string we picked, not the string PostgREST actually sends. If
   * the real code were PGRST301 (where JWT claim failures have historically
   * landed) the whole retry would be inert and every test above would still
   * be green.
   *
   * So this is the verbatim body captured from the FRT production app log,
   * `docker compose logs app` on the VM, 2026-08-19:
   *
   *   ⨯ Error: {"code":"PGRST303","details":null,"hint":null,
   *             "message":"JWT issued at future"}
   *
   * Note `details` and `hint` are null here, not "" — real PostgREST, not the
   * tidied fixture above. Anyone changing the predicate has to keep this one
   * passing.
   */
  it("matches the body PostgREST really sent in production", () => {
    const captured = JSON.parse(
      '{"code":"PGRST303","details":null,"hint":null,"message":"JWT issued at future"}',
    );
    expect(isJwtFutureError(captured)).toBe(true);
    expect(isMissingTable(captured)).toBe(false);
  });

  it("is false for PGRST205, null, undefined and a plain Error", () => {
    // PGRST205 is the missing-table code — the two predicates must not overlap,
    // or a pre-migration table would be retried and a stale token hidden.
    expect(isJwtFutureError(pgError("PGRST205"))).toBe(false);
    expect(isMissingTable(pgError("PGRST303"))).toBe(false);
    expect(isJwtFutureError(null)).toBe(false);
    expect(isJwtFutureError(undefined)).toBe(false);
    expect(isJwtFutureError(new Error("PGRST303"))).toBe(false);
  });
});

describe("retryOnce", () => {
  it("passes a first-try success straight through without waiting", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(retryOnce(fn, 0)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once on PGRST303 and returns the second result", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(JWT_FUTURE())
      .mockResolvedValueOnce("second");
    await expect(retryOnce(fn, 0)).resolves.toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows a second consecutive PGRST303 instead of looping", async () => {
    const fn = vi.fn().mockRejectedValue(JWT_FUTURE());
    await expect(retryOnce(fn, 0)).rejects.toMatchObject({ code: "PGRST303" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry any other error and rethrows it immediately", async () => {
    for (const err of [pgError("PGRST205"), pgError("42501"), new Error("nope")]) {
      const fn = vi.fn().mockRejectedValue(err);
      await expect(retryOnce(fn, 0)).rejects.toBe(err);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("waits the delay before retrying — and defaults past the known-accepted age, not 0", async () => {
    // The whole point of the number: the observed rejection window is a token
    // 0.3-0.4s old, so an immediate retry is still inside it. Fake timers, so
    // proving that costs the suite nothing in wall clock.
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(JWT_FUTURE())
      .mockResolvedValueOnce("second");

    const promise = retryOnce(fn);
    // Let the first (rejected) attempt settle so the sleep is actually armed.
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // One tick short of the delay: still waiting.
    await vi.advanceTimersByTimeAsync(JWT_FUTURE_RETRY_MS - 1);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(promise).resolves.toBe("second");

    // Must clear the only token age ever observed to be ACCEPTED (~1s), not
    // merely the ages observed to be refused. See the constant's comment.
    expect(JWT_FUTURE_RETRY_MS).toBeGreaterThan(1000);
  });

  it("lets concurrent retries overlap — N reads cost one delay, not N", async () => {
    // The dashboard fires ~17 reads in one Promise.all. If they all hit the
    // same window they must sleep together; a shared queue or per-call
    // serialisation would turn one blip into N delays back to back.
    vi.useFakeTimers();
    const make = () =>
      vi.fn().mockRejectedValueOnce(JWT_FUTURE()).mockResolvedValueOnce("ok");
    const fns = [make(), make(), make()];
    const all = Promise.all(fns.map((f) => retryOnce(f)));

    await vi.advanceTimersByTimeAsync(JWT_FUTURE_RETRY_MS);
    await expect(all).resolves.toEqual(["ok", "ok", "ok"]);
    for (const f of fns) expect(f).toHaveBeenCalledTimes(2);
  });
});
