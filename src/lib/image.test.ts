import { describe, it, expect } from "vitest";
import { fitLongEdge } from "./image";

describe("fitLongEdge", () => {
  it("leaves an image that already fits unchanged", () => {
    expect(fitLongEdge(1600, 1200, 2000)).toEqual({ width: 1600, height: 1200 });
  });

  it("returns the exact dimensions when the long edge equals the cap", () => {
    expect(fitLongEdge(2000, 1000, 2000)).toEqual({ width: 2000, height: 1000 });
  });

  it("scales a landscape image so the width becomes the cap", () => {
    // 4000x3000 → long edge 4000 → scale 0.5 → 2000x1500
    expect(fitLongEdge(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it("scales a portrait image so the height becomes the cap", () => {
    // 3000x4000 → long edge 4000 → scale 0.5 → 1500x2000
    expect(fitLongEdge(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it("preserves aspect ratio within rounding for non-integer scales", () => {
    // 3024x4032 (typical phone portrait) → scale 2000/4032
    const { width, height } = fitLongEdge(3024, 4032, 2000);
    expect(height).toBe(2000);
    expect(width).toBe(Math.round(3024 * (2000 / 4032))); // 1500
  });

  it("never produces a zero dimension for extreme aspect ratios", () => {
    const { width, height } = fitLongEdge(10000, 5, 2000);
    expect(width).toBe(2000);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("handles a zero-size input without dividing by zero", () => {
    expect(fitLongEdge(0, 0, 2000)).toEqual({ width: 0, height: 0 });
  });
});
