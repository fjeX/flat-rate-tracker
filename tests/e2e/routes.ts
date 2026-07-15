/**
 * Every route in the app, with the selectors whose CONTENT is live data
 * (the bot account logs new ROs nightly, dates roll over, etc.). Masked
 * regions are excluded from pixel comparison — their layout is still
 * covered by the quality checks in quality.spec.ts.
 */
export type RouteSpec = {
  /** snapshot + test name */
  name: string;
  path: string;
  auth: boolean;
  /** selectors masked out of visual snapshots (dynamic data) */
  mask: string[];
};

// Dynamic-data selectors shared by several pages. Data numerals in FRT
// consistently use the mono/tabular classes, which makes "mask the numbers,
// keep the layout" cheap.
const NUMBERS = [".mono", ".tabular", ".font-mono", ".rn"];
const RO_LISTS = [".ro-list", ".history-ro-row", ".ro-row"];
const CHARTS = [".r-chart-wrap", ".r-readout", ".r-footer", ".period-bars-card"];
const DATES = ['input[type="date"]', "time"];

export const ROUTES: RouteSpec[] = [
  // ── public ─────────────────────────────────────────────
  { name: "landing", path: "/", auth: false, mask: [] },
  { name: "signin", path: "/signin", auth: false, mask: [] },
  { name: "signup", path: "/signup", auth: false, mask: [] },

  // ── guest mirrors (deterministic empty state) ──────────
  { name: "guest-log", path: "/guest/log", auth: false, mask: DATES },
  { name: "guest-history", path: "/guest/history", auth: false, mask: CHARTS },
  { name: "guest-timer", path: "/guest/timer", auth: false, mask: [".rn"] },
  { name: "guest-op-codes", path: "/guest/op-codes", auth: false, mask: [] },

  // ── authed (bot account data churns nightly — mask it) ─
  // .gami-* fills/pins move with the bot's nightly logging — mask whole cards.
  { name: "dashboard", path: "/dashboard", auth: true, mask: [".greeting", ".pace", ".gami-heat", ".gami-odo", ".gami-snap", ...NUMBERS, ...RO_LISTS, ...CHARTS, ...DATES] },
  { name: "log", path: "/log", auth: true, mask: [".opc-quick", ...DATES] },
  { name: "history", path: "/history", auth: true, mask: [".history-summary", ...NUMBERS, ...RO_LISTS, ...CHARTS] },
  { name: "timer", path: "/timer", auth: true, mask: [...NUMBERS, ...RO_LISTS, ...DATES] },
  { name: "op-codes", path: "/op-codes", auth: true, mask: ["main ul", "main ol", ...NUMBERS] },
  { name: "pay-period", path: "/pay-period", auth: true, mask: [".stat-grid", ".pill", "input", ...NUMBERS, ...RO_LISTS, ...DATES] },
  { name: "account", path: "/account", auth: true, mask: ["main"] },
  { name: "snapshots", path: "/snapshots", auth: true, mask: [".gami-sheet", ...NUMBERS] },
  { name: "settings", path: "/settings", auth: true, mask: ["input", "select", ...NUMBERS] },
  { name: "dispute-pack", path: "/pay-period/dispute-pack", auth: true, mask: [".dp-meta", ".dp-table-wrap", ".dp-header", ".dp-footer"] },
];
