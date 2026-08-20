"use client";

// Client-side error reporter. Writes a compact record to the client_errors
// Supabase table so a solo dev can see prod breakage without external infra.
//
// Design rules:
//   * Never throws. The reporter is the last line of defense — if it blows up it
//     must fail silently, never take down the error boundary that called it.
//   * Deduped. A render-loop bug can fire the same error hundreds of times a
//     second; we write at most one report per identical (message+stack) per
//     minute so we don't flood the table.
//   * Survives navigation. See below — this is the whole point of the file.
//
// WHY THE WRITE IS A RAW keepalive FETCH AND NOT supabase.from().insert()
// This runs from an error boundary's useEffect, i.e. the app is already broken
// and the user (or a bot) is about to leave the page. The old shape was
//
//     await supabase.auth.getUser();          // network round trip to GoTrue
//     await supabase.from("client_errors")…   // only then, the write
//
// so a navigation during that first round trip killed the report outright. On
// 2026-08-19 22:50Z Kong logged `GET /auth/v1/user` → 499 (client closed
// request) right after an error boundary rendered, and client_errors got no row
// for a real crash. The one surface built to catch this class of bug recorded
// nothing.
//
// Two changes fix that:
//   1. NO NETWORK CALL BEFORE THE WRITE. Identity comes out of the session
//      cookie synchronously (the JWT's `sub` claim — the same value auth.uid()
//      will see), so the row is fully built before we yield to the event loop.
//      `reportError` is async but its body runs to the fetch() call in the same
//      task as the caller, so the request is in flight before any cleanup runs.
//   2. `keepalive: true`. A normal fetch is cancelled when the document goes
//      away; a keepalive fetch is completed by the browser regardless. That is
//      what makes the record survive the navigation rather than just racing it.
//
// navigator.sendBeacon() is the usual answer here and it CANNOT be used: Kong
// rejects a request without an `apikey` header and RLS on client_errors is
// `to authenticated`, so the write needs an `Authorization: Bearer` header too.
// sendBeacon sets no headers other than Content-Type. fetch(keepalive) does,
// and the payload (message capped at 2000 chars) is far under its 64KB cap.
//
// SCHEMA NOTES (supabase/migrations/20260707000000_client_errors.sql):
//   * user_id is NULLABLE and the insert policy is
//     `with check (user_id = auth.uid() or user_id is null)`, so an
//     unattributed row is legal — losing identity never loses the record.
//   * There is no UPDATE policy, so "insert now, enrich later" is impossible.
//     Identity has to be attached at insert time, which is why it is read
//     synchronously rather than fetched.
//   * The 20260717 throttle trigger stamps `inserted_by := auth.uid()` from the
//     JWT on every row, so real attribution exists in the DB even when user_id
//     comes back null.
import { createClient } from "@/lib/supabase/client";
import { authCookieName } from "@/lib/supabase/config";

const WINDOW_MS = 60_000;
// hash -> last-report epoch ms. Module-scoped so it survives re-renders.
const recentReports = new Map<string, number>();

// The exact row shape written to client_errors. Unchanged from the pre-keepalive
// reporter — same four columns, same values.
type ErrorRow = {
  user_id: string | null;
  message: string;
  stack_hash: string;
  url: string | null;
};

// Tiny, dependency-free string hash (djb2-ish). Not cryptographic — just a
// stable fingerprint for dedupe and for grouping identical errors later.
function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

// The reporter cannot report its own failures to client_errors — that is the
// thing that just failed, and calling back into reportError would loop. The
// console is the only sink left, so use it: a silent catch here is exactly the
// 100%-failing-write-path trap (memory: feedback_swallowed_errors_must_report).
function warn(what: string, detail?: unknown): void {
  try {
    console.warn(`[report-error] ${what}`, detail ?? "");
  } catch {
    // console itself is gone; nothing further to try.
  }
}

function decodeBase64Url(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Read one logical cookie, reassembling @supabase/ssr's chunks (`name`, or
// `name.0` + `name.1` + … when the session exceeds 3180 bytes). Values in
// document.cookie are URI-encoded; each chunk is decoded before concatenation,
// mirroring what the library's own storage adapter does.
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const jar = new Map<string, string>();
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    try {
      jar.set(k, decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      jar.set(k, part.slice(eq + 1).trim());
    }
  }
  const whole = jar.get(name);
  if (whole) return whole;
  const chunks: string[] = [];
  for (let i = 0; ; i++) {
    const chunk = jar.get(`${name}.${i}`);
    if (!chunk) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks.join("") : null;
}

function jwtSub(accessToken: string): string | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  const claims: unknown = JSON.parse(decodeBase64Url(payload));
  const sub =
    claims && typeof claims === "object"
      ? (claims as { sub?: unknown }).sub
      : undefined;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

type CookieSession = { accessToken: string; userId: string | null };

// Synchronous, zero-network read of the stored session. This is deliberately a
// direct read of the cookie rather than supabase.auth.getSession(): getSession()
// is async, takes the auth lock, and will silently go to the network to refresh
// an expired token — reintroducing the exact round trip that lost the report.
//
// An EXPIRED access token still carries the right `sub`, so user_id stays
// correct even when the beacon itself is refused; the fallback below then
// re-sends the row through the library, which refreshes properly.
function readSessionFromCookie(): CookieSession | null {
  let raw: string | null;
  try {
    raw = readCookie(authCookieName());
  } catch {
    return null; // NEXT_PUBLIC_SUPABASE_URL missing (SSR/tests) — not fatal.
  }
  if (!raw) return null;

  let decoded = raw;
  if (raw.startsWith("base64-")) {
    try {
      decoded = decodeBase64Url(raw.slice("base64-".length));
    } catch {
      return null;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }

  // Current @supabase/ssr stores the whole session object. Older releases stored
  // a positional array whose first element is the access token.
  const session = Array.isArray(parsed)
    ? { access_token: parsed[0] as unknown }
    : (parsed as { access_token?: unknown; user?: { id?: unknown } } | null);
  const accessToken = session?.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;

  let userId: string | null = null;
  try {
    userId = jwtSub(accessToken);
  } catch {
    userId = null;
  }
  if (userId === null && !Array.isArray(parsed)) {
    const fromSession = (parsed as { user?: { id?: unknown } } | null)?.user?.id;
    if (typeof fromSession === "string") userId = fromSession;
  }

  return { accessToken, userId };
}

// "unavailable" — we could not even build the request (no env, no session, no
//                 fetch). Nothing is in flight; fall back to the library.
// "refused"     — the server answered and said no (e.g. 401 on an expired
//                 token). Nothing was written; fall back.
// "aborted"     — fetch rejected. With keepalive the browser may still deliver
//                 it, so do NOT re-send: a duplicate error row is worse noise
//                 than a logged warning.
type Delivery = "ok" | "refused" | "aborted" | "unavailable";

function beaconInsert(
  row: ErrorRow,
  session: CookieSession | null,
): Promise<Delivery> | null {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !apiKey) return null;
  if (!session) return null; // RLS is `to authenticated`; anon would 401 anyway.
  if (typeof fetch !== "function") return null;

  try {
    return fetch(`${baseUrl}/rest/v1/client_errors`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    }).then(
      (res) => {
        if (res.ok) return "ok" as const;
        warn(`beacon refused (${res.status})`);
        return "refused" as const;
      },
      (err) => {
        warn("beacon aborted", err);
        return "aborted" as const;
      },
    );
  } catch (err) {
    warn("beacon could not be dispatched", err);
    return null;
  }
}

export async function reportError(
  error: unknown,
  context?: { url?: string | null },
): Promise<void> {
  // ---- synchronous section -------------------------------------------------
  // Everything down to the fetch() runs in the caller's task. Do not introduce
  // an `await` above the beacon: that is the bug this file exists to prevent.
  let row: ErrorRow | null = null;
  let beacon: Promise<Delivery> | null = null;
  try {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    const stack = error instanceof Error ? error.stack ?? "" : "";
    const stackHash = hashString(`${message}\n${stack}`);

    const now = Date.now();
    const last = recentReports.get(stackHash);
    if (last !== undefined && now - last < WINDOW_MS) return; // deduped
    recentReports.set(stackHash, now);

    const url =
      context?.url ??
      (typeof window !== "undefined" ? window.location.href : null);

    const session = readSessionFromCookie();
    row = {
      user_id: session?.userId ?? null,
      message: message.slice(0, 2000),
      stack_hash: stackHash,
      url,
    };
    beacon = beaconInsert(row, session);
  } catch (err) {
    warn("could not build the report", err);
    return;
  }

  // ---- async section -------------------------------------------------------
  // Only reached if the page is still alive. If it isn't, the keepalive request
  // above finishes on its own and nothing below needs to run.
  try {
    const delivery: Delivery = beacon ? await beacon : "unavailable";
    if (delivery === "ok" || delivery === "aborted") return;

    // Fallback: the library client. Slower and abortable, but it refreshes an
    // expired token and re-derives the URL/headers, so it recovers the cases the
    // raw beacon cannot (expired JWT, cookie shape we failed to parse).
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("client_errors")
      .insert(row);
    if (insertError) warn("fallback insert failed", insertError.message);
  } catch (err) {
    warn("fallback insert threw", err);
  }
}

// Test seam: the dedupe map is module-scoped on purpose (it must survive
// re-renders), which makes it leak between tests.
export function __resetReportErrorDedupeForTests(): void {
  recentReports.clear();
}
