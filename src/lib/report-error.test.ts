// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The library client is only the FALLBACK path now, but it has to stay mockable
// because the whole point of the regression test below is what happens when its
// network calls never come back.
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  insert: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    mocks.createClient();
    return {
      auth: { getUser: mocks.getUser },
      from: () => ({ insert: mocks.insert }),
    };
  },
}));

import {
  reportError,
  __resetReportErrorDedupeForTests,
} from "./report-error";

const SUPABASE_URL = "https://api.slimelab.cc";
const PUBLISHABLE_KEY = "sb_publishable_testkey";
const COOKIE_NAME = "sb-api-auth-token"; // derived from the URL's first label
const USER_ID = "11111111-2222-3333-4444-555555555555";

// ---------------------------------------------------------------------------
// fixtures

function base64url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(sub: string): string {
  return [
    base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64url(JSON.stringify({ sub, role: "authenticated", exp: 1 })),
    "signature-not-verified-here",
  ].join(".");
}

function sessionCookieValue(sub = USER_ID): string {
  const session = {
    access_token: makeJwt(sub),
    refresh_token: "rt",
    expires_at: 1,
    token_type: "bearer",
    user: { id: sub, email: "tech@example.com" },
  };
  return "base64-" + base64url(JSON.stringify(session));
}

// jsdom's own cookie jar is awkward to clear between tests; a plain string with
// the same shape document.cookie hands back is enough for a synchronous read.
let cookieJar = "";
function setCookies(pairs: Record<string, string>): void {
  cookieJar = Object.entries(pairs)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Did the crash reach the database by ANY route? Transport-agnostic on purpose
 *  so the regression test is a fair question to ask of the old implementation. */
function wroteARow(): boolean {
  const viaBeacon = fetchMock.mock.calls.some(([url]) =>
    String(url).includes("/rest/v1/client_errors"),
  );
  return viaBeacon || mocks.insert.mock.calls.length > 0;
}

function beaconBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes("/rest/v1/client_errors"),
  );
  if (!call) throw new Error("no beacon was sent");
  return JSON.parse((call[1] as RequestInit).body as string);
}

function beaconInit(): RequestInit {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes("/rest/v1/client_errors"),
  );
  if (!call) throw new Error("no beacon was sent");
  return call[1] as RequestInit;
}

beforeEach(() => {
  __resetReportErrorDedupeForTests();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);

  cookieJar = "";
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => cookieJar,
    set: (v: string) => {
      cookieJar = v;
    },
  });
  setCookies({ [COOKIE_NAME]: sessionCookieValue() });

  fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);

  // Default: the library fallback works, if anything reaches it.
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mocks.insert.mockResolvedValue({ error: null });

  vi.spyOn(console, "warn").mockImplementation(() => {});
  window.history.replaceState({}, "", "/pay-period");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// THE REGRESSION. This is the 2026-08-19 22:50Z incident in miniature.

describe("survives a navigation that kills in-flight requests", () => {
  it("writes the row even when the auth round trip never comes back", async () => {
    // Kong logged GET /auth/v1/user -> 499 (client closed request). Model that
    // as a getUser() that simply never settles.
    mocks.getUser.mockReturnValue(new Promise(() => {}));

    // Deliberately NOT awaited: under the old implementation this promise never
    // resolves, which is precisely the bug.
    void reportError(new Error("boom"));
    await flush();

    expect(wroteARow()).toBe(true);
  });

  it("does not consult the auth endpoint at all", async () => {
    await reportError(new Error("boom"));
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/auth/v1/")),
    ).toBe(false);
  });

  it("dispatches the write synchronously, before the caller yields", () => {
    // No await anywhere: if the request is not already in flight when
    // reportError() returns its promise, an unmount/navigation can still lose it.
    void reportError(new Error("boom"));
    expect(wroteARow()).toBe(true);
  });

  it("marks the request keepalive so the browser finishes it after teardown", async () => {
    await reportError(new Error("boom"));
    expect(beaconInit().keepalive).toBe(true);
  });

  it("still records the row when the response is discarded mid-navigation", async () => {
    // A torn-down document means the .then() never runs. Assert on what was
    // dispatched, not on what came back.
    fetchMock.mockReturnValue(new Promise(() => {}));
    void reportError(new Error("boom"));
    await flush();
    expect(beaconBody()).toMatchObject({ message: "boom" });
  });
});

// ---------------------------------------------------------------------------
// FIELD PARITY. Same four columns, same values as the pre-fix reporter.

describe("field parity with the previous reporter", () => {
  it("sends exactly user_id, message, stack_hash, url", async () => {
    const err = new Error("kaboom");
    err.stack = "Error: kaboom\n    at Thing (thing.tsx:1:1)";

    await reportError(err);

    const body = beaconBody();
    expect(Object.keys(body).sort()).toEqual([
      "message",
      "stack_hash",
      "url",
      "user_id",
    ]);
    expect(body.user_id).toBe(USER_ID);
    expect(body.message).toBe("kaboom");
    expect(typeof body.stack_hash).toBe("string");
    expect((body.stack_hash as string).length).toBeGreaterThan(0);
    expect(body.url).toBe("http://localhost:3000/pay-period");
  });

  it("hashes message+stack the same way the old reporter did", async () => {
    // djb2-ish over `${message}\n${stack}` — pinned so a refactor can't quietly
    // regroup historical rows.
    const err = new Error("kaboom");
    err.stack = "STACK";
    let h = 5381;
    for (const ch of "kaboom\nSTACK") h = (h * 33) ^ ch.charCodeAt(0);
    const expected = (h >>> 0).toString(36);

    await reportError(err);
    expect(beaconBody().stack_hash).toBe(expected);
  });

  it("truncates message at 2000 characters", async () => {
    await reportError(new Error("x".repeat(5000)));
    expect((beaconBody().message as string).length).toBe(2000);
  });

  it("stringifies non-Error throwables and handles null", async () => {
    await reportError("just a string");
    expect(beaconBody().message).toBe("just a string");

    __resetReportErrorDedupeForTests();
    fetchMock.mockClear();
    await reportError(null);
    expect(beaconBody().message).toBe("Unknown error");
  });

  it("prefers an explicit context.url over window.location", async () => {
    await reportError(new Error("boom"), { url: "/history?ro=1234" });
    expect(beaconBody().url).toBe("/history?ro=1234");
  });

  it("still dedupes identical errors inside the 60s window", async () => {
    // A render-loop refires the same error object; dedupe keys on message+stack.
    const err = new Error("same");
    err.stack = "Error: same\n    at Loop (loop.tsx:1:1)";
    await reportError(err);
    await reportError(err);
    const writes = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/rest/v1/client_errors"),
    );
    expect(writes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// IDENTITY, read synchronously out of the session cookie.

describe("identity", () => {
  it("takes user_id from the JWT sub claim (what auth.uid() will see)", async () => {
    setCookies({ [COOKIE_NAME]: sessionCookieValue("aaaa-bbbb") });
    await reportError(new Error("boom"));
    expect(beaconBody().user_id).toBe("aaaa-bbbb");
  });

  it("sends the access token as a bearer credential plus the apikey", async () => {
    await reportError(new Error("boom"));
    const headers = beaconInit().headers as Record<string, string>;
    expect(headers.apikey).toBe(PUBLISHABLE_KEY);
    expect(headers.Authorization).toMatch(/^Bearer eyJ|^Bearer [A-Za-z0-9_-]+\./);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("reassembles a chunked session cookie", async () => {
    const value = sessionCookieValue();
    const half = Math.ceil(value.length / 2);
    setCookies({
      [`${COOKIE_NAME}.0`]: value.slice(0, half),
      [`${COOKIE_NAME}.1`]: value.slice(half),
    });
    await reportError(new Error("boom"));
    expect(beaconBody().user_id).toBe(USER_ID);
  });

  it("reads a legacy plain-JSON (non base64-) cookie", async () => {
    setCookies({
      [COOKIE_NAME]: JSON.stringify({ access_token: makeJwt(USER_ID) }),
    });
    await reportError(new Error("boom"));
    expect(beaconBody().user_id).toBe(USER_ID);
  });

  it("falls back to session.user.id when the JWT payload is unreadable", async () => {
    setCookies({
      [COOKIE_NAME]:
        "base64-" +
        base64url(
          JSON.stringify({
            access_token: "not.a.jwt",
            user: { id: "from-session-object" },
          }),
        ),
    });
    await reportError(new Error("boom"));
    expect(beaconBody().user_id).toBe("from-session-object");
  });
});

// ---------------------------------------------------------------------------
// FALLBACK + FAILURE BEHAVIOUR

describe("fallback to the library client", () => {
  it("re-sends through supabase-js when the beacon is refused (expired token)", async () => {
    fetchMock.mockResolvedValue(new Response("JWT expired", { status: 401 }));
    await reportError(new Error("boom"));
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({
      user_id: USER_ID,
      message: "boom",
    });
  });

  it("uses the library client when there is no session cookie to build a beacon", async () => {
    setCookies({ other: "cookie" });
    await reportError(new Error("boom"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    // A row with no identity is legal: the insert policy allows user_id is null,
    // and the DB trigger stamps inserted_by from the JWT regardless.
    expect(mocks.insert.mock.calls[0][0].user_id).toBeNull();
  });

  it("does NOT re-send when the beacon was aborted — keepalive may still land it", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await reportError(new Error("boom"));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[report-error] beacon aborted",
      expect.anything(),
    );
  });

  it("does not re-send after a successful beacon", async () => {
    await reportError(new Error("boom"));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("a failing reporter is loud in the console, never silent", () => {
  it("warns when the beacon is refused", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await reportError(new Error("boom"));
    expect(console.warn).toHaveBeenCalledWith(
      "[report-error] beacon refused (401)",
      "",
    );
  });

  it("warns when the fallback insert returns an error", async () => {
    setCookies({});
    mocks.insert.mockResolvedValue({ error: { message: "rate limit" } });
    await reportError(new Error("boom"));
    expect(console.warn).toHaveBeenCalledWith(
      "[report-error] fallback insert failed",
      "rate limit",
    );
  });

  it("warns when the fallback insert throws", async () => {
    setCookies({});
    mocks.insert.mockRejectedValue(new Error("network down"));
    await reportError(new Error("boom"));
    expect(console.warn).toHaveBeenCalledWith(
      "[report-error] fallback insert threw",
      expect.anything(),
    );
  });
});

describe("never throws, never loops", () => {
  it("survives a garbage cookie", async () => {
    setCookies({ [COOKIE_NAME]: "base64-%%%not-base64%%%" });
    await expect(reportError(new Error("boom"))).resolves.toBeUndefined();
    // No usable session -> falls through to the library client.
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("survives a cookie holding non-JSON", async () => {
    setCookies({ [COOKIE_NAME]: "base64-" + base64url("not json at all") });
    await expect(reportError(new Error("boom"))).resolves.toBeUndefined();
  });

  it("survives missing NEXT_PUBLIC env vars", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    await expect(reportError(new Error("boom"))).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("survives fetch being unavailable entirely", async () => {
    vi.stubGlobal("fetch", undefined);
    await expect(reportError(new Error("boom"))).resolves.toBeUndefined();
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("survives a throwable that cannot be stringified", async () => {
    const hostile = {
      toString() {
        throw new Error("nope");
      },
    };
    await expect(reportError(hostile)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      "[report-error] could not build the report",
      expect.anything(),
    );
  });
});
