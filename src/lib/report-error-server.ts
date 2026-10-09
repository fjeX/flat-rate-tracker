// Server-side counterpart to report-error.ts. Called from server actions and
// route handlers where a catch would otherwise swallow an error into the void.
//
// No client-side dedupe map here — server actions don't render-loop, so the
// flood risk that motivates client dedupe doesn't apply. Like the client
// version, this NEVER throws: a failing reporter must not turn a swallowed
// error into a crash.
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";

function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export async function reportServerError(
  error: unknown,
  context?: { url?: string | null },
): Promise<void> {
  // Sentry gets the error even if Supabase itself is what's broken (then with
  // no user id) — the DB being down is exactly when this matters most.
  let userId: string | undefined;
  try {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    const stack = error instanceof Error ? error.stack ?? "" : "";
    const stackHash = hashString(`${message}\n${stack}`);

    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id;

    await supabase.from("client_errors").insert({
      user_id: userId ?? null,
      message: message.slice(0, 2000),
      stack_hash: stackHash,
      url: context?.url ?? null,
    });
  } catch {
    // Swallow — reporting must never crash the caller.
  } finally {
    // In parallel with client_errors (launch plan step 3). These are errors a
    // catch swallowed, so onRequestError never sees them.
    try {
      Sentry.withScope((scope) => {
        if (userId) scope.setUser({ id: userId });
        if (context?.url) scope.setTag("frt.url", context.url);
        Sentry.captureException(error);
      });
    } catch {
      // Reporting must never crash the caller.
    }
  }
}
