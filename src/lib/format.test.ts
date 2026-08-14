// Guards the two rules that got this file written (escalation
// unpaid-record-row-rounding, 2026-08-13): a nonzero value never prints as a
// bare zero, and a document's rows add up to the total printed under them.
import { describe, expect, it } from "vitest";
import { fmtHours, fmtHours2 } from "./format";

describe("fmtHours", () => {
  it("renders whole and rounded hours to one decimal", () => {
    expect(fmtHours(8)).toBe("8.0");
    expect(fmtHours(8.05)).toBe("8.1");
    expect(fmtHours(8.04)).toBe("8.0");
  });

  it("renders a true zero as 0.0", () => {
    expect(fmtHours(0)).toBe("0.0");
  });

  // The bug. actual_hours is numeric(5,2), so a tapped-and-saved timer lands on
  // 0.01 — real work, on a real line, printing as if nothing had happened.
  it("never prints a bare zero for a nonzero value", () => {
    expect(fmtHours(0.01)).toBe("<0.1");
    expect(fmtHours(0.04)).toBe("<0.1");
    expect(fmtHours(0.049)).toBe("<0.1");
  });

  it("keeps the sign on a negative that rounds away", () => {
    // DiscrepancyCard prints variances, which go negative. "0.0h" for a -0.02
    // variance loses both the magnitude and the direction.
    expect(fmtHours(-0.02)).toBe("-<0.1");
  });

  it("still rounds normally either side of the floor", () => {
    expect(fmtHours(0.05)).toBe("0.1");
    expect(fmtHours(-0.06)).toBe("-0.1");
  });

  it("floors -0.05, because JS rounds a negative half toward zero", () => {
    // Math.round(-0.5) is -0, not -1, so the negative boundary lands one step
    // lower than the positive one. Worth pinning: the old formatter printed a
    // flat "0.0" here and lost the sign along with the magnitude.
    expect(fmtHours(-0.05)).toBe("-<0.1");
  });
});

describe("fmtHours2", () => {
  it("renders at the resolution hours are stored at", () => {
    expect(fmtHours2(2.75)).toBe("2.75");
    expect(fmtHours2(0.01)).toBe("0.01");
    expect(fmtHours2(8)).toBe("8.00");
  });

  it("never prints a negative zero", () => {
    expect(fmtHours2(-0)).toBe("0.00");
  });

  // The property that matters on a claim document: a service manager adding up
  // the column lands on the printed total. At 1dp this failed — eleven rows
  // displaying 2.8h under a total displaying 2.7h.
  it("makes displayed rows sum to the displayed total", () => {
    const rows = [0.25, 0.25, 0.25, 0.25, 0.3, 0.3, 0.3, 0.3, 0.2, 0.05, 0.35];
    const total = rows.reduce((s, h) => s + h, 0);

    const summedFromDisplay = rows
      .map((h) => Number(fmtHours2(h)))
      .reduce((s, h) => s + h, 0);

    expect(fmtHours2(summedFromDisplay)).toBe(fmtHours2(total));
  });

  it("would NOT have reconciled at one decimal — the regression this replaces", () => {
    const rows = [0.24, 0.24, 0.24, 0.24, 0.24];
    const total = rows.reduce((s, h) => s + h, 0); // 1.2
    const summedFrom1dp = rows
      .map((h) => Number(fmtHours(h)))
      .reduce((s, h) => s + h, 0); // 0.2 × 5 = 1.0

    expect(fmtHours(summedFrom1dp)).not.toBe(fmtHours(total));
    // …and the 2dp rendering of the same rows does reconcile.
    const summedFrom2dp = rows
      .map((h) => Number(fmtHours2(h)))
      .reduce((s, h) => s + h, 0);
    expect(fmtHours2(summedFrom2dp)).toBe(fmtHours2(total));
  });
});
