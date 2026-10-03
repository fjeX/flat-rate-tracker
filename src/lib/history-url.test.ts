import { describe, expect, it } from "vitest";
import { buildHistoryQuery, parseHistoryParams, type HistoryUrlState } from "./history-url";

const defaults = { from: "2026-03-01", to: "2026-03-12" };
const base: HistoryUrlState = {
  range: "period",
  from: defaults.from,
  to: defaults.to,
  q: "",
  sort: "date",
  dir: "desc",
  bar: null,
};

describe("parseHistoryParams", () => {
  it("gives the defaults for an empty query", () => {
    expect(parseHistoryParams({}, defaults)).toEqual(base);
  });

  it("reads every param", () => {
    const s = parseHistoryParams(
      { range: "custom", from: "2026-01-05", to: "2026-02-10", q: "brake", sort: "hours", dir: "asc", bar: "2026-02-01_2026-02-07" },
      defaults,
    );
    expect(s).toEqual({
      range: "custom", from: "2026-01-05", to: "2026-02-10", q: "brake", sort: "hours", dir: "asc",
      bar: { start: "2026-02-01", end: "2026-02-07" },
    });
  });

  it("falls back silently on bad values", () => {
    const s = parseHistoryParams({ range: "year", sort: "tbd", dir: "up", bar: "nope" }, defaults);
    expect(s).toEqual(base);
  });

  it("falls back to the default dates when a custom range is backwards or malformed", () => {
    expect(parseHistoryParams({ range: "custom", from: "2026-02-10", to: "2026-01-05" }, defaults)).toMatchObject({
      range: "custom", ...defaults,
    });
    expect(parseHistoryParams({ range: "custom", from: "2026-02-31", to: "2026-03-05" }, defaults)).toMatchObject(defaults);
    expect(parseHistoryParams({ range: "custom", from: "2026-02-01" }, defaults)).toMatchObject(defaults);
  });

  it("ignores from/to unless the range is custom", () => {
    expect(parseHistoryParams({ range: "week", from: "2026-01-01", to: "2026-01-02" }, defaults)).toMatchObject(defaults);
  });

  it("takes the first of a repeated param", () => {
    expect(parseHistoryParams({ q: ["a", "b"] }, defaults).q).toBe("a");
  });

  it("rejects a backwards bar", () => {
    expect(parseHistoryParams({ bar: "2026-02-07_2026-02-01" }, defaults).bar).toBeNull();
  });
});

describe("buildHistoryQuery", () => {
  it("is empty for the default view", () => {
    expect(buildHistoryQuery(base)).toBe("");
  });

  it("writes in canonical order and omits defaults", () => {
    const q = buildHistoryQuery({
      ...base, range: "custom", from: "2026-01-05", to: "2026-02-10", q: "brk", sort: "ro_number", dir: "asc",
      bar: { start: "2026-02-01", end: "2026-02-07" },
    });
    expect(q).toBe("?range=custom&from=2026-01-05&to=2026-02-10&q=brk&sort=ro_number&dir=asc&bar=2026-02-01_2026-02-07");
  });

  it("leaves dates out unless custom", () => {
    expect(buildHistoryQuery({ ...base, range: "week", from: "2026-01-05", to: "2026-02-10" })).toBe("?range=week");
  });

  it("keeps params that are not ours and drops stale ones of ours", () => {
    expect(buildHistoryQuery({ ...base, q: "x" }, "?utm=1&q=old&range=all")).toBe("?q=x&utm=1");
    expect(buildHistoryQuery(base, "?utm=1&q=old")).toBe("?utm=1");
  });

  it("round-trips through parse", () => {
    const state: HistoryUrlState = { ...base, range: "custom", from: "2026-01-05", to: "2026-02-10", q: "a b&c", dir: "asc" };
    const qs = buildHistoryQuery(state);
    const parsed = parseHistoryParams(Object.fromEntries(new URLSearchParams(qs)), defaults);
    expect(parsed).toEqual(state);
  });
});
