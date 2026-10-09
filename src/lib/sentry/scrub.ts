// Privacy scrubber for everything FRT sends to Sentry.
//
// FRT's data is people's paychecks. An error event can carry text from almost
// anywhere: an exception message that interpolated a value, a console
// breadcrumb, a URL with a recovery token in it. So instead of guessing which
// fields are risky, the scrubber walks EVERY string in the event and redacts the
// patterns that must never leave the server, then drops the request parts that
// carry credentials wholesale.
//
// Rules (launch plan §2.2): never ship pay amounts, emails, passwords, tokens.
// The only identity Sentry gets is the Supabase user id.
//
// Pure and dependency-free: used by the client, server and edge init (via
// beforeSend / beforeBreadcrumb) and unit-tested on its own.

const REDACTIONS: Array<[RegExp, string]> = [
  // Secrets inside URLs first, before the generic token rules eat half of one.
  // Recovery links carry access_token/refresh_token in the FRAGMENT (#), PKCE
  // carries ?code=; both must die here (memory: reference_frt_auth_and_email).
  [/([?&#](?:access_token|refresh_token|provider_token|token_hash|token|code|apikey|api_key|key|password)=)[^&#\s"']+/gi, "$1[redacted]"],
  [/\bBearer\s+[\w.~+/=-]+/gi, "Bearer [token]"],
  // JWTs (Supabase session + anon keys all start with a base64 '{"' = eyJ).
  [/\beyJ[\w-]{5,}\.[\w-]{5,}(?:\.[\w-]+)?/g, "[token]"],
  // Vendor keys that FRT holds: Sentry org tokens, Resend, Axiom.
  [/\b(?:sntrys_|re_|xaat-)[\w-]{16,}/g, "[token]"],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  // Money: $1,234.56 / $ 40 / -$12.5. Hours and plain numbers stay readable;
  // a pay figure without a $ in front is indistinguishable from flag hours,
  // so callers must never put raw amounts in error messages (they don't today).
  [/-?\$\s?\d[\d,]*(?:\.\d+)?/g, "[amount]"],
];

export function scrubString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

const MAX_DEPTH = 12;

// Recursively scrub every string. Arrays and plain objects are rebuilt; any
// other value (numbers, booleans, null) passes through. Depth-capped so a
// pathological or circular structure can't hang the reporter.
export function scrubDeep<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (typeof value === "string") return scrubString(value) as T;
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]" as T;
  if (seen.has(value as object)) return "[circular]" as T;
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1, seen)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = scrubDeep(v, depth + 1, seen);
  }
  return out as T;
}

// Minimal structural types: the scrubber must not depend on @sentry/* so the
// unit test stays a pure function test.
type ScrubbableEvent = {
  user?: { id?: string | number; [k: string]: unknown } | null;
  request?: {
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, string>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

export function scrubEvent<E extends object>(event: E): E {
  const clean = scrubDeep(event) as ScrubbableEvent;
  if (clean.user) {
    // Only the Supabase user id. No email, username, or IP address.
    clean.user = clean.user.id !== undefined ? { id: clean.user.id } : null;
  }
  if (clean.request) {
    // Cookies hold the session JWT; the body of a server action is the user's
    // form (RO numbers, hours, pay). Headers keep only the browser identity.
    delete clean.request.cookies;
    delete clean.request.data;
    const ua = clean.request.headers?.["user-agent"] ?? clean.request.headers?.["User-Agent"];
    clean.request.headers = ua ? { "user-agent": ua } : {};
  }
  return clean as E;
}

export function scrubBreadcrumb<B extends object>(breadcrumb: B): B {
  return scrubDeep(breadcrumb);
}
