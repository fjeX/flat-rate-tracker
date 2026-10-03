/**
 * History's filters, as a query string.
 *
 * The page used to keep range, dates, search, sort and the picked chart bar in
 * useState, so a reload (or a phone that reopened the tab after a call) put
 * the tech back at the default view. These helpers move that state through the
 * URL: the server parses `searchParams` into the first render, and the client
 * writes it back with replaceState as it changes.
 *
 * Canonical order: range, from, to, q, sort, dir, bar. A param that equals its
 * default is left out, so plain /history stays plain. Anything else already in
 * the query string is not ours and is carried through untouched.
 */

export type HistoryRange = "today" | "week" | "period" | "month" | "all" | "custom";
export type HistorySort = "date" | "hours" | "ro_number";
export type HistoryDir = "asc" | "desc";

export type HistoryUrlState = {
  range: HistoryRange;
  /** Custom range start, YYYY-MM-DD. Meaningful when range is "custom". */
  from: string;
  /** Custom range end, YYYY-MM-DD. */
  to: string;
  q: string;
  sort: HistorySort;
  dir: HistoryDir;
  /** The picked chart bar's dates, or null. */
  bar: { start: string; end: string } | null;
};

export const HISTORY_RANGES: readonly HistoryRange[] = ["today", "week", "period", "month", "all", "custom"];
const SORTS: readonly HistorySort[] = ["date", "hours", "ro_number"];
const DIRS: readonly HistoryDir[] = ["desc", "asc"];
const OURS = ["range", "from", "to", "q", "sort", "dir", "bar"];
const MAX_Q = 200;

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-31). */
export function isIsoDate(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Read the query string into a valid state. Every bad value falls back to its
 * default without a word: a stale or hand-edited link should open History, not
 * an error. `defaults` carries the custom range's starting dates (the current
 * pay period through today), which a missing or unusable from/to falls back to.
 */
export function parseHistoryParams(
  params: RawParams,
  defaults: { from: string; to: string },
): HistoryUrlState {
  const rangeRaw = first(params.range);
  const range = (HISTORY_RANGES as readonly string[]).includes(rangeRaw ?? "")
    ? (rangeRaw as HistoryRange)
    : "period";

  let from = defaults.from;
  let to = defaults.to;
  if (range === "custom") {
    const f = first(params.from);
    const t = first(params.to);
    if (isIsoDate(f) && isIsoDate(t) && f <= t) {
      from = f;
      to = t;
    }
  }

  const sortRaw = first(params.sort);
  const dirRaw = first(params.dir);

  const barRaw = first(params.bar);
  let bar: HistoryUrlState["bar"] = null;
  if (barRaw) {
    const [s, e, ...rest] = barRaw.split("_");
    if (rest.length === 0 && isIsoDate(s) && isIsoDate(e) && s <= e) bar = { start: s, end: e };
  }

  return {
    range,
    from,
    to,
    q: (first(params.q) ?? "").slice(0, MAX_Q),
    sort: (SORTS as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as HistorySort) : "date",
    dir: (DIRS as readonly string[]).includes(dirRaw ?? "") ? (dirRaw as HistoryDir) : "desc",
    bar,
  };
}

/**
 * The query string for a state, with the leading `?` (or "" when nothing is
 * non-default). `currentSearch` is the live `location.search`; params that are
 * not History's are kept, after ours.
 */
export function buildHistoryQuery(state: HistoryUrlState, currentSearch = ""): string {
  const out = new URLSearchParams();
  if (state.range !== "period") out.set("range", state.range);
  if (state.range === "custom" && isIsoDate(state.from) && isIsoDate(state.to)) {
    out.set("from", state.from);
    out.set("to", state.to);
  }
  if (state.q) out.set("q", state.q.slice(0, MAX_Q));
  if (state.sort !== "date") out.set("sort", state.sort);
  if (state.dir !== "desc") out.set("dir", state.dir);
  if (state.bar) out.set("bar", `${state.bar.start}_${state.bar.end}`);

  const rest = new URLSearchParams(currentSearch);
  rest.forEach((value, key) => {
    if (!OURS.includes(key)) out.append(key, value);
  });
  const s = out.toString();
  return s ? `?${s}` : "";
}
