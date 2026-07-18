// App-layer rate limiting for abuse-prone actions (sign-in, sign-up).
//
// WHY THIS EXISTS
// FRT is going public with self-service email+password auth. On a serverless
// host (Vercel) an in-memory counter is useless — every request can hit a
// fresh instance — so brute-force protection needs a shared store. This uses
// Upstash Redis (free tier) via its REST API, which works from serverless.
//
// FAIL-OPEN BY DESIGN
// If Upstash isn't configured (local dev, or before the Phase-1 cloud cutover)
// OR Redis is unreachable, requests are ALLOWED. This is a deliberate safety
// choice: the limiter is a brute-force speed bump, not an auth gate. It must
// never turn a Redis blip into an outage that locks real techs out of their
// pay data. Supabase's own auth rate limits + CAPTCHA are the platform-level
// backstop underneath this.
//
// ENABLING IT (Phase 1/2)
// Create a free Upstash Redis DB and set these env vars in Vercel:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// Until both are present, this module is inert (see configured()).

import { headers } from "next/headers";

export type RateLimitResult = { ok: boolean; retryAfterSec: number };

// Lazy singletons — the Upstash SDK is only imported/instantiated once we know
// it's actually configured, so an unconfigured deploy pays zero cost.
let redis: unknown = null;
// One Ratelimit instance per (limit, window) combo, keyed below.
const limiters = new Map<string, unknown>();
let warnedUnconfigured = false;

function configured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

async function getLimiter(limit: number, windowSec: number): Promise<{
  limit: (id: string) => Promise<{ success: boolean; reset: number }>;
}> {
  const key = `${limit}:${windowSec}`;
  const cached = limiters.get(key);
  if (cached) return cached as never;

  const { Ratelimit } = await import("@upstash/ratelimit");
  const { Redis } = await import("@upstash/redis");
  if (!redis) redis = Redis.fromEnv();

  const limiter = new Ratelimit({
    redis: redis as never,
    // Sliding window: smooth, no thundering-herd reset boundary.
    limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
    prefix: "frt-rl",
    analytics: false,
  });
  limiters.set(key, limiter);
  return limiter as never;
}

/**
 * Check a rate-limit bucket. Returns { ok } — false means the caller should
 * reject (too many attempts). Fail-open: returns ok:true when unconfigured or
 * on any Redis error.
 *
 * @param bucket     namespace, e.g. "signin-ip" / "signin-email" / "signup"
 * @param identifier the thing being limited (an IP, or a lowercased email)
 */
export async function rateLimit(
  bucket: string,
  identifier: string,
  opts: { limit: number; windowSec: number },
): Promise<RateLimitResult> {
  if (!configured()) {
    if (!warnedUnconfigured && process.env.NODE_ENV === "production") {
      // One-time breadcrumb so a prod deploy without Upstash is visible in logs
      // rather than silently unprotected.
      console.warn(
        "[rate-limit] Upstash not configured — auth rate limiting is DISABLED (fail-open).",
      );
      warnedUnconfigured = true;
    }
    return { ok: true, retryAfterSec: 0 };
  }

  try {
    const limiter = await getLimiter(opts.limit, opts.windowSec);
    const { success, reset } = await limiter.limit(`${bucket}:${identifier}`);
    const retryAfterSec = success
      ? 0
      : Math.max(0, Math.ceil((reset - Date.now()) / 1000));
    return { ok: success, retryAfterSec };
  } catch (err) {
    // Redis down / network blip → fail OPEN. A speed bump must never become an
    // outage that blocks legitimate logins.
    console.error(
      "[rate-limit] check failed, allowing request (fail-open):",
      err,
    );
    return { ok: true, retryAfterSec: 0 };
  }
}

/**
 * Best-effort client IP for rate-limit keys. Prefers Cloudflare's
 * cf-connecting-ip (FRT sits behind Cloudflare), then the first x-forwarded-for
 * hop. Returns "unknown" if neither is present — meaning all such requests
 * share one bucket, which is acceptable for a speed bump.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
