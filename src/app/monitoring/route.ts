// Sentry tunnel endpoint. See src/lib/sentry/tunnel.ts for why it exists.
// Excluded from the proxy.ts matcher: it must not refresh sessions or redirect
// signed-out visitors to /signin (a crash on the sign-in page still reports).
import { FIXTURE_MODE } from "@/lib/fixtures/enabled";
import { MAX_ENVELOPE_BYTES, envelopeTarget } from "@/lib/sentry/tunnel";

export async function POST(request: Request): Promise<Response> {
  // The visual-gate canary renders the real browser bundle (real DSN baked in)
  // against frozen data. Accept and drop, so a screenshot never pages anyone.
  if (FIXTURE_MODE) return new Response(null, { status: 204 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_ENVELOPE_BYTES) return new Response(null, { status: 413 });

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_ENVELOPE_BYTES) return new Response(null, { status: 413 });

  const target = envelopeTarget(body, process.env.NEXT_PUBLIC_SENTRY_DSN);
  if (!target) return new Response(null, { status: 400 });

  try {
    const upstream = await fetch(target, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-sentry-envelope" },
      signal: AbortSignal.timeout(10_000),
    });
    // Pass Sentry's status through (429 = rate limited, and the SDK backs off).
    return new Response(null, { status: upstream.status });
  } catch {
    return new Response(null, { status: 502 });
  }
}
