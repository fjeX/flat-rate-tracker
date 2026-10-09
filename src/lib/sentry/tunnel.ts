// Sentry tunnel: decide where (and whether) a browser envelope is forwarded.
//
// WHY A TUNNEL
// Ad blockers (and DNS blockers like AdGuard, which blocks sentry.io on Liem's own
// network) silently drop requests to *.sentry.io, so browser errors from exactly
// the users most likely to hit odd bugs never arrive. The browser SDK posts to
// /monitoring on our own origin instead, and the server forwards it.
//
// WHY OUR OWN ROUTE AND NOT withSentryConfig({ tunnelRoute })
// That option is a blind rewrite. A handler lets us (1) refuse to be an open
// relay — only envelopes addressed to OUR project are forwarded — and (2) drop
// everything from the fixture-mode canary, whose browser bundle carries the real
// DSN (NEXT_PUBLIC_* is baked at build) but must never report.
//
// Envelope format: newline-delimited; line 1 is a JSON header that carries the
// DSN the event was meant for. https://develop.sentry.dev/sdk/envelopes/

export const MAX_ENVELOPE_BYTES = 512 * 1024;

type Dsn = { host: string; projectId: string };

export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+|\/+$/g, "");
    if (u.protocol !== "https:" || !u.username || !/^\d+$/.test(projectId)) return null;
    return { host: u.host, projectId };
  } catch {
    return null;
  }
}

// Returns the ingest URL to forward to, or null if the envelope is not ours.
export function envelopeTarget(body: Uint8Array, ownDsn: string | undefined): string | null {
  const own = parseDsn(ownDsn);
  if (!own) return null;
  const nl = body.indexOf(10);
  const headerBytes = nl === -1 ? body : body.subarray(0, nl);
  let header: { dsn?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return null;
  }
  const theirs = parseDsn(typeof header.dsn === "string" ? header.dsn : undefined);
  if (!theirs || theirs.host !== own.host || theirs.projectId !== own.projectId) return null;
  return `https://${own.host}/api/${own.projectId}/envelope/`;
}
