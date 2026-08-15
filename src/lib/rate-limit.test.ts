import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// clientIp() reads request headers. The mock is a plain map so each test can
// state exactly which hops arrived.
let requestHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (k: string) => requestHeaders.get(k) ?? null,
  }),
}));

import {
  clientIp,
  enforceRateLimit,
  rateLimit,
  rateLimitAll,
  RateLimitError,
  LIMITS,
  __resetRateLimitForTests,
} from "./rate-limit";

const RULE = { limit: 3, windowSec: 60 };

beforeEach(() => {
  __resetRateLimitForTests();
  requestHeaders = new Map();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-12T17:30:00Z"));
  // Upstash must stay unconfigured so these exercise the in-memory backend —
  // which is the one that actually runs in production today.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit — in-memory sliding window", () => {
  it("allows up to the limit and denies the next call", async () => {
    for (let i = 0; i < RULE.limit; i++) {
      expect((await rateLimit("b", "id", RULE)).ok).toBe(true);
    }
    expect((await rateLimit("b", "id", RULE)).ok).toBe(false);
  });

  it("is NOT a no-op when Upstash is unconfigured", async () => {
    // The bug this whole file exists to prevent: the previous implementation
    // returned ok:true unconditionally without Upstash, so every limit in the
    // app was decorative in production.
    expect(process.env.UPSTASH_REDIS_REST_URL).toBeUndefined();
    const results = [];
    for (let i = 0; i < RULE.limit + 5; i++) {
      results.push((await rateLimit("inert-check", "id", RULE)).ok);
    }
    expect(results.filter(Boolean)).toHaveLength(RULE.limit);
  });

  it("lets the caller through again once the window slides past", async () => {
    for (let i = 0; i < RULE.limit; i++) await rateLimit("b", "id", RULE);
    expect((await rateLimit("b", "id", RULE)).ok).toBe(false);

    vi.advanceTimersByTime(RULE.windowSec * 1000 + 1);
    expect((await rateLimit("b", "id", RULE)).ok).toBe(true);
  });

  it("does not count a DENIED call as a hit, so hammering cannot self-extend the lockout", async () => {
    for (let i = 0; i < RULE.limit; i++) await rateLimit("b", "id", RULE);

    // Hammer through most of the window. If denials were recorded, these would
    // keep pushing the window forward and the caller would never recover.
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(2_000);
      expect((await rateLimit("b", "id", RULE)).ok).toBe(false);
    }

    // The ORIGINAL three hits are now outside the window, so it opens again.
    vi.advanceTimersByTime(RULE.windowSec * 1000);
    expect((await rateLimit("b", "id", RULE)).ok).toBe(true);
  });

  it("reports a retryAfterSec inside the window, counting down as it slides", async () => {
    for (let i = 0; i < RULE.limit; i++) await rateLimit("b", "id", RULE);

    const first = await rateLimit("b", "id", RULE);
    expect(first.ok).toBe(false);
    expect(first.retryAfterSec).toBeGreaterThan(0);
    expect(first.retryAfterSec).toBeLessThanOrEqual(RULE.windowSec);

    vi.advanceTimersByTime(30_000);
    const later = await rateLimit("b", "id", RULE);
    expect(later.retryAfterSec).toBeLessThan(first.retryAfterSec);
  });

  it("keeps buckets and identifiers independent", async () => {
    for (let i = 0; i < RULE.limit; i++) await rateLimit("b", "alice", RULE);
    expect((await rateLimit("b", "alice", RULE)).ok).toBe(false);
    // Same bucket, different user.
    expect((await rateLimit("b", "bob", RULE)).ok).toBe(true);
    // Same user, different bucket.
    expect((await rateLimit("other", "alice", RULE)).ok).toBe(true);
  });

  it("gives a longer window a longer memory for the same key name", async () => {
    const short = { limit: 1, windowSec: 10 };
    expect((await rateLimit("w", "id", short)).ok).toBe(true);
    vi.advanceTimersByTime(11_000);
    expect((await rateLimit("w", "id", short)).ok).toBe(true);
  });
});

describe("rateLimitAll", () => {
  it("allows only when every bucket allows", async () => {
    const checks = [
      { bucket: "a", identifier: "x", rule: { limit: 2, windowSec: 60 } },
      { bucket: "b", identifier: "y", rule: { limit: 5, windowSec: 60 } },
    ];
    expect((await rateLimitAll(checks)).ok).toBe(true);
    expect((await rateLimitAll(checks)).ok).toBe(true);
    // 'a' is exhausted at 2 even though 'b' still has room.
    expect((await rateLimitAll(checks)).ok).toBe(false);
  });

  it("returns the longest wait among the buckets that denied", async () => {
    const shortRule = { limit: 1, windowSec: 30 };
    const longRule = { limit: 1, windowSec: 600 };
    await rateLimitAll([
      { bucket: "s", identifier: "x", rule: shortRule },
      { bucket: "l", identifier: "x", rule: longRule },
    ]);
    const denied = await rateLimitAll([
      { bucket: "s", identifier: "x", rule: shortRule },
      { bucket: "l", identifier: "x", rule: longRule },
    ]);
    expect(denied.ok).toBe(false);
    // The 30s bucket also denied; the caller must hear about the 600s one.
    expect(denied.retryAfterSec).toBeGreaterThan(30);
  });
});

describe("enforceRateLimit", () => {
  beforeEach(() => {
    requestHeaders.set("cf-connecting-ip", "203.0.113.7");
  });

  it("throws RateLimitError carrying the caller's message and a retry hint", async () => {
    const rule = { limit: 1, windowSec: 60 };
    await enforceRateLimit("t", "user-1", rule, "Slow down.");
    await expect(
      enforceRateLimit("t", "user-1", rule, "Slow down."),
    ).rejects.toBeInstanceOf(RateLimitError);

    let err: RateLimitError | null = null;
    try {
      await enforceRateLimit("t", "user-1", rule, "Slow down.");
    } catch (e) {
      err = e as RateLimitError;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toBe("Slow down.");
    expect(err!.retryAfterSec).toBeGreaterThan(0);
  });

  it("trips on the per-user key long before the shared-IP key — a shop shares one wifi", async () => {
    const rule = { limit: 2, windowSec: 60 };
    // Two techs, same shop IP. The first exhausts their own budget.
    await enforceRateLimit("shop", "tech-a", rule, "nope");
    await enforceRateLimit("shop", "tech-a", rule, "nope");
    await expect(enforceRateLimit("shop", "tech-a", rule, "nope")).rejects.toThrow();

    // Their coworker on the same IP is unaffected — this is the whole reason
    // the IP ceiling is a multiple of the user limit rather than equal to it.
    await expect(
      enforceRateLimit("shop", "tech-b", rule, "nope"),
    ).resolves.toBeUndefined();
  });

  it("still stops one host cycling many accounts, via the IP ceiling", async () => {
    const rule = { limit: 1, windowSec: 60 };
    // ipMultiplier 3 → the IP bucket allows 3 before it bites.
    for (let i = 0; i < 3; i++) {
      await enforceRateLimit("multi", `user-${i}`, rule, "nope", {
        ipMultiplier: 3,
      });
    }
    // A brand-new user id, well inside its own budget, but the IP is spent.
    await expect(
      enforceRateLimit("multi", "user-fresh", rule, "nope", { ipMultiplier: 3 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("clientIp", () => {
  it("prefers cf-connecting-ip, which Cloudflare overwrites at its edge", async () => {
    requestHeaders.set("cf-connecting-ip", "198.51.100.5");
    requestHeaders.set("x-forwarded-for", "1.2.3.4, 5.6.7.8");
    expect(await clientIp()).toBe("198.51.100.5");
  });

  it("takes the RIGHTMOST x-forwarded-for hop, not the client-supplied leftmost", async () => {
    // A caller can send any X-Forwarded-For it likes; our proxy APPENDS the real
    // peer. Reading hops[0] hands the bucket key to the attacker, so rotating
    // one header per request would give an empty limiter every time.
    requestHeaders.set("x-forwarded-for", "6.6.6.6, 203.0.113.9");
    const ip = await clientIp();
    expect(ip).toBe("203.0.113.9");
    expect(ip).not.toBe("6.6.6.6"); // pins the fix against the old behaviour
  });

  it("handles a single-hop and a whitespace-padded header", async () => {
    requestHeaders.set("x-forwarded-for", "  203.0.113.9  ");
    expect(await clientIp()).toBe("203.0.113.9");
  });

  it("falls back to a shared 'unknown' bucket when no hop header is present", async () => {
    expect(await clientIp()).toBe("unknown");
  });

  it("does not let a forged leftmost hop win a fresh bucket each request", async () => {
    // The end-to-end version of the fix: same real peer, rotating forged prefix.
    const rule = { limit: 2, windowSec: 60 };
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      requestHeaders.set("x-forwarded-for", `10.0.0.${i}, 203.0.113.9`);
      const ip = await clientIp();
      results.push((await rateLimit("spoof", ip, rule)).ok);
    }
    expect(results).toEqual([true, true, false, false]);
  });
});

describe("LIMITS", () => {
  it("budgets a Claude triage run more tightly than filing a report", async () => {
    // The report is the user's data and must not be refused just because the
    // automation budget is spent; the money endpoint is the smaller number.
    expect(LIMITS.bugTriageWebhook.limit).toBeLessThan(LIMITS.bugSubmit.limit);
  });

  it("de-duplicates a double-clicked Verify faster than it rations the hour", async () => {
    expect(LIMITS.bugInvestigateReport.windowSec).toBeLessThan(
      LIMITS.bugInvestigateUser.windowSec,
    );
    expect(LIMITS.bugInvestigateReport.limit).toBeLessThan(
      LIMITS.bugInvestigateUser.limit,
    );
  });

  it("has a positive limit and window for every rule", () => {
    for (const [name, rule] of Object.entries(LIMITS)) {
      expect(rule.limit, name).toBeGreaterThan(0);
      expect(rule.windowSec, name).toBeGreaterThan(0);
    }
  });
});
