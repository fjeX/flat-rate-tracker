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
import { createClient } from "@/lib/supabase/client";

const WINDOW_MS = 60_000;
// hash -> last-report epoch ms. Module-scoped so it survives re-renders.
const recentReports = new Map<string, number>();

// Tiny, dependency-free string hash (djb2-ish). Not cryptographic — just a
// stable fingerprint for dedupe and for grouping identical errors later.
function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export async function reportError(
  error: unknown,
  context?: { url?: string | null },
): Promise<void> {
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

    const supabase = createClient();
    const { data } = await supabase.auth.getUser();

    await supabase.from("client_errors").insert({
      user_id: data.user?.id ?? null,
      message: message.slice(0, 2000),
      stack_hash: stackHash,
      url,
    });
  } catch {
    // Swallow — reporting must never crash the caller.
  }
}
