import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { RETRY_ATTEMPT_HEADER, retryAwareFetch, retryOnce } from "./_client";

/**
 * The test that would have caught the four weeks retryOnce spent doing nothing.
 *
 * `render-path-retry.test.ts` and `timers.retry.test.ts` hand the data layer a
 * hand-written fake client, so they exercise retryOnce ABOVE the fetch layer:
 * they were green the entire time the wrapper could not reach PostgREST. The
 * only thing that proves a retry happened is a count of requests the SERVER
 * actually received, so that is what every assertion here is about.
 *
 * The rig is Next's real dedupe:
 *   - the actual `createDedupeFetch` source out of node_modules, evaluated by
 *     hand only so its `require("react")` can be pointed at React's
 *     react-server build. Vitest resolves bare "react" to the client build,
 *     whose `cache()` is `fn.apply(null, arguments)` — no memo, no dedupe, and
 *     a test that passes against the broken code.
 *   - a stand-in cache dispatcher, which is what Next opens per render.
 *   - a real HTTP server standing in for PostgREST, counting hits.
 *
 * The first three tests are ordered as a proof: the rig dedupes, the shipped
 * bug reproduces in it, the fix clears it.
 */

const PGRST303 = {
  code: "PGRST303",
  details: null,
  hint: null,
  message: "JWT issued at future",
};

// --- Next's real dedupe fetch, bound to React's react-server build ----------
const req = createRequire(import.meta.url);
const reactDir = path.dirname(req.resolve("react/package.json"));
// Direct file path on purpose: react's exports map only surfaces the
// react-server build under the "react-server" condition, which vitest is not
// running with.
const reactServer = req(path.join(reactDir, "react.react-server.js"));
const dedupePath = req.resolve("next/dist/server/lib/dedupe-fetch.js");
const dedupeRequire = createRequire(dedupePath);
const dedupeModule = { exports: {} as Record<string, unknown> };
new Function(
  "exports",
  "require",
  "module",
  "__filename",
  "__dirname",
  readFileSync(dedupePath, "utf8"),
)(
  dedupeModule.exports,
  (id: string) => (id === "react" ? reactServer : dedupeRequire(id)),
  dedupeModule,
  dedupePath,
  path.dirname(dedupePath),
);
const createDedupeFetch = dedupeModule.exports.createDedupeFetch as (
  f: typeof fetch,
) => typeof fetch;

// The cache scope React opens for one render. Resetting it is what "the next
// HTTP request" means here.
const internals = (
  reactServer as {
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: {
      A: unknown;
    };
  }
).__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
if (!internals) throw new Error("no react-server internals — wrong React build");

let cacheScope = new Map<unknown, unknown>();
internals.A = {
  getCacheForType(resourceType: () => unknown) {
    let v = cacheScope.get(resourceType);
    if (v === undefined) {
      v = resourceType();
      cacheScope.set(resourceType, v);
    }
    return v;
  },
  cacheSignal: () => null,
};

// --- counting PostgREST stand-in -------------------------------------------
type Hit = { url: string; headers: http.IncomingHttpHeaders; method: string };
const hits: Hit[] = [];
/** nonce -> how many times it has already 401'd, and how many it is allowed. */
const failuresLeft = new Map<string, number>();
let server: http.Server;
let baseUrl = "";

beforeAll(async () => {
  server = http.createServer((rq, res) => {
    hits.push({ url: rq.url ?? "", headers: rq.headers, method: rq.method ?? "" });
    const nonce = (new URL(rq.url ?? "", "http://x").searchParams.get("nonce") ?? "")
      .replace(/^eq\./, "");
    const left = failuresLeft.get(nonce) ?? 0;
    if (left > 0) {
      failuresLeft.set(nonce, left - 1);
      // Verbatim shape of the production rejection, status included.
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify(PGRST303));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{ nonce, ok: true }]));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Exactly what Next does to globalThis.fetch on the server.
  realFetch = globalThis.fetch;
  globalThis.fetch = createDedupeFetch(realFetch);
});

let realFetch: typeof fetch;
afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((r) => server.close(() => r()));
});

let nonceSeq = 0;
/** New render: fresh dedupe cache, fresh hit log, fresh row key. */
function newRender(failures = 0) {
  cacheScope = new Map();
  hits.length = 0;
  const nonce = `n${++nonceSeq}`;
  failuresLeft.set(nonce, failures);
  return nonce;
}

/** `retryAware: false` is the client exactly as it shipped before the fix. */
function mkClient(retryAware: boolean) {
  return createClient(baseUrl, "test-anon-key", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(retryAware ? { global: { fetch: retryAwareFetch } } : {}),
  });
}

/** A data-layer read, shaped like every one in src/lib/db: throw on error. */
async function read(client: ReturnType<typeof mkClient>, nonce: string) {
  const { data, error } = await client.from("entries").select("*").eq("nonce", nonce);
  if (error) throw error;
  return data;
}

const retryHeaders = () => hits.map((h) => h.headers[RETRY_ATTEMPT_HEADER]);

describe("Next's per-render fetch dedupe (the rig itself)", () => {
  it("collapses two byte-identical reads in one render into ONE upstream request", async () => {
    const nonce = newRender();
    await Promise.all([read(mkClient(false), nonce), read(mkClient(false), nonce)]);
    expect(hits.length).toBe(1);
  });

  it("does NOT collapse two different reads, and does not carry across renders", async () => {
    // Without this control the test above would also pass against a rig that
    // simply never issued a second request.
    const a = newRender();
    const b = `${a}-other`;
    await Promise.all([read(mkClient(false), a), read(mkClient(false), b)]);
    expect(hits.length).toBe(2);

    cacheScope = new Map(); // the next HTTP request
    await read(mkClient(false), a);
    expect(hits.length).toBe(3);
  });
});

describe("retryOnce against the real dedupe", () => {
  it("REGRESSION: an unmarked second attempt never reaches PostgREST", async () => {
    // This is the shipped bug, reproduced. The client has no retry-aware
    // fetch, so attempt 2 rebuilds a byte-identical GET, hashes to attempt 1's
    // cache key, and is handed the cached 401 back.
    const nonce = newRender(1);
    await expect(retryOnce(() => read(mkClient(false), nonce), 0)).rejects.toMatchObject({
      code: "PGRST303",
    });
    expect(hits.length).toBe(1);
  });

  it("retries for real: 2 upstream requests, and the read succeeds", async () => {
    const nonce = newRender(1);
    const rows = await retryOnce(() => read(mkClient(true), nonce), 0);

    // The assertion that matters. A `rows` check alone would pass against a
    // mock that never deduped anything.
    expect(hits.length).toBe(2);
    expect(rows).toEqual([{ nonce, ok: true }]);
  });

  it("marks ONLY the second attempt, and marks it in a way dedupe keys on", async () => {
    const nonce = newRender(1);
    await retryOnce(() => read(mkClient(true), nonce), 0);

    expect(retryHeaders()).toEqual([undefined, "1"]);
    // Both attempts are the same URL and method — the header is the entire
    // difference, so it is the entire reason attempt 2 was not deduped.
    expect(hits[0].url).toBe(hits[1].url);
    expect(hits[0].method).toBe("GET");
    expect(hits[1].method).toBe("GET");
  });

  it("stops at two: a second PGRST303 rethrows and issues no third request", async () => {
    const nonce = newRender(99);
    await expect(retryOnce(() => read(mkClient(true), nonce), 0)).rejects.toMatchObject({
      code: "PGRST303",
    });
    expect(hits.length).toBe(2);
  });

  it("leaves ordinary reads alone — no header, and they still dedupe", async () => {
    // The seam must be inert outside a retry. If it stamped every request the
    // app would lose Next's dedupe entirely and quietly double its read load.
    const nonce = newRender();
    await Promise.all([read(mkClient(true), nonce), read(mkClient(true), nonce)]);
    expect(hits.length).toBe(1);
    expect(retryHeaders()).toEqual([undefined]);
  });

  it("does not mark requests made after the retry has resolved", async () => {
    const nonce = newRender(1);
    await retryOnce(() => read(mkClient(true), nonce), 0);
    const after = `${nonce}-after`;
    await read(mkClient(true), after);
    expect(hits.length).toBe(3);
    expect(hits[2].headers[RETRY_ATTEMPT_HEADER]).toBeUndefined();
  });
});

describe("the seam is actually wired into the app's server client", () => {
  // Everything above builds its own client, so it would stay green if
  // lib/supabase/server.ts stopped passing retryAwareFetch — and the wrapper
  // would be inert in production again with a full green suite, which is the
  // exact failure mode this whole file exists to end. Pin the wiring at the
  // source. (It cannot be pinned by calling createClient(): that factory calls
  // next/headers cookies(), which throws outside a request.)
  const serverClientSrc = readFileSync(
    path.join(process.cwd(), "src/lib/supabase/server.ts"),
    "utf8",
  );
  const WIRED = /global:\s*\{[^}]*fetch:\s*retryAwareFetch/;

  it("passes retryAwareFetch as the server client's global.fetch", () => {
    expect(serverClientSrc).toMatch(/import \{ retryAwareFetch \} from "@\/lib\/db\/_client"/);
    expect(serverClientSrc).toMatch(WIRED);
  });

  it("the wiring check can actually fail", () => {
    expect(WIRED.test("createServerClient(url, key, { cookieOptions: {} })")).toBe(false);
  });
});

describe("no write is ever wrapped in retryOnce", () => {
  // PostgREST cannot tell you whether a rejected request reached the database,
  // so a retried insert risks a duplicate row. retryOnce is applied by hand at
  // named reads for exactly that reason; this pins it against the sources
  // rather than against a comment.
  const dbDir = path.join(process.cwd(), "src/lib/db");
  const MUTATIONS = /\.(insert|upsert|update|delete)\s*\(/;

  it("contains no mutation inside any retryOnce callback", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(dbDir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )) {
      const src = readFileSync(path.join(dbDir, file), "utf8");
      for (let i = src.indexOf("retryOnce("); i !== -1; i = src.indexOf("retryOnce(", i + 1)) {
        // Walk to the matching close paren of the retryOnce call.
        let depth = 0;
        let end = i + "retryOnce".length;
        for (; end < src.length; end++) {
          if (src[end] === "(") depth++;
          else if (src[end] === ")" && --depth === 0) break;
        }
        const body = src.slice(i, end);
        if (MUTATIONS.test(body)) offenders.push(`${file}: ${body.slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the guard above can actually see a mutation", () => {
    // Negative assertions go vacuous. Same regex, same shape, one that MUST match.
    expect(MUTATIONS.test('retryOnce(async () => supabase.from("x").insert(row))')).toBe(true);
  });
});
