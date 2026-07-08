import { describe, it, expect } from "vitest";
import { TOLERANCE, toText, parseHours, verdictFor } from "./discrepancy";

describe("parseHours", () => {
  it("returns null for empty / whitespace-only input", () => {
    expect(parseHours("")).toBeNull();
    expect(parseHours("   ")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseHours("abc")).toBeNull();
  });

  it("returns null for negative numbers", () => {
    expect(parseHours("-1")).toBeNull();
    expect(parseHours("-0.5")).toBeNull();
  });

  it("parses zero and positive decimals", () => {
    expect(parseHours("0")).toBe(0);
    expect(parseHours("12.5")).toBe(12.5);
    expect(parseHours("  42.3 ")).toBe(42.3);
  });

  it("accepts scientific notation (current Number() behavior)", () => {
    // Number("1e2") === 100 — documenting, not endorsing.
    expect(parseHours("1e2")).toBe(100);
  });
});

describe("toText", () => {
  it("maps null to an empty string", () => {
    expect(toText(null)).toBe("");
  });

  it("stringifies a number", () => {
    expect(toText(0)).toBe("0");
    expect(toText(42.3)).toBe("42.3");
  });
});

describe("verdictFor", () => {
  it("returns 'unknown' when paid is null", () => {
    expect(verdictFor(null, 88)).toBe("unknown");
  });

  it("returns 'match' on an exact match", () => {
    expect(verdictFor(88, 88)).toBe("match");
    expect(verdictFor(42.3, 42.3)).toBe("match");
  });

  it("treats a difference within TOLERANCE as a match", () => {
    // ±0.05 is well inside the 0.1 tolerance window.
    expect(verdictFor(42.35, 42.3)).toBe("match");
    expect(verdictFor(42.25, 42.3)).toBe("match");
  });

  it("returns 'missing' when short-paid beyond tolerance", () => {
    expect(verdictFor(40, 42.3)).toBe("missing");
  });

  it("returns 'over' when over-paid beyond tolerance", () => {
    expect(verdictFor(45, 42.3)).toBe("over");
  });

  it("respects IEEE-754 float behavior at the tolerance boundary", () => {
    // 42.4 - 42.3 = 0.10000000000000142 in IEEE-754, which is > 0.1, so this
    // lands as 'over' — NOT 'match'. Assert the ACTUAL float behavior so nobody
    // "fixes" verdictFor blindly. Same for the mirror case landing as 'missing'.
    expect(verdictFor(42.4, 42.3)).toBe("over");
    expect(verdictFor(41.9, 42.0)).toBe("missing");
    // A diff comfortably inside tolerance still matches.
    expect(verdictFor(42.05, 42.0)).toBe("match");
  });

  it("exposes TOLERANCE as 0.1", () => {
    expect(TOLERANCE).toBe(0.1);
  });
});
