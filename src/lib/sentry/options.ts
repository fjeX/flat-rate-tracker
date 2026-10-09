// Shared Sentry.init options for the browser, Node and edge runtimes.
//
// Sentry is OFF unless NEXT_PUBLIC_SENTRY_DSN is set at build time: local dev and
// CI builds have no DSN, so nothing is sent from them. The VM build passes it.
// Fixture mode is handled by the callers (instrumentation.ts never initialises
// the server SDK; the /monitoring tunnel drops the canary's browser events).
//
// Deliberately absent:
//   * Session Replay — screens are full of pay data. Never add replayIntegration.
//   * Tracing — errors only for now (tracesSampleRate unset = no spans sent).
//   * sendDefaultPii — no IPs, cookies or request bodies. Identity is the
//     Supabase user id only, attached by the reporters.
import { scrubBreadcrumb, scrubEvent } from "./scrub";

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;

export function sentryOptions() {
  return {
    dsn: SENTRY_DSN,
    enabled: Boolean(SENTRY_DSN),
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
      (process.env.NODE_ENV === "production" ? "production" : "development"),
    sendDefaultPii: false,
    beforeSend: <E extends object>(event: E): E => scrubEvent(event),
    beforeBreadcrumb: <B extends object>(breadcrumb: B): B => scrubBreadcrumb(breadcrumb),
  };
}
