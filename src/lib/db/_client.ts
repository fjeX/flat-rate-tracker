// Shared Supabase client type for data-layer functions.
// Works with both the server client (createServerClient) and the browser
// client (createBrowserClient) because both expose the same typed query API.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type DbClient = SupabaseClient<Database>;

// Small helper for "I need the authenticated user's id here" in mutations.
export async function getCurrentUserId(supabase: DbClient): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Not authenticated");
  return data.user.id;
}

// "This table doesn't exist yet" — PostgREST PGRST205 / Postgres 42P01.
//
// A migration can land on the VM after the image that expects it (the deploy
// order is pull → migrate → rebuild, and the app can be up in between), so
// reads against a brand-new table have to degrade instead of crashing the page.
// The *Safe read wrappers use this to return null, which callers read as "not
// migrated yet, hide the feature" — distinct from [] meaning "migrated, empty".
//
// schedules.ts and gamification.ts each carry their own copy of this predicate
// from before it was shared; they're left alone deliberately (working code, own
// tests) — new modules should import this one.
export function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "PGRST205" || e.code === "42P01") return true;
  return /schema cache|does not exist/i.test(e.message ?? "");
}

// "This access token is from the future" — PostgREST PGRST303.
//
// GoTrue mints a fresh access token and the very next PostgREST request refuses
// it with `JWT issued at future`. This is NOT clock drift between containers,
// and four separate investigations burned themselves proving it: every
// container on the VM shares one time namespace (/proc/1/ns/time reads
// time:[4026531834] on the host and inside the app container alike), so their
// clocks are physically the same clock and cannot diverge by so much as a tick.
//
// What it actually is: a sub-second race inside PostgREST's own `iat`
// validation. On 2026-08-19 a token minted at 10:00:47.792Z was rejected twice,
// at 10:00:48.097Z and 10:00:48.108Z — the token was ~0.30s old — and the exact
// same request served fine by hand a moment later. Five earlier occurrences
// were single log lines nobody saw; the sixth landed inside the dashboard's
// ~17-way Promise.all of reads, so the render threw and the user got a 500.
//
// PostgREST 14.8 exposes no clock-leeway setting, so there is nowhere upstream
// to fix it. The fix is to wait for the token to age and ask again.
export function isJwtFutureError(err: unknown): boolean {
  const e = err as { code?: string } | null;
  if (!e) return false;
  return e.code === "PGRST303";
}

// How long to wait before re-asking after a PGRST303.
//
// DO NOT "OPTIMISE" THIS TO 0. An immediate retry is the obvious change and it
// is wrong: the evidence above is a token being refused at ~0.30-0.40s old and
// accepted once it was past a second. A zero-delay retry fires while the token
// is still sub-second, hits the same window, and converts a recoverable blip
// into a guaranteed 500 that also looks like the retry "didn't help".
//
// 1250ms, and the extra 500 over the original 750 is the whole point.
//
// What the incidents actually pin down is narrow: refused at 0.30s and 0.40s,
// accepted "past a second". The interval between 0.40s and 1.0s was never
// measured, so the true width of the rejection band is unknown. 750ms was
// derived from the wrong end of that range — it clears the ages we happened to
// OBSERVE, not the ages we know are ACCEPTED.
//
// The worst case is not the observed one. auth-js refreshes when the token has
// under 90s of life left, and it re-checks the session on every PostgREST
// request, so a request arriving inside that margin mints a token and issues
// the query microseconds later — age ~0.00s, not 0.30s. At 750ms that retry
// lands at ~0.75s, still inside the unmeasured region, and a second PGRST303
// rethrows: the same 500, now slower. At 1250ms it lands past the only age
// ever seen to work.
//
// The cost of being wrong in each direction is lopsided: too short buys a
// guaranteed 500, too long buys half a second on a request that was already
// failing. Pay the half second.
export const JWT_FUTURE_RETRY_MS = 1250;

// Run a READ once, and if — and only if — it fails with PGRST303, wait and run
// it exactly once more.
//
// **Never wrap a mutation in this.** Roughly 70 of the data layer's ~92
// throw-sites are .insert/.update/.upsert/.delete, and PostgREST gives no way
// to know whether a rejected request reached the database, so a retry there
// risks a double insert. That is why this is applied by hand at named read
// functions rather than bolted into a shared query helper: a chokepoint would
// silently cover the writes too.
//
// `fn` is re-invoked, not a pre-built query re-awaited, so callers must build
// their query inside the callback — a spent PostgREST builder is not a
// dependable second request.
//
// Concurrency note: the dashboard fires its reads in parallel, so if several
// land in the same rejection window they each sleep *at the same time*.
// The page pays one delay, not one per read.
export async function retryOnce<T>(
  fn: () => Promise<T>,
  delayMs: number = JWT_FUTURE_RETRY_MS,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Anything else — a missing table, RLS, a real query error — is rethrown
    // untouched and immediately. Retrying those just doubles the latency of a
    // failure that was never going to succeed.
    if (!isJwtFutureError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    // Exactly one more attempt. A second PGRST303 is no longer the freshness
    // race — the token is over a second old by now — so it means something
    // genuinely wrong, and it rethrows to the error boundary. A loop here
    // would hold a server render open indefinitely on every request instead.
    return await fn();
  }
}
