import { describe, it, expect } from "vitest";
import type { Entry } from "./types";
import { getPeriodForDate, getRangeForPeriodKey } from "./periods";
import {
  inferWorkedWeekdays,
  workingDaysRemaining,
  recentDailyAverage,
  projectPeriod,
  weekdayPattern,
  computeForecast,
  DEFAULT_WORKED_WEEKDAYS,
} from "./forecast";

// ------------------------------------------------------------------------
// Fixtures
//
// Anchor weekdays (verified against periods.test.ts, where 2026-06-08 is a
// Monday): the June 2026 calendar runs Mon 06-08 .. Sun 06-14, so any date
// here maps to a known weekday without a Date lookup in the test itself.
// ------------------------------------------------------------------------

let seq = 0;
function mk(date: string, flagHours: number): Entry {
  return {
    id: `${date}-${seq++}`,
    userId: "u",
    createdAt: `${date}T12:00:00Z`,
    updatedAt: `${date}T12:00:00Z`,
    date,
    roNumber: "RO",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: [],
    flagHours,
    notes: "",
  };
}

// Ten Mon–Fri worked days ending before 2026-06-22, each 8 flag hrs → avg 8.
const TEN_WEEKDAYS = [
  "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12",
  "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19",
];
const richHistory = TEN_WEEKDAYS.map((d) => mk(d, 8));

// ------------------------------------------------------------------------
// workingDaysRemaining
// ------------------------------------------------------------------------

describe("workingDaysRemaining", () => {
  const monFri = new Set([1, 2, 3, 4, 5]);

  it("counts Mon–Fri days after today through period end, excluding today", () => {
    // today Mon 06-08, end Mon 06-15 → Tue..Fri (9,10,11,12) + Mon 15 = 5
    expect(workingDaysRemaining("2026-06-15", "2026-06-08", monFri)).toBe(5);
  });

  it("excludes weekends the tech does not work", () => {
    // today Mon 06-08 → Sat 06-13 and Sun 06-14 are skipped for a Mon–Fri tech
    expect(workingDaysRemaining("2026-06-14", "2026-06-08", monFri)).toBe(4);
  });

  it("counts Saturdays for a tech who works Sat", () => {
    const monSat = new Set([1, 2, 3, 4, 5, 6]);
    // same window as the Mon–Fri case but Sat 06-13 now counts → 6
    expect(workingDaysRemaining("2026-06-15", "2026-06-08", monSat)).toBe(6);
  });

  it("returns 0 once the period has ended (today === periodEnd)", () => {
    expect(workingDaysRemaining("2026-06-15", "2026-06-15", monFri)).toBe(0);
  });

  it("returns 0 when today is past the period end", () => {
    expect(workingDaysRemaining("2026-06-15", "2026-06-20", monFri)).toBe(0);
  });

  it("respects a split_day P1 boundary derived from getPeriodForDate", () => {
    const period = getPeriodForDate("2026-06-10", 15); // P1 ends 06-15
    expect(period.end).toBe("2026-06-15");
    // today Wed 06-10 → Thu 11, Fri 12, Mon 15 = 3 Mon–Fri days
    expect(workingDaysRemaining(period.end, "2026-06-10", monFri)).toBe(3);
  });

  it("respects a period_overrides boundary", () => {
    const overrides = { "custom-jun": { start: "2026-06-01", end: "2026-06-20" } };
    const period = getPeriodForDate("2026-06-10", 15, overrides);
    expect(period.end).toBe("2026-06-20");
    // today Wed 06-10 → weekdays 11,12,15,16,17,18,19 = 7
    expect(workingDaysRemaining(period.end, "2026-06-10", monFri)).toBe(7);
  });
});

// ------------------------------------------------------------------------
// recentDailyAverage
// ------------------------------------------------------------------------

describe("recentDailyAverage", () => {
  it("averages flagged hours over worked days only", () => {
    expect(recentDailyAverage(richHistory, { today: "2026-06-22" })).toBe(8);
  });

  it("returns null for a brand-new user with no entries", () => {
    expect(recentDailyAverage([], { today: "2026-06-22" })).toBeNull();
  });

  it("returns null with sparse history (fewer than 5 worked days)", () => {
    const sparse = richHistory.slice(0, 4);
    expect(recentDailyAverage(sparse, { today: "2026-06-22" })).toBeNull();
  });

  it("excludes zero-entry (sick) days — divides by worked days, not calendar days", () => {
    // 5 worked days of 10 hrs spread across a 30-day window; the untouched
    // days never appear, so the average is 10, not 10×5/30.
    const entries = [
      mk("2026-06-01", 10), mk("2026-06-03", 10), mk("2026-06-08", 10),
      mk("2026-06-10", 10), mk("2026-06-15", 10),
    ];
    expect(recentDailyAverage(entries, { today: "2026-06-22" })).toBe(10);
  });

  it("ignores entries outside the lookback window", () => {
    const withOld = [mk("2026-01-01", 999), ...richHistory];
    // 2026-01-01 is far outside the 30-day window ending 06-22 → still 8
    expect(recentDailyAverage(withOld, { today: "2026-06-22" })).toBe(8);
  });

  it("divides by every calendar day when workedDaysOnly is false", () => {
    // 10 worked days × 8 hrs = 80, over a 30-day window → 80/30
    const avg = recentDailyAverage(richHistory, {
      today: "2026-06-22",
      workedDaysOnly: false,
    });
    expect(avg).toBeCloseTo(80 / 30, 6);
  });
});

// ------------------------------------------------------------------------
// inferWorkedWeekdays
// ------------------------------------------------------------------------

describe("inferWorkedWeekdays", () => {
  it("infers a Saturday worker's schedule from history", () => {
    const sats = [mk("2026-05-30", 6), mk("2026-06-06", 6), mk("2026-06-13", 6)];
    const worked = inferWorkedWeekdays(sats, { today: "2026-06-30" });
    expect(worked.has(6)).toBe(true); // Saturday
    expect(worked.has(0)).toBe(false); // never a Sunday
  });

  it("falls back to Mon–Fri for a brand-new user", () => {
    const worked = inferWorkedWeekdays([], { today: "2026-06-22" });
    expect([...worked].sort()).toEqual([...DEFAULT_WORKED_WEEKDAYS].sort());
  });

  it("returns an empty set when fallback is disabled and there's no history", () => {
    const worked = inferWorkedWeekdays([], {
      today: "2026-06-22",
      fallbackToDefault: false,
    });
    expect(worked.size).toBe(0);
  });
});

// ------------------------------------------------------------------------
// projectPeriod
// ------------------------------------------------------------------------

describe("projectPeriod", () => {
  it("projects current + avg × daysRemaining and reports the gap", () => {
    const p = projectPeriod(40, 8, 6, 88);
    expect(p.projected).toBe(88);
    expect(p.gap).toBe(0);
    expect(p.requiredPerDay).toBe(8); // (88-40)/6
  });

  it("reports a negative gap when the projection falls short", () => {
    const p = projectPeriod(40, 5, 6, 88);
    expect(p.projected).toBe(70);
    expect(p.gap).toBe(-18);
  });

  it("returns requiredPerDay = null when no working days remain", () => {
    const p = projectPeriod(50, 8, 0, 88);
    expect(p.projected).toBe(50);
    expect(p.requiredPerDay).toBeNull();
  });

  it("returns requiredPerDay = 0 once the goal is already met", () => {
    const p = projectPeriod(90, 8, 5, 88);
    expect(p.requiredPerDay).toBe(0);
  });

  it("reflects a mid-period goal change in requiredPerDay", () => {
    const low = projectPeriod(40, 8, 6, 88);
    const raised = projectPeriod(40, 8, 6, 100);
    expect(low.requiredPerDay).toBe(8); // (88-40)/6
    expect(raised.requiredPerDay).toBe(10); // (100-40)/6
  });
});

// ------------------------------------------------------------------------
// weekdayPattern
// ------------------------------------------------------------------------

describe("weekdayPattern", () => {
  it("averages flagged hours per weekday over worked instances", () => {
    const entries = [
      mk("2026-06-08", 10), // Mon
      mk("2026-06-15", 6), // Mon
      mk("2026-06-09", 4), // Tue
    ];
    const pattern = weekdayPattern(entries, { today: "2026-06-30" });
    expect(pattern).toHaveLength(7);

    const mon = pattern[1];
    expect(mon.label).toBe("Mon");
    expect(mon.meanFlagHours).toBe(8); // (10+6)/2
    expect(mon.workedDays).toBe(2);

    const tue = pattern[2];
    expect(tue.meanFlagHours).toBe(4);

    const sun = pattern[0];
    expect(sun.meanFlagHours).toBe(0);
    expect(sun.workedDays).toBe(0);
  });
});

// ------------------------------------------------------------------------
// computeForecast — the four dashboard states
// ------------------------------------------------------------------------

describe("computeForecast", () => {
  // Shared setup: rich history (avg 8), today Mon 06-22, period P2 ends 06-30.
  // Mon–Fri days remaining after 06-22 through 06-30: 23,24,25,26,29,30 = 6.
  const base = {
    today: "2026-06-22",
    periodEnd: "2026-06-30",
  };

  it("reports 'ahead' when the projection meets or beats goal", () => {
    const f = computeForecast(richHistory, { ...base, current: 45, goal: 88 });
    expect(f.avgPerDay).toBe(8);
    expect(f.daysRemaining).toBe(6);
    expect(f.projected).toBe(93); // 45 + 8×6
    expect(f.state).toBe("ahead");
  });

  it("reports 'close' when the projection lands within 10% of goal", () => {
    const f = computeForecast(richHistory, { ...base, current: 32, goal: 88 });
    expect(f.projected).toBe(80); // 32 + 48 → 80/88 = 0.91
    expect(f.state).toBe("close");
  });

  it("reports 'behind' when the projection is more than 10% short", () => {
    const f = computeForecast(richHistory, { ...base, current: 20, goal: 88 });
    expect(f.projected).toBe(68); // 68/88 = 0.77
    expect(f.state).toBe("behind");
    expect(f.requiredPerDay).toBeCloseTo((88 - 20) / 6, 6);
  });

  it("reports 'insufficient-history' when there aren't enough worked days", () => {
    const f = computeForecast(richHistory.slice(0, 3), {
      ...base,
      current: 20,
      goal: 88,
    });
    expect(f.avgPerDay).toBeNull();
    expect(f.projected).toBeNull();
    expect(f.state).toBe("insufficient-history");
  });

  it("honors a period_overrides end date when counting days remaining", () => {
    const overrides = { "custom-jun": { start: "2026-06-01", end: "2026-06-25" } };
    const range = getRangeForPeriodKey("custom-jun", 15, overrides);
    const f = computeForecast(richHistory, {
      today: "2026-06-22",
      periodEnd: range!.end, // 06-25
      current: 45,
      goal: 88,
    });
    // Mon–Fri after 06-22 through 06-25: 23,24,25 = 3
    expect(f.daysRemaining).toBe(3);
    expect(f.projected).toBe(69); // 45 + 8×3
  });

  it("infers the worked weekdays and exposes them sorted", () => {
    const f = computeForecast(richHistory, { ...base, current: 45, goal: 88 });
    expect(f.workedWeekdays).toEqual([1, 2, 3, 4, 5]);
  });
});
