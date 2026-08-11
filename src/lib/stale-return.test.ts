import { describe, expect, it } from "vitest";
import { markAway, shouldRefetch, STALE_AFTER_MS } from "@/lib/stale-return";

describe("markAway", () => {
  it("stamps the departure when the page was present", () => {
    expect(markAway(null, 1_000)).toBe(1_000);
  });

  it("keeps the earliest departure when leaving fires twice", () => {
    // Regression: a desktop alt-tab fires blur and often visibilitychange too.
    // Overwriting on the second restarts the clock on the way out, so a long
    // absence measures as ~0ms and never refetches.
    const first = markAway(null, 1_000);
    expect(markAway(first, 1_050)).toBe(1_000);
  });

  it("treats 0 as a real timestamp, not as absent", () => {
    // `awayAt ?? now` rather than `awayAt || now` — epoch 0 is falsy.
    expect(markAway(0, 5_000)).toBe(0);
  });
});

describe("shouldRefetch", () => {
  it("does not refetch when the page never left", () => {
    expect(shouldRefetch(null, 10_000_000)).toBe(false);
  });

  it("does not refetch after a brief absence", () => {
    expect(shouldRefetch(1_000, 1_000 + STALE_AFTER_MS - 1)).toBe(false);
  });

  it("refetches once the absence reaches the threshold", () => {
    expect(shouldRefetch(1_000, 1_000 + STALE_AFTER_MS)).toBe(true);
  });

  it("refetches after a long absence", () => {
    expect(shouldRefetch(1_000, 1_000 + 3 * 60 * 60 * 1000)).toBe(true);
  });

  it("does not refetch when the clock moved backwards", () => {
    // An NTP correction mid-absence yields a negative elapsed. Refetching on
    // that would fire on every return until the clock caught up.
    expect(shouldRefetch(10_000, 9_000)).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(shouldRefetch(0, 500, 1_000)).toBe(false);
    expect(shouldRefetch(0, 1_000, 1_000)).toBe(true);
  });
});
