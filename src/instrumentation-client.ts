// Browser-side Sentry. Next runs this file before the app hydrates.
//
// Events go to /monitoring on our own origin (src/app/monitoring/route.ts), not
// straight to sentry.io, so ad/DNS blockers don't swallow them and the
// fixture-mode canary's events can be dropped server-side.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry/options";
import { sessionUserId } from "@/lib/report-error";

const base = sentryOptions();

Sentry.init({
  ...base,
  tunnel: "/monitoring",
  // Attach the user id at SEND time, not init time: the session changes (sign
  // in, sign out) without a full reload. Then scrub as usual.
  beforeSend(event) {
    if (!event.user?.id) {
      const id = sessionUserId();
      if (id) event.user = { id };
    }
    return base.beforeSend(event);
  },
});

// Required by the SDK for App Router navigations. Only produces spans when
// tracing is on, and tracing is off (no tracesSampleRate), so today this sends
// nothing. It just keeps the hook wired for when tracing is turned on.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
