import { describe, it, expect } from "vitest";
import { aggregateStats, computeEfficiency, fmtHours, fmtPct } from "./stats";
import type { DailyClock, Entry } from "./types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEntry(
  date: string,
  flagHours: number,
  actualHours?: number,
): Entry {
  return {
    id: "test-entry",
    userId: "u1",
    createdAt: date + "T00:00:00Z",
    updatedAt: date + "T00:00:00Z",
    date,
    roNumber: "TEST",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    flagHours,
    notes: "",
    opCodes:
      actualHours !== undefined
        ? [
            {
              id: "oc1",
              opCodeId: null,
              custom: true,
              customCode: "TEST",
              customDescription: "Test op",
              flagHours,
              actualHours,
              notes: "",
              position: 0,
              subOpCodeId: null,
              laborType: null,
            },
          ]
        : [],
  };
}

function makeClock(date: string, hours: number): DailyClock {
  return { userId: "u1", date, hours };
}

// ── computeEfficiency ──────────────────────────────────────────────────────────

describe("computeEfficiency", () => {
  it("returns null when clockedHours is 0", () => {
    expect(computeEfficiency(80, 0)).toBeNull();
  });

  it("returns null when clockedHours is negative", () => {
    expect(computeEfficiency(80, -1)).toBeNull();
  });

  it("calculates 110% when 88 flag hours in 80 clocked hours", () => {
    expect(computeEfficiency(88, 80)).toBeCloseTo(110, 1);
  });

  it("calculates 100% when flag equals clocked", () => {
    expect(computeEfficiency(8, 8)).toBe(100);
  });
});

// ── aggregateStats ─────────────────────────────────────────────────────────────

describe("aggregateStats", () => {
  const range = { start: "2026-04-01", end: "2026-04-15" };

  it("returns zeros and null efficiency for empty input", () => {
    const stats = aggregateStats([], [], range);
    expect(stats.flagHours).toBe(0);
    expect(stats.clockedHours).toBe(0);
    expect(stats.efficiency).toBeNull();
    expect(stats.roCount).toBe(0);
    expect(stats.actualHours).toBe(0);
  });

  it("excludes entries before the range start", () => {
    const entries = [makeEntry("2026-03-31", 8), makeEntry("2026-04-01", 5)];
    const stats = aggregateStats(entries, [], range);
    expect(stats.flagHours).toBe(5);
    expect(stats.roCount).toBe(1);
  });

  it("excludes entries after the range end", () => {
    const entries = [makeEntry("2026-04-15", 5), makeEntry("2026-04-16", 3)];
    const stats = aggregateStats(entries, [], range);
    expect(stats.flagHours).toBe(5);
  });

  it("includes entries on the range boundaries (inclusive)", () => {
    const entries = [makeEntry("2026-04-01", 5), makeEntry("2026-04-15", 3)];
    const stats = aggregateStats(entries, [], range);
    expect(stats.flagHours).toBe(8);
    expect(stats.roCount).toBe(2);
  });

  it("excludes clocks outside the range", () => {
    const clocks = [makeClock("2026-03-31", 8), makeClock("2026-04-05", 6)];
    const stats = aggregateStats([], clocks, range);
    expect(stats.clockedHours).toBe(6);
  });

  it("returns null efficiency when clockedHours is 0 (entries exist)", () => {
    const entries = [makeEntry("2026-04-01", 8)];
    const stats = aggregateStats(entries, [], range);
    expect(stats.efficiency).toBeNull();
  });

  it("sums actualHours from op code lines", () => {
    const entries = [makeEntry("2026-04-01", 8, 7.5)];
    const stats = aggregateStats(entries, [], range);
    expect(stats.actualHours).toBe(7.5);
  });

  it("returns 0 actualHours when op codes have no actualHours", () => {
    const entries = [makeEntry("2026-04-01", 8)]; // no actualHours → empty opCodes
    const stats = aggregateStats(entries, [], range);
    expect(stats.actualHours).toBe(0);
  });

  it("calculates efficiency correctly", () => {
    const entries = [makeEntry("2026-04-01", 88)];
    const clocks = [makeClock("2026-04-01", 80)];
    const stats = aggregateStats(entries, clocks, range);
    expect(stats.efficiency).toBeCloseTo(110, 1);
  });

  it("sums flag hours across multiple entries", () => {
    const entries = [
      makeEntry("2026-04-01", 5),
      makeEntry("2026-04-05", 3),
      makeEntry("2026-04-10", 2),
    ];
    const stats = aggregateStats(entries, [], range);
    expect(stats.flagHours).toBe(10);
    expect(stats.roCount).toBe(3);
  });
});

// ── fmtHours ───────────────────────────────────────────────────────────────────

describe("fmtHours", () => {
  it("formats a whole number with one decimal", () => {
    expect(fmtHours(8)).toBe("8.0");
  });

  it("rounds up at .05", () => {
    expect(fmtHours(8.05)).toBe("8.1");
  });

  it("rounds down below .05", () => {
    expect(fmtHours(8.04)).toBe("8.0");
  });

  it("formats zero", () => {
    expect(fmtHours(0)).toBe("0.0");
  });
});

// ── fmtPct ─────────────────────────────────────────────────────────────────────

describe("fmtPct", () => {
  it("returns em-dash for null", () => {
    expect(fmtPct(null)).toBe("—");
  });

  it("rounds to whole percent", () => {
    expect(fmtPct(110.6)).toBe("111%");
    expect(fmtPct(110.4)).toBe("110%");
  });

  it("formats 100%", () => {
    expect(fmtPct(100)).toBe("100%");
  });
});
