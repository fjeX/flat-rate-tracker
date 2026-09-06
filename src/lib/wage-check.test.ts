import { describe, it, expect } from "vitest";
import {
  effectiveHourly,
  clockFlagGap,
  gapComposition,
  unflaggedTimeValue,
  floorComparison,
  type ScheduleFallback,
} from "./wage-check";
import type { Bonus, DailyClock, Entry, LaborType } from "./types";
import type { RateMap } from "./earnings";
import type { WorkSchedule } from "./schedule";
// Read-only here. pairDay (via aggregateStatsWithSchedule) is the shared
// per-day pairing rule; this suite asserts effectiveHourly AGREES with it
// rather than re-stating the rule and letting the two drift again.
import { aggregateStatsWithSchedule } from "./stats";

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

// ── gapComposition ───────────────────────────────────────────────────────────

describe("gapComposition", () => {
  const parts = (c: number, w: number, s: number) => ({
    comebackHours: c,
    waitingHours: w,
    shopHours: s,
  });

  it("splits the gap into its recorded parts plus an unaccounted remainder", () => {
    const g = gapComposition(10, parts(2, 3, 1));
    expect(g).not.toBeNull();
    expect(g!.trackedHours).toBe(6);
    expect(g!.unaccountedHours).toBe(4);
    expect(g!.overTracked).toBe(false);
  });

  it("does not change the gap it was given", () => {
    // The Pay Check-Up's gap figure is computed by clockFlagGap and must stay
    // exactly that — this function only explains it.
    const gap = clockFlagGap(40, 31.5);
    expect(gapComposition(gap, parts(1, 1, 1))!.gapHours).toBe(gap);
  });

  it("clamps the remainder at zero when tracked time exceeds the gap", () => {
    // Legitimate: comeback hours run alongside flagged work on the same day.
    const g = gapComposition(4, parts(5, 0, 0));
    expect(g!.unaccountedHours).toBe(0);
    expect(g!.overTracked).toBe(true);
  });

  it("treats tracked exactly equal to the gap as fully accounted for", () => {
    const g = gapComposition(6, parts(2, 2, 2));
    expect(g!.unaccountedHours).toBe(0);
    expect(g!.overTracked).toBe(true);
  });

  it("is null when there is no positive gap to explain", () => {
    expect(gapComposition(0, parts(2, 0, 0))).toBeNull();
    expect(gapComposition(-3, parts(2, 0, 0))).toBeNull();
  });

  it("is null when nothing is recorded to explain the gap with", () => {
    expect(gapComposition(8, parts(0, 0, 0))).toBeNull();
  });
});

// ── Schedule fallback ────────────────────────────────────────────────────────
//
// Regression cover for a real bug: aggregateStatsWithSchedule has always filled
// unclocked work days from the schedule, so a period could show a
// schedule-derived efficiency while effectiveHourly reported "no effective
// hourly yet — 10 days have no clock entry". Two functions disagreeing about
// the same hours. A scheduled day is a known-good default, not missing data.

// Mon–Fri 08:00–16:30 with a 30-minute unpaid break = 8.0 paid hours.
const DAY_SHIFT = { start: "08:00", end: "16:30", breakMin: 30 };

function schedule5x8(effectiveFrom = "2026-01-01"): WorkSchedule {
  return {
    id: "s1",
    effectiveFrom,
    rotationWeeks: 1,
    // 2026-01-05 is a Monday.
    anchorMonday: "2026-01-05",
    weeks: [
      {
        mon: DAY_SHIFT,
        tue: DAY_SHIFT,
        wed: DAY_SHIFT,
        thu: DAY_SHIFT,
        fri: DAY_SHIFT,
        sat: null,
        sun: null,
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
  };
}

// 2026-07-20 and 2026-07-21 are a Monday and Tuesday.
const RANGE = { start: "2026-07-16", end: "2026-07-31" };
const RATES: RateMap = { customer_pay: 30 };

function fallback(over: Partial<ScheduleFallback> = {}): ScheduleFallback {
  return {
    schedules: [schedule5x8()],
    daysOff: [],
    confirmedZeroDays: [],
    today: "2026-07-25",
    ...over,
  };
}

describe("effectiveHourly — schedule fallback", () => {
  it("is unchanged when no schedule context is passed", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
    );
    expect(r.status).toBe("no_clock");
    expect(r.hourly).toBeNull();
    expect(r.denomHours).toBe(0);
    expect(r.denomSource).toBeNull();
    expect(r.missingClockDays).toEqual(["2026-07-20"]);
  });

  it("fills an unclocked work day from the schedule and yields a rate", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback(),
    );
    expect(r.status).toBe("ok");
    expect(r.denomHours).toBe(8);
    expect(r.denomSource).toBe("scheduled");
    expect(r.scheduledDays).toEqual(["2026-07-20"]);
    expect(r.missingClockDays).toEqual([]);
    // 9 flag hours x $30 = $270 over an 8h scheduled shift.
    expect(r.hourly).toBeCloseTo(270 / 8, 6);
  });

  it("keeps clockedHours reporting real clock entries only", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback(),
    );
    expect(r.clockedHours).toBe(0);
    expect(r.denomHours).toBe(8);
  });

  it("prefers a real clock entry over the schedule", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [clock("2026-07-20", 10)],
      [],
      RATES,
      RANGE,
      fallback(),
    );
    expect(r.denomHours).toBe(10);
    expect(r.denomSource).toBe("clocked");
    expect(r.scheduledDays).toEqual([]);
  });

  it("reports mixed provenance when some days clock and others fall back", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9), entry("2026-07-21", 7)],
      [clock("2026-07-20", 10)],
      [],
      RATES,
      RANGE,
      fallback(),
    );
    expect(r.denomHours).toBe(18); // 10 clocked + 8 scheduled
    expect(r.denomSource).toBe("mixed");
    expect(r.scheduledDays).toEqual(["2026-07-21"]);
    expect(r.status).toBe("ok");
  });

  it("never fills today from the schedule — the shift is still in progress", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback({ today: "2026-07-20" }),
    );
    expect(r.scheduledDays).toEqual([]);
    // Today is in-progress, NOT missing data — see the in-progress suite below.
    expect(r.missingClockDays).toEqual([]);
    expect(r.ongoingDays).toEqual(["2026-07-20"]);
    expect(r.status).toBe("no_clock");
  });

  it("never fills a future day", () => {
    const r = effectiveHourly(
      [entry("2026-07-21", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback({ today: "2026-07-20" }),
    );
    expect(r.scheduledDays).toEqual([]);
    expect(r.status).toBe("no_clock");
  });

  it("never fills an explicit day off, even with flagged work on it", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback({
        daysOff: [{ startDate: "2026-07-20", endDate: "2026-07-20" }],
      }),
    );
    expect(r.scheduledDays).toEqual([]);
    expect(r.missingClockDays).toEqual(["2026-07-20"]);
  });

  it("leaves a pattern-off day (Saturday) as genuinely missing", () => {
    // 2026-07-25 is a Saturday, which this schedule has as null.
    const r = effectiveHourly(
      [entry("2026-07-18", 4)], // Saturday
      [],
      [],
      RATES,
      RANGE,
      fallback(),
    );
    expect(r.scheduledDays).toEqual([]);
    expect(r.missingClockDays).toEqual(["2026-07-18"]);
    expect(r.status).toBe("no_clock");
  });

  it("a one-day shift override wins over the pattern", () => {
    const r = effectiveHourly(
      [entry("2026-07-18", 4)], // Saturday — normally off
      [],
      [],
      RATES,
      RANGE,
      fallback({
        shiftOverrides: {
          "2026-07-18": { start: "08:00", end: "12:00", breakMin: 0 },
        },
      }),
    );
    expect(r.denomHours).toBe(4);
    expect(r.scheduledDays).toEqual(["2026-07-18"]);
    expect(r.status).toBe("ok");
  });

  it("still blocks the rate when ONE day has neither clock nor schedule", () => {
    // Mon fills from the schedule; Sat does not — the denominator is genuinely
    // incomplete, so no rate is shown.
    const r = effectiveHourly(
      [entry("2026-07-20", 9), entry("2026-07-18", 4)],
      [],
      [],
      RATES,
      RANGE,
      fallback(),
    );
    expect(r.scheduledDays).toEqual(["2026-07-20"]);
    expect(r.missingClockDays).toEqual(["2026-07-18"]);
    expect(r.status).toBe("incomplete_clock");
    expect(r.hourly).toBeNull();
  });

  it("reports no_rates once hours resolve but nothing is priced", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      {},
      RANGE,
      fallback(),
    );
    expect(r.denomHours).toBe(8);
    expect(r.status).toBe("no_rates");
  });
});

// ── In-progress day ──────────────────────────────────────────────────────────
//
// A day at or after "today" with no clock entry is a shift still running, not
// missing data. Reported as a bug: a period showed "1 day this period has
// flagged work but no hours on it" for TODAY, blocking the rate all day.

describe("effectiveHourly — in-progress day", () => {
  it("does not report today as missing", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 8), entry("2026-07-22", 5)],
      [clock("2026-07-20", 8)],
      [],
      RATES,
      RANGE,
      fallback({ today: "2026-07-22" }),
    );
    expect(r.missingClockDays).toEqual([]);
    expect(r.ongoingDays).toEqual(["2026-07-22"]);
    expect(r.status).toBe("ok");
  });

  it("excludes today from BOTH sides, so the rate can't inflate", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 8), entry("2026-07-22", 5)],
      [clock("2026-07-20", 8)],
      [],
      RATES,
      RANGE,
      fallback({ today: "2026-07-22" }),
    );
    expect(r.denomHours).toBe(8);
    expect(r.countedFlagHours).toBe(8); // today's 5h excluded
    expect(r.flagHours).toBe(13); // full period still reported for display
    // 8 flagged hours x $30 over 8 counted hours — NOT (8+5)x30/8.
    expect(r.hourly).toBeCloseTo(30, 6);
  });

  it("counts today normally once it has a clock entry", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 8), entry("2026-07-22", 5)],
      [clock("2026-07-20", 8), clock("2026-07-22", 4)],
      [],
      RATES,
      RANGE,
      fallback({ today: "2026-07-22" }),
    );
    expect(r.ongoingDays).toEqual([]);
    expect(r.denomHours).toBe(12);
    expect(r.countedFlagHours).toBe(13);
  });

  it("excludes a future day's flagged work too", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 8), entry("2026-07-24", 6)],
      [clock("2026-07-20", 8)],
      [],
      RATES,
      RANGE,
      fallback({ today: "2026-07-22" }),
    );
    expect(r.ongoingDays).toEqual(["2026-07-24"]);
    expect(r.countedFlagHours).toBe(8);
  });

  it("excludes today's spiffs from the rate as well", () => {
    // Otherwise a bonus logged today lands on a denominator that has no hours
    // for today — the same inflation, by another route.
    const r = effectiveHourly(
      [entry("2026-07-20", 8)],
      [clock("2026-07-20", 8)],
      [bonus("2026-07-22", 100)],
      RATES,
      RANGE,
      fallback({ today: "2026-07-22" }),
    );
    expect(r.hourly).toBeCloseTo(30, 6);
    expect(r.bonusTotal).toBe(100); // still reported in full
  });

  it("reports no_clock when the ONLY work day is today", () => {
    const r = effectiveHourly(
      [entry("2026-07-22", 5)],
      [],
      [],
      RATES,
      RANGE,
      fallback({ today: "2026-07-22" }),
    );
    expect(r.ongoingDays).toEqual(["2026-07-22"]);
    expect(r.missingClockDays).toEqual([]);
    expect(r.denomHours).toBe(0);
    expect(r.status).toBe("no_clock");
  });

  it("handles today with no schedule at all — the array can be empty", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 8), entry("2026-07-22", 5)],
      [clock("2026-07-20", 8)],
      [],
      RATES,
      RANGE,
      { schedules: [], daysOff: [], confirmedZeroDays: [], today: "2026-07-22" },
    );
    expect(r.ongoingDays).toEqual(["2026-07-22"]);
    expect(r.scheduledDays).toEqual([]);
    expect(r.status).toBe("ok");
  });
});

// ── Confirmed real-zero days ─────────────────────────────────────────────────
//
// Escalation `payperiod-scheduled-hours-two-figures`, filed six nights running
// as "confusing, not wrong". It was wrong.
//
// A confirmed zero is a day the tech was at the shop for a full scheduled shift
// and flagged nothing — the single largest block of unproductive time this
// module exists to surface (see the file header). It has no RO on it BY
// DEFINITION, so the schedule fill, which iterated dates carrying an RO, never
// saw it: the hours were absent from denomHours while the efficiency tile beside
// it counted them via pairDay's `flag > 0 || confirmedZero.has(date)`. Two
// figures for one quantity, and the one effective hourly reported was the
// flattering one — dividing the same pay by fewer hours makes the rate look
// BETTER than the day the tech actually had.

describe("effectiveHourly — confirmed real-zero days", () => {
  it("counts a confirmed zero day's full scheduled shift in the denominator", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback({ confirmedZeroDays: ["2026-07-21"] }),
    );
    // Mon filled from the schedule (8h) + Tue, a confirmed zero, also 8h.
    expect(r.denomHours).toBe(16);
    expect(r.scheduledDays).toEqual(["2026-07-20", "2026-07-21"]);
    // Zero in the numerator, full shift in the denominator: $270 over 16h, not
    // over 8h. The unproductive day drags the rate DOWN, which is the point.
    expect(r.hourly).toBeCloseTo(270 / 16, 6);
    expect(r.countedFlagHours).toBe(9);
  });

  it("counts a day that is BOTH confirmed-zero and has entries exactly once", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback({ confirmedZeroDays: ["2026-07-20"] }),
    );
    expect(r.denomHours).toBe(8);
    expect(r.scheduledDays).toEqual(["2026-07-20"]);
  });

  it("prefers a real clock entry on a confirmed zero day, and never adds both", () => {
    // pairDay's first branch: clocked hours win outright.
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [clock("2026-07-20", 8), clock("2026-07-21", 6)],
      [],
      RATES,
      RANGE,
      fallback({ confirmedZeroDays: ["2026-07-21"] }),
    );
    expect(r.denomHours).toBe(14); // 8 clocked + 6 clocked, no 8h shift added
    expect(r.scheduledDays).toEqual([]);
    expect(r.denomSource).toBe("clocked");
  });

  it("never counts a confirmed zero day that is also a day off", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback({
        confirmedZeroDays: ["2026-07-21"],
        daysOff: [{ startDate: "2026-07-21", endDate: "2026-07-21" }],
      }),
    );
    expect(r.denomHours).toBe(8);
    expect(r.scheduledDays).toEqual(["2026-07-20"]);
  });

  it("never counts a confirmed zero day at or after today", () => {
    // today is 2026-07-25; the shift is still running or hasn't happened.
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback({ confirmedZeroDays: ["2026-07-27"] }),
    );
    expect(r.denomHours).toBe(8);
    expect(r.scheduledDays).toEqual(["2026-07-20"]);
  });

  it("never counts a confirmed zero day with no scheduled shift (Saturday)", () => {
    // 2026-07-18 is a Saturday, which this schedule leaves null.
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback({ confirmedZeroDays: ["2026-07-18"] }),
    );
    expect(r.denomHours).toBe(8);
    expect(r.scheduledDays).toEqual(["2026-07-20"]);
  });

  it("ignores a confirmed zero day outside the period", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE, // 2026-07-16 .. 2026-07-31
      fallback({ confirmedZeroDays: ["2026-07-13"] }),
    );
    expect(r.denomHours).toBe(8);
  });

  it("does not turn a confirmed zero day into a missing or ongoing day", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 9)],
      [],
      [],
      RATES,
      RANGE,
      fallback({ confirmedZeroDays: ["2026-07-21"] }),
    );
    expect(r.missingClockDays).toEqual([]);
    expect(r.ongoingDays).toEqual([]);
    expect(r.status).toBe("ok");
  });

  // The point of the whole fix, stated as the thing that has to stay true: one
  // real-world quantity, one number, whichever function you ask.
  it("agrees with aggregateStatsWithSchedule's denomHours, confirmed zeros included", () => {
    const entries = [entry("2026-07-20", 9), entry("2026-07-22", 6)];
    const clocks = [clock("2026-07-22", 8)];
    const ctx = {
      schedules: [schedule5x8()],
      daysOff: [],
      confirmedZeroDays: ["2026-07-21", "2026-07-23"],
      today: "2026-07-25",
    };
    const r = effectiveHourly(entries, clocks, [], RATES, RANGE, ctx);
    const s = aggregateStatsWithSchedule(entries, clocks, RANGE, ctx);
    // 8 clocked (Wed) + 8 scheduled (Mon, flagged) + 8 + 8 (two real zeros).
    expect(s.denomHours).toBe(32);
    expect(r.denomHours).toBe(s.denomHours);
    expect(r.denomSource).toBe(s.denomSource);
  });
});

// ── countedPay ───────────────────────────────────────────────────────────────
//
// Escalation `costcard-total-pay-mismatch`. The card printed
// "Total pay {totalPay} ÷ {denomHours}" under the headline rate as the
// arithmetic that produced it. totalPay is the FULL period and includes an
// in-progress day; denomHours has no hours for that day. The quotient on screen
// was not the rate above it, and the numerator the rate actually used was not
// exported at all.

describe("effectiveHourly — countedPay", () => {
  it("excludes an in-progress day's flag pay and spiffs, and reproduces hourly", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 8), entry("2026-07-22", 5)],
      [clock("2026-07-20", 8)],
      [bonus("2026-07-20", 40), bonus("2026-07-22", 100)],
      RATES,
      RANGE,
      fallback({ today: "2026-07-22" }),
    );
    expect(r.ongoingDays).toEqual(["2026-07-22"]);
    // Full period, for display continuity: (8+5)x30 + 140.
    expect(r.totalPay).toBeCloseTo(530, 6);
    // What the rate is actually made of: 8x30 + 40.
    expect(r.countedPay).toBeCloseTo(280, 6);
    expect(r.hourly).toBeCloseTo(280 / 8, 6);
    // The printed division must BE the headline.
    expect(r.countedPay! / r.denomHours).toBeCloseTo(r.hourly!, 10);
  });

  it("equals totalPay when nothing is in progress", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 8)],
      [clock("2026-07-20", 8)],
      [bonus("2026-07-20", 40)],
      RATES,
      RANGE,
      fallback(),
    );
    expect(r.countedPay).toBe(r.totalPay);
  });

  it("is null exactly when totalPay is null (no rates priced)", () => {
    const r = effectiveHourly(
      [entry("2026-07-20", 8)],
      [clock("2026-07-20", 8)],
      [],
      {},
      RANGE,
      fallback(),
    );
    expect(r.totalPay).toBeNull();
    expect(r.countedPay).toBeNull();
  });
});

// ── Denominator parity with pairDay, as a property over many shapes ──────────
//
// The previous parity test was a single worked example, and it passed while a
// four-fold disagreement sat next to it: effectiveHourly built its schedule
// fill from `workDays` (every date carrying an RO) while pairDay requires
// `flag > 0 || confirmedZero.has(date)`. A day whose ROs all flag ZERO — an
// unpaid comeback logged on a day the tech forgot to clock — was therefore a
// whole scheduled shift in denomHours here and an `unresolved` day there. Both
// numbers render on one screen: WorkCostCard prints result.denomHours as "At
// the shop", PeriodStats prints stats.denomHours as "Clocked hrs".
//
// So this is a table, not an example: every shape that has ever mattered to the
// pairing rule, asserted on BOTH denomHours and denomSource. A single example
// can only prove itself; a table is what makes the next divergence fail here
// instead of on the tech's screen.

describe("effectiveHourly <-> aggregateStatsWithSchedule — denominator parity", () => {
  const P = { start: "2026-09-01", end: "2026-09-14" }; // Tue → Mon, 5x8 Mon–Fri
  const TODAY = "2026-09-10";

  function ctxOf(over: Partial<ScheduleFallback> = {}): ScheduleFallback {
    return {
      schedules: [schedule5x8()],
      daysOff: [],
      confirmedZeroDays: [],
      today: TODAY,
      ...over,
    };
  }

  type Case = {
    name: string;
    entries: Entry[];
    clocks: DailyClock[];
    ctx: ScheduleFallback;
    /** Only asserted when given — parity itself is asserted for every case. */
    expectDenom?: number;
  };

  // The escalated pair, spelled out. Before the fix these read 16-vs-8 and
  // 32-vs-8 respectively.
  const S9: Case = {
    name: "S9 — one flagged+clocked day, one ZERO-flag unclocked day",
    entries: [entry("2026-09-01", 8), entry("2026-09-02", 0)],
    clocks: [clock("2026-09-01", 8)],
    ctx: ctxOf(),
    expectDenom: 8, // NOT 16: 09-02 flagged nothing, so it is unresolved
  };
  const S18: Case = {
    name: "S18 — one flagged+clocked day, THREE ZERO-flag unclocked days",
    entries: [
      entry("2026-09-01", 8),
      entry("2026-09-02", 0),
      entry("2026-09-03", 0),
      entry("2026-09-04", 0),
    ],
    clocks: [clock("2026-09-01", 8)],
    ctx: ctxOf(),
    expectDenom: 8, // NOT 32
  };

  const cases: Case[] = [
    S9,
    S18,
    {
      name: "every day clocked and flagged",
      entries: [entry("2026-09-01", 9), entry("2026-09-02", 7)],
      clocks: [clock("2026-09-01", 8), clock("2026-09-02", 8.5)],
      ctx: ctxOf(),
      expectDenom: 16.5,
    },
    {
      name: "flagged, unclocked, completed → filled from the schedule",
      entries: [entry("2026-09-02", 6)],
      clocks: [],
      ctx: ctxOf(),
      expectDenom: 8,
    },
    {
      name: "ZERO-flag and POSITIVE-flag RO on the SAME unclocked day — summed per day, so it counts",
      entries: [entry("2026-09-02", 0), entry("2026-09-02", 5)],
      clocks: [],
      ctx: ctxOf(),
      expectDenom: 8,
    },
    {
      name: "ZERO-flag RO on a day that IS a confirmed real zero",
      entries: [entry("2026-09-02", 0)],
      clocks: [],
      ctx: ctxOf({ confirmedZeroDays: ["2026-09-02"] }),
      expectDenom: 8,
    },
    {
      name: "confirmed real zero with no RO at all (the fill that must not regress)",
      entries: [entry("2026-09-01", 9)],
      clocks: [],
      ctx: ctxOf({ confirmedZeroDays: ["2026-09-02"] }),
      expectDenom: 16,
    },
    {
      name: "ZERO-flag RO on a day the tech was OFF",
      entries: [entry("2026-09-01", 8), entry("2026-09-02", 0)],
      clocks: [],
      ctx: ctxOf({
        daysOff: [{ startDate: "2026-09-02", endDate: "2026-09-02" }],
      }),
      expectDenom: 8,
    },
    {
      name: "POSITIVE-flag RO on a day the tech was OFF (unpaired on both sides)",
      entries: [entry("2026-09-01", 8), entry("2026-09-02", 6)],
      clocks: [],
      ctx: ctxOf({
        daysOff: [{ startDate: "2026-09-02", endDate: "2026-09-02" }],
      }),
      expectDenom: 8,
    },
    {
      name: "ZERO-flag RO today and tomorrow (>= today, still in progress)",
      entries: [
        entry("2026-09-01", 8),
        entry("2026-09-10", 0),
        entry("2026-09-11", 0),
      ],
      clocks: [clock("2026-09-01", 8)],
      ctx: ctxOf(),
      expectDenom: 8,
    },
    {
      name: "POSITIVE-flag RO today (>= today, still in progress)",
      entries: [entry("2026-09-01", 8), entry("2026-09-10", 6)],
      clocks: [clock("2026-09-01", 8)],
      ctx: ctxOf(),
      expectDenom: 8,
    },
    {
      name: "ZERO-flag RO on an unscheduled day (Saturday)",
      entries: [entry("2026-09-01", 8), entry("2026-09-05", 0)],
      clocks: [],
      ctx: ctxOf(),
      expectDenom: 8,
    },
    {
      name: "ZERO-flag RO on a day that IS clocked (clock wins)",
      entries: [entry("2026-09-02", 0)],
      clocks: [clock("2026-09-02", 7.5)],
      ctx: ctxOf(),
      expectDenom: 7.5,
    },
    {
      name: "entries and clocks OUTSIDE the range are ignored by both",
      entries: [
        entry("2026-08-31", 8),
        entry("2026-09-02", 0),
        entry("2026-09-15", 8),
      ],
      clocks: [
        clock("2026-08-31", 8),
        clock("2026-09-02", 6),
        clock("2026-09-20", 8),
      ],
      ctx: ctxOf(),
      expectDenom: 6,
    },
    {
      name: "no schedule rows at all — nothing to fill from",
      entries: [entry("2026-09-01", 8), entry("2026-09-02", 0)],
      clocks: [clock("2026-09-01", 8)],
      ctx: ctxOf({ schedules: [] }),
      expectDenom: 8,
    },
    {
      name: "nothing at all",
      entries: [],
      clocks: [],
      ctx: ctxOf(),
      expectDenom: 0,
    },
    {
      name: "the lot together — clocked, flagged-unclocked, zero-flag, confirmed zero, day off, in progress, weekend",
      entries: [
        entry("2026-09-01", 9), // Tue, clocked
        entry("2026-09-02", 0), // Wed, zero flag, unclocked → unresolved
        entry("2026-09-03", 6), // Thu, flagged, unclocked → scheduled 8h
        entry("2026-09-04", 0), // Fri, zero flag but confirmed zero → 8h
        entry("2026-09-05", 4), // Sat, unscheduled → unpaired
        entry("2026-09-08", 5), // Tue, day off → unpaired
        entry("2026-09-10", 7), // today → in progress
      ],
      clocks: [clock("2026-09-01", 8.25)],
      ctx: ctxOf({
        confirmedZeroDays: ["2026-09-04", "2026-09-07"],
        daysOff: [{ startDate: "2026-09-08", endDate: "2026-09-08" }],
      }),
      // 8.25 clocked + 8 (Thu flagged) + 8 (Fri confirmed zero) + 8 (Mon 09-07
      // confirmed zero, no RO on it at all).
      expectDenom: 32.25,
    },
  ];

  for (const c of cases) {
    it(`agrees on denomHours and denomSource — ${c.name}`, () => {
      const r = effectiveHourly(c.entries, c.clocks, [], RATES, P, c.ctx);
      const s = aggregateStatsWithSchedule(c.entries, c.clocks, P, c.ctx);
      if (c.expectDenom !== undefined) {
        expect(r.denomHours).toBeCloseTo(c.expectDenom, 6);
      }
      expect(r.denomHours).toBeCloseTo(s.denomHours, 6);
      expect(r.denomSource).toBe(s.denomSource);
    });
  }

  // The two figures the escalation was actually about, printed side by side on
  // one screen. Stated separately so a failure names the symptom rather than a
  // row index in the table above.
  it("S18: 'At the shop' and 'Clocked hrs' are the same number, not 32 vs 8", () => {
    const r = effectiveHourly(S18.entries, S18.clocks, [], RATES, P, S18.ctx);
    const s = aggregateStatsWithSchedule(S18.entries, S18.clocks, P, S18.ctx);
    expect(r.denomHours).toBe(8);
    expect(s.denomHours).toBe(8);
    // $240 of flag pay over 8 hours — $30.00/hr, not the $7.50/hr a 32-hour
    // denominator manufactured. That direction invents a below-your-reference
    // -rate alarm out of work nobody was paid for.
    expect(r.hourly).toBeCloseTo(30, 6);
    // Every empty scheduled weekday in the range is unresolved; the three the
    // zero-flag ROs sit on are the ones this case is about.
    expect(s.unresolvedDays).toEqual(
      expect.arrayContaining(["2026-09-02", "2026-09-03", "2026-09-04"]),
    );
  });

  it("S9: a lone zero-flag day does not double the denominator", () => {
    const r = effectiveHourly(S9.entries, S9.clocks, [], RATES, P, S9.ctx);
    const s = aggregateStatsWithSchedule(S9.entries, S9.clocks, P, S9.ctx);
    expect(r.denomHours).toBe(8);
    expect(r.hourly).toBeCloseTo(30, 6);
    expect(r.denomSource).toBe("clocked"); // was "mixed" — provenance disagreed too
    expect(s.denomSource).toBe("clocked");
    expect(s.unresolvedDays).toContain("2026-09-02");
  });

  // A zero-flag day with no clock and no schedule is not "missing" data — there
  // is no numerator on it to protect. Blanking the rate for it would hide a
  // perfectly good figure behind a day nobody was paid for.
  it("does not report a zero-flag unscheduled day as a missing clock day", () => {
    const r = effectiveHourly(
      [entry("2026-09-01", 8), entry("2026-09-05", 0)],
      [clock("2026-09-01", 8)],
      [],
      RATES,
      P,
      ctxOf(),
    );
    expect(r.missingClockDays).toEqual([]);
    expect(r.status).toBe("ok");
    // Still a work day for display purposes — it has an RO on it.
    expect(r.workDays).toContain("2026-09-05");
  });
});
