// App-layer rate limiting for endpoints that cost money or can be abused.
//
// WHY THIS EXISTS
// FRT is going public with self-service email+password auth, and two of its
// endpoints spend real money per call (the bug-automation webhooks hand work to
// headless Claude). Supabase's own auth limits are a platform backstop, but they
// know nothing about "this user just fired forty Claude runs".
//
// TWO BACKENDS, ONE API
// The store is chosen at call time by whether Upstash is configured:
//
//   in-memory (default)  — one process-local sliding window. Correct TODAY,
//                          because FRT runs as a single Next.js process in a
//                          single container on one VM (no replicas, no cluster
//                          mode). Nothing to configure, nothing to pay for, and
//                          no network round-trip on the sign-in path.
//   Upstash Redis        — used automatically the moment both env vars are set.
//                          Required after the Vercel cutover, where every
//                          request can land on a fresh instance and a
//                          process-local counter would count to one forever.
//
// Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN and the switch happens
// with no code change. Until then the in-memory window is the live limiter —
// NOT a no-op. The previous version of this file was Upstash-only, which meant
// every limit in the app was inert in production and the only trace was a
// console.warn nobody reads.
//
// FAIL-SOFT, NEVER FAIL-OPEN-TO-NOTHING
// If Upstash is configured but unreachable, we fall back to the in-memory
// window rather than waving the request through. A limiter is a speed bump and
// must never turn a Redis blip into an outage that locks techs out of their pay
// data — but "degrade to process-local" is strictly better than "degrade to
// nothing", which is what a bare fail-open gives you on the one endpoint where
// a blip costs money.

import { headers } from "next/headers";

export type RateLimitResult = { ok: boolean; retryAfterSec: number };

export type RateLimitRule = { limit: number; windowSec: number };

// ---------------------------------------------------------------------------
// In-memory sliding window
// ---------------------------------------------------------------------------

type MemoryBucket = { hits: number[]; windowMs: number };

// Held on globalThis, not in a module-level const: Next can evaluate a server
// module more than once (dev hot-reload, separate runtime graphs), and a
// limiter that silently forgets its counters on every rebuild is a limiter that
// only works in production by accident.
const MEMORY_STORE_KEY = Symbol.for("frt.rateLimit.memoryStore");

type GlobalWithStore = typeof globalThis & {
  [MEMORY_STORE_KEY]?: Map<string, MemoryBucket>;
};

function memoryStore(): Map<string, MemoryBucket> {
  const g = globalThis as GlobalWithStore;
  g[MEMORY_STORE_KEY] ??= new Map<string, MemoryBucket>();
  return g[MEMORY_STORE_KEY];
}

// Ceiling on distinct tracked keys. Reached only under a key-flooding attack
// (one bucket per forged identifier); a real deployment sits in the dozens.
const MEMORY_MAX_KEYS = 20_000;

// Drop every bucket whose window has fully elapsed. Called only when the store
// crosses MEMORY_MAX_KEYS, so the common path stays a single Map lookup.
function sweepExpired(store: Map<string, MemoryBucket>, now: number): void {
  for (const [key, bucket] of store) {
    const newest = bucket.hits[bucket.hits.length - 1] ?? 0;
    if (newest + bucket.windowMs <= now) store.delete(key);
  }
  // Still full of live buckets: this is a flood, not a leak. Clearing is the
  // safe move — the worst case is that some attacker keys reset, and the
  // alternative is unbounded process memory.
  if (store.size >= MEMORY_MAX_KEYS) store.clear();
}

function memoryLimit(key: string, rule: RateLimitRule, now: number): RateLimitResult {
  const store = memoryStore();
  if (store.size >= MEMORY_MAX_KEYS) sweepExpired(store, now);

  const windowMs = rule.windowSec * 1000;
  const cutoff = now - windowMs;
  const previous = store.get(key)?.hits ?? [];
  // Sliding window log: keep only the hits still inside the window.
  const hits = previous.filter((t) => t > cutoff);

  if (hits.length >= rule.limit) {
    // A REJECTED call is not recorded as a hit. If denials counted, a client
    // hammering the endpoint would keep pushing its own window forward and stay
    // locked out indefinitely — the limiter would punish persistence rather
    // than rate, and a legitimate user who double-tapped could never recover.
    store.set(key, { hits, windowMs });
    const oldest = hits[0] ?? now;
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  store.set(key, { hits, windowMs });
  return { ok: true, retryAfterSec: 0 };
}

/** Test-only: drop all in-memory counters. */
export function __resetRateLimitForTests(): void {
  memoryStore().clear();
}

// ---------------------------------------------------------------------------
// Upstash Redis backend
// ---------------------------------------------------------------------------

// Lazy singletons — the Upstash SDK is only imported/instantiated once we know
// it's actually configured, so an unconfigured deploy pays zero cost.
let redis: unknown = null;
// One Ratelimit instance per (limit, window) combo, keyed below.
const limiters = new Map<string, unknown>();

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

async function getLimiter(rule: RateLimitRule): Promise<{
  limit: (id: string) => Promise<{ success: boolean; reset: number }>;
}> {
  const key = `${rule.limit}:${rule.windowSec}`;
  const cached = limiters.get(key);
  if (cached) return cached as never;

  const { Ratelimit } = await import("@upstash/ratelimit");
  const { Redis } = await import("@upstash/redis");
  if (!redis) redis = Redis.fromEnv();

  const limiter = new Ratelimit({
    redis: redis as never,
    // Sliding window: smooth, no thundering-herd reset boundary.
    limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSec} s`),
    prefix: "frt-rl",
    analytics: false,
  });
  limiters.set(key, limiter);
  return limiter as never;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check a rate-limit bucket. `ok: false` means the caller should reject.
 *
 * @param bucket     namespace, e.g. "signin-ip" / "bug-submit-user"
 * @param identifier the thing being limited (an IP, a user id, a lowercased email)
 */
export async function rateLimit(
  bucket: string,
  identifier: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const key = `${bucket}:${identifier}`;
  const now = Date.now();

  if (!upstashConfigured()) return memoryLimit(key, rule, now);

  try {
    const limiter = await getLimiter(rule);
    const { success, reset } = await limiter.limit(key);
    return {
      ok: success,
      retryAfterSec: success ? 0 : Math.max(0, Math.ceil((reset - now) / 1000)),
    };
  } catch (err) {
    // Redis down / network blip → degrade to the process-local window rather
    // than to no limit at all. Logged, because a silent backend swap on the
    // money endpoints is exactly the thing you want to see in the logs.
    console.error("[rate-limit] Upstash check failed, using in-memory window:", err);
    return memoryLimit(key, rule, now);
  }
}

/**
 * Check several buckets at once. Denied if ANY is over; the returned
 * retryAfterSec is the longest wait among the ones that denied.
 */
export async function rateLimitAll(
  checks: Array<{ bucket: string; identifier: string; rule: RateLimitRule }>,
): Promise<RateLimitResult> {
  const results = await Promise.all(
    checks.map((c) => rateLimit(c.bucket, c.identifier, c.rule)),
  );
  const denied = results.filter((r) => !r.ok);
  if (denied.length === 0) return { ok: true, retryAfterSec: 0 };
  return {
    ok: false,
    retryAfterSec: Math.max(...denied.map((r) => r.retryAfterSec)),
  };
}

/** Thrown by enforceRateLimit so callers can distinguish a limit from a fault. */
export class RateLimitError extends Error {
  readonly retryAfterSec: number;
  constructor(message: string, retryAfterSec: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Rate-limit a signed-in action, keyed by user id AND (generously) by IP.
 *
 * WHY THE IP CEILING IS SO MUCH HIGHER THAN THE USER ONE
 * FRT's users are techs in a shop, and a shop has one wifi. A per-IP limit set
 * anywhere near the per-user limit means one tech bug-bashing on their lunch
 * break locks out every coworker on the same network — the limiter would create
 * the outage it exists to prevent. The user id is the accountable identity on a
 * signed-in endpoint; the IP bucket is only there to catch the multi-account
 * case, so it sits at a multiple no roomful of real techs can reach.
 *
 * Throws RateLimitError when over. Use for actions whose failure path is a
 * thrown Error; actions that return { error } should call rateLimitAll instead.
 */
export async function enforceRateLimit(
  bucket: string,
  userId: string,
  rule: RateLimitRule,
  message: string,
  opts: { ipMultiplier?: number } = {},
): Promise<void> {
  const ip = await clientIp();
  const result = await rateLimitAll([
    { bucket: `${bucket}-user`, identifier: userId, rule },
    {
      bucket: `${bucket}-ip`,
      identifier: ip,
      rule: {
        limit: rule.limit * (opts.ipMultiplier ?? 8),
        windowSec: rule.windowSec,
      },
    },
  ]);
  if (!result.ok) throw new RateLimitError(message, result.retryAfterSec);
}

/**
 * Best-effort client IP for rate-limit keys.
 *
 * Prefers cf-connecting-ip: FRT sits behind Cloudflare, which OVERWRITES that
 * header at its edge, so a client cannot forge it on any request that actually
 * traverses CF.
 *
 * The x-forwarded-for fallback takes the RIGHTMOST hop, not the leftmost. XFF
 * is append-only and client-writable: a request arriving with
 * `X-Forwarded-For: 1.2.3.4` leaves Traefik as `1.2.3.4, <real peer>`. Reading
 * the leftmost entry — which this function used to do — hands the attacker the
 * bucket key, so rotating one header per request gives them a fresh, empty
 * limiter every time and the IP limit is bypassed completely. The rightmost
 * entry is the one our own proxy appended.
 *
 * Returns "unknown" when neither header is present, meaning all such requests
 * share one bucket. Acceptable for a speed bump.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return nearest;
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
//
// Every number below is set so a real tech having a heavy day never sees it,
// and a script is stopped within seconds. Where a limit guards money rather
// than data, it is tighter — a Claude run costs more than a row.

export const LIMITS = {
  // --- Anonymous / auth (keyed by IP or email; there is no user yet) ---
  signup: { limit: 6, windowSec: 3600 },
  signinIp: { limit: 20, windowSec: 600 },
  signinEmail: { limit: 8, windowSec: 900 },
  resetIp: { limit: 10, windowSec: 3600 },
  resetEmail: { limit: 4, windowSec: 3600 },

  // --- Money: headless Claude runs ---
  // The bug REPORT itself is the user's data and is never refused (see
  // bug-reports.ts); this caps how often submitting one is allowed to spend a
  // Claude triage run.
  bugTriageWebhook: { limit: 6, windowSec: 3600 },
  // Filing a report writes a row + up to MAX_BUG_PHOTOS storage objects.
  bugSubmit: { limit: 20, windowSec: 3600 },
  // Admin "Verify" → Claude drafts a fix on a branch. Keyed by REPORT id, so a
  // double-clicked button cannot spend twice, while a deliberate retry still
  // gets through.
  bugInvestigateReport: { limit: 2, windowSec: 600 },
  bugInvestigateUser: { limit: 10, windowSec: 3600 },

  // --- Email sends ---
  emailChange: { limit: 5, windowSec: 3600 },

  // --- Storage ---
  photoUpload: { limit: 60, windowSec: 3600 },

  // --- Heavy DB ---
  exportData: { limit: 10, windowSec: 3600 },
  importData: { limit: 5, windowSec: 3600 },
  clearAllData: { limit: 3, windowSec: 3600 },
} as const;
