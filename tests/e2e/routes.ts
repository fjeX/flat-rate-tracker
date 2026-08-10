/**
 * Every route in the app, for both the canary suite (tests/e2e) and the
 * post-deploy health smoke (tests/smoke/health.smoke.ts).
 *
 * This file used to carry a `mask` list per route — the selectors whose content
 * was live data, excluded from pixel comparison so the bot account's nightly ROs
 * wouldn't fail the snapshots. It didn't work: masking hides pixels but not
 * height, so pages kept growing and the baselines failed anyway. Fixture mode
 * pins the data and the clock instead, which removed the reason to mask at all
 * and got the numerals and charts back under the gate.
 */
export type RouteSpec = {
  /** snapshot + test name */
  name: string;
  path: string;
  /** true = behind the app's auth gate (stubbed in fixture mode) */
  auth: boolean;
};

export const ROUTES: RouteSpec[] = [
  // ── public ─────────────────────────────────────────────
  { name: "landing", path: "/", auth: false },
  { name: "signin", path: "/signin", auth: false },
  { name: "signup", path: "/signup", auth: false },

  // ── guest mirrors ──────────────────────────────────────
  { name: "guest-log", path: "/guest/log", auth: false },
  { name: "guest-history", path: "/guest/history", auth: false },
  { name: "guest-timer", path: "/guest/timer", auth: false },
  { name: "guest-op-codes", path: "/guest/op-codes", auth: false },

  // ── authed ─────────────────────────────────────────────
  { name: "dashboard", path: "/dashboard", auth: true },
  { name: "log", path: "/log", auth: true },
  { name: "history", path: "/history", auth: true },
  { name: "timer", path: "/timer", auth: true },
  { name: "op-codes", path: "/op-codes", auth: true },
  { name: "pay-period", path: "/pay-period", auth: true },
  { name: "account", path: "/account", auth: true },
  { name: "schedule", path: "/schedule", auth: true },
  { name: "snapshots", path: "/snapshots", auth: true },
  { name: "insights", path: "/insights", auth: true },
  { name: "settings", path: "/settings", auth: true },
  { name: "dispute-pack", path: "/pay-period/dispute-pack", auth: true },
];
