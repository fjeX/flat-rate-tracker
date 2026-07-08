import { describe, it, expect } from "vitest";
import {
  effectiveHourly,
  clockFlagGap,
  unflaggedTimeValue,
  floorComparison,
} from "./wage-check";
import type { Bonus, DailyClock, Entry, LaborType } from "./types";
import type { RateMap } from "./earnings";

// ── Helpers ──────────────────────────────────────────────────────────────────

function entry(
  date: string,
  flagHours: number,
  laborType: LaborType | null = "customer_pay",
): Entry {
  return {
    id: `e-${date}-${flagHours}`,
    userId: "u1",
    createdAt: `${date}T00:00:00Z`,
    updatedAt: `${date}T00:00:00Z`,
    date,
    roNumber: "RO",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    flagHours,
    notes: "",
    opCodes: [
      {
        id: `oc-${date}-${flagHours}`,
        opCodeId: null,
        custom: true,
        customCode: "T",
        customDescription: "Test",
        flagHours,
        actualHours: null,
        notes: "",
        position: 0,
        subOpCodeId: null,
        laborType,
      },
    ],
  };
}

function clock(date: string, hours: number): DailyClock {
  return { userId: "u1", date, hours };
}

function bonus(date: string, amount: number): Bonus {
  return {
    id: `b-${date}-${amount}`,
    userId: "u1",
    date,
    amount,
    category: "spiff",
    source: null,
    note: null,
    entryId: null,
    createdAt: "",
    updatedAt: "",
  };
}

const range = { start: "2026-07-01", end: "2026-07-15" };
const cpRates: RateMap = { customer_pay: 30 };

// ── effectiveHourly: complete data ───────────────────────────────────────────

describe("effectiveHourly — complete clock data", () => {
  it("computes (flag pay) ÷ clocked hours when every work day has a clock entry", () => {
    // Two work days, both clocked. Flag pay = (10 + 10) * $30 = $600. Clocked 30h.
    const entries = [entry("2026-07-02", 10), entry("2026-07-03", 10)];
    const clocks = [clock("2026-07-02", 16), clock("2026-07-03", 14)];
    const r = effectiveHourly(entries, clocks, [], cpRates, range);
    expect(r.status).toBe("ok");
    expect(r.flagPay).toBe(600);
    expect(r.clockedHours).toBe(30);
    expect(r.hourly).toBe(20); // $600 / 30h
    expect(r.missingClockDays).toEqual([]);
  });

  it("folds bonuses into the effective hourly numerator", () => {
    // Flag pay $300, spiff $60 → $360 over 20 clocked hours = $18/hr.
    const entries = [entry("2026-07-02", 10)];
    const clocks = [clock("2026-07-02", 20)];
    const r = effectiveHourly(entries, clocks, [bonus("2026-07-02", 60)], cpRates, range);
    expect(r.status).toBe("ok");
    expect(r.bonusTotal).toBe(60);
    expect(r.totalPay).toBe(360);
    expect(r.hourly).toBe(18);
  });
});

// ── effectiveHourly: partial / missing clock data (the main UX) ───────────────

describe("effectiveHourly — partial clock data", () => {
  it("returns null hourly and names the day that lacks a clock entry", () => {
    // Two work days; only the first is clocked. Never average an incomplete denom.
    const entries = [entry("2026-07-02", 8), entry("2026-07-05", 8)];
    const clocks = [clock("2026-07-02", 9)];
    const r = effectiveHourly(entries, clocks, [], cpRates, range);
    expect(r.status).toBe("incomplete_clock");
    expect(r.hourly).toBeNull();
    expect(r.missingClockDays).toEqual(["2026-07-05"]);
  });

  it("lists multiple missing days sorted", () => {
    const entries = [
      entry("2026-07-02", 8),
      entry("2026-07-04", 8),
      entry("2026-07-06", 8),
    ];
    const clocks = [clock("2026-07-04", 9)];
    const r = effectiveHourly(entries, clocks, [], cpRates, range);
    expect(r.missingClockDays).toEqual(["2026-07-02", "2026-07-06"]);
    expect(r.status).toBe("incomplete_clock");
  });

  it("treats a clock row of 0 hours as no clock entry for that day", () => {
    const entries = [entry("2026-07-02", 8)];
    const clocks = [clock("2026-07-02", 0)];
    const r = effectiveHourly(entries, clocks, [], cpRates, range);
    expect(r.status).toBe("no_clock"); // zero total clocked hours
    expect(r.missingClockDays).toEqual(["2026-07-02"]);
    expect(r.hourly).toBeNull();
  });
});

describe("effectiveHourly — no clock data at all", () => {
  it("returns no_clock with a null hourly when nothing is clocked", () => {
    const entries = [entry("2026-07-02", 8)];
    const r = effectiveHourly(entries, [], [], cpRates, range);
    expect(r.status).toBe("no_clock");
    expect(r.clockedHours).toBe(0);
    expect(r.hourly).toBeNull();
  });
});

// ── effectiveHourly: degradation & edges ─────────────────────────────────────

describe("effectiveHourly — rates unset", () => {
  it("computes hours but null dollars when no rate is priced", () => {
    // Clock complete, but no rates → dollars unknown, so no effective hourly.
    const entries = [entry("2026-07-02", 10)];
    const clocks = [clock("2026-07-02", 20)];
    const r = effectiveHourly(entries, clocks, [], {}, range);
    expect(r.status).toBe("no_rates");
    expect(r.flagPay).toBeNull();
    expect(r.totalPay).toBeNull();
    expect(r.hourly).toBeNull();
    expect(r.clockedHours).toBe(20); // hours-only view still works
  });

  it("still totals bonuses even with no rates (bonusTotal is real money)", () => {
    const entries = [entry("2026-07-02", 10)];
    const clocks = [clock("2026-07-02", 20)];
    const r = effectiveHourly(entries, clocks, [bonus("2026-07-02", 40)], {}, range);
    expect(r.bonusTotal).toBe(40);
    expect(r.totalPay).toBeNull(); // no flag pay to add it to → still null
  });
});

describe("effectiveHourly — zero-flag clock days", () => {
  it("counts a clocked day with no flagged work toward the denominator", () => {
    // Day 2: 8 flag / 8 clock. Day 3: 0 flag but 8 clocked (pure unproductive).
    // Both clocked, no work day is missing → effective hourly is defined.
    const entries = [entry("2026-07-02", 8)];
    const clocks = [clock("2026-07-02", 8), clock("2026-07-03", 8)];
    const r = effectiveHourly(entries, clocks, [], cpRates, range);
    expect(r.status).toBe("ok");
    expect(r.clockedHours).toBe(16);
    expect(r.flagHours).toBe(8);
    expect(r.hourly).toBe(15); // $240 flag pay / 16 clocked hours
  });
});

describe("effectiveHourly — period range filtering (overrides)", () => {
  it("ignores entries, clocks, and bonuses outside the range", () => {
    // Simulates a custom period override window: only 07-05..07-06 counts.
    const custom = { start: "2026-07-05", end: "2026-07-06" };
    const entries = [entry("2026-07-01", 8), entry("2026-07-05", 10)];
    const clocks = [clock("2026-07-01", 8), clock("2026-07-05", 20)];
    const bonuses = [bonus("2026-07-01", 100), bonus("2026-07-05", 50)];
    const r = effectiveHourly(entries, clocks, bonuses, cpRates, custom);
    expect(r.flagHours).toBe(10); // only the in-range entry
    expect(r.clockedHours).toBe(20);
    expect(r.bonusTotal).toBe(50);
    expect(r.hourly).toBe(17.5); // ($300 + $50) / 20h
  });
});

// ── clockFlagGap ─────────────────────────────────────────────────────────────

describe("clockFlagGap", () => {
  it("is positive when clocked time outran flagged work", () => {
    expect(clockFlagGap(80, 70)).toBe(10);
  });

  it("is negative when flag hours outran the clock (high efficiency)", () => {
    expect(clockFlagGap(80, 88)).toBe(-8);
  });
});

// ── unflaggedTimeValue ───────────────────────────────────────────────────────

describe("unflaggedTimeValue", () => {
  it("values a positive gap at the customer-pay rate", () => {
    expect(unflaggedTimeValue(10, { customer_pay: 30 })).toBe(300);
  });

  it("returns null when customer pay is unpriced", () => {
    expect(unflaggedTimeValue(10, {})).toBeNull();
  });

  it("returns null for a non-positive gap (no unproductive time)", () => {
    expect(unflaggedTimeValue(0, { customer_pay: 30 })).toBeNull();
    expect(unflaggedTimeValue(-5, { customer_pay: 30 })).toBeNull();
  });
});

// ── floorComparison ──────────────────────────────────────────────────────────

describe("floorComparison", () => {
  it("reports above when effective clears the reference", () => {
    const c = floorComparison(27.4, 17.28);
    expect(c).not.toBeNull();
    expect(c!.atOrAbove).toBe(true);
    expect(c!.delta).toBeCloseTo(10.12, 2);
  });

  it("reports below when effective is under the reference", () => {
    const c = floorComparison(14, 17.28);
    expect(c!.atOrAbove).toBe(false);
    expect(c!.delta).toBeCloseTo(-3.28, 2);
  });

  it("treats exactly equal as at-or-above", () => {
    const c = floorComparison(17.28, 17.28);
    expect(c!.atOrAbove).toBe(true);
    expect(c!.delta).toBe(0);
  });

  it("is null when no effective hourly is available", () => {
    expect(floorComparison(null, 17.28)).toBeNull();
  });

  it("is null when no reference rate is set", () => {
    expect(floorComparison(27.4, null)).toBeNull();
  });

  it("is null for a non-positive reference rate", () => {
    expect(floorComparison(27.4, 0)).toBeNull();
  });
});
