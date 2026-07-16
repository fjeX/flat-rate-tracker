import { describe, it, expect } from "vitest";
import {
  aggregateStats,
  aggregateStatsWithSchedule,
  computeEfficiency,
  efficiencyTier,
  fmtHours,
  fmtPct,
  type ScheduleContext,
} from "./stats";
import { emptyWeek, type ScheduleWeek, type WorkSchedule } from "./schedule";
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

// ── efficiencyTier ─────────────────────────────────────────────────────────────
// Takes the PERCENTAGE from computeEfficiency (e.g. 95), not a ratio (0.95).

describe("efficiencyTier", () => {
  it("returns null for null efficiency", () => {
    expect(efficiencyTier(null)).toBeNull();
  });

  it("tiers computeEfficiency output end to end", () => {
    expect(efficiencyTier(computeEfficiency(88, 80))).toBe("good"); // 110%
    expect(efficiencyTier(computeEfficiency(7, 8))).toBe("warn"); // 87.5%
    expect(efficiencyTier(computeEfficiency(4, 8))).toBe("bad"); // 50%
  });

  it("is good at and above 95", () => {
    expect(efficiencyTier(95)).toBe("good");
    expect(efficiencyTier(120)).toBe("good");
  });

  it("is warn from 80 up to 95", () => {
    expect(efficiencyTier(80)).toBe("warn");
    expect(efficiencyTier(94.9)).toBe("warn");
  });

  it("is bad below 80", () => {
    expect(efficiencyTier(79.9)).toBe("bad");
    expect(efficiencyTier(0)).toBe("bad");
  });
});

// ── aggregateStatsWithSchedule ─────────────────────────────────────────────────

describe("aggregateStatsWithSchedule", () => {
  // Mon–Fri, 8 paid hours a day, effective from Mon 2026-07-06.
  const SHIFT_8 = { start: "08:00", end: "17:00", breakMin: 60 };
  const MON_FRI: ScheduleWeek = {
    ...emptyWeek(),
    mon: SHIFT_8,
    tue: SHIFT_8,
    wed: SHIFT_8,
    thu: SHIFT_8,
    fri: SHIFT_8,
  };
  const SCHEDULE: WorkSchedule = {
    id: "s1",
    effectiveFrom: "2026-07-06",
    rotationWeeks: 1,
    anchorMonday: "2026-07-06",
    weeks: [MON_FRI],
    createdAt: "2026-07-06T00:00:00Z",
  };
  // Week Mon 07-06 .. Sun 07-12; "today" is Friday mid-shift.
  const range = { start: "2026-07-06", end: "2026-07-12" };
  const today = "2026-07-10";

  function ctx(over: Partial<ScheduleContext> = {}): ScheduleContext {
    return {
      schedules: [SCHEDULE],
      daysOff: [],
      confirmedZeroDays: [],
      today,
      ...over,
    };
  }

  it("uses scheduled hours as the denominator for days with ROs but no clock", () => {
    const entries = [
      makeEntry("2026-07-06", 9),
      makeEntry("2026-07-07", 7),
    ];
    const stats = aggregateStatsWithSchedule(entries, [], range, ctx());
    // 16 flag over 2 scheduled days × 8h = 100%
    expect(stats.denomHours).toBe(16);
    expect(stats.efficiency).toBe(100);
    expect(stats.denomSource).toBe("scheduled");
  });

  it("lets clocked hours beat the schedule on the same day", () => {
    const entries = [makeEntry("2026-07-06", 9)];
    const clocks = [makeClock("2026-07-06", 10)]; // stayed late: 10h, not 8h
    const stats = aggregateStatsWithSchedule(entries, clocks, range, ctx());
    expect(stats.denomHours).toBe(10);
    expect(stats.efficiency).toBe(90);
    expect(stats.denomSource).toBe("clocked");
  });

  it("mixes sources across days and reports mixed provenance", () => {
    const entries = [makeEntry("2026-07-06", 8), makeEntry("2026-07-07", 8)];
    const clocks = [makeClock("2026-07-06", 8)];
    const stats = aggregateStatsWithSchedule(entries, clocks, range, ctx());
    expect(stats.denomHours).toBe(16); // 8 clocked + 8 scheduled
    expect(stats.efficiency).toBe(100);
    expect(stats.denomSource).toBe("mixed");
  });

  it("gives today no schedule fallback mid-shift (the 10 AM problem)", () => {
    // One easy RO logged this morning; without the guard this would read
    // 2/8 = 25% and tank the week.
    const entries = [
      makeEntry("2026-07-06", 8),
      makeEntry(today, 2),
    ];
    const stats = aggregateStatsWithSchedule(entries, [], range, ctx());
    expect(stats.denomHours).toBe(8); // Monday only
    expect(stats.efficiency).toBe(100);
    // Today's flag still shows in the raw totals, just not in efficiency.
    expect(stats.flagHours).toBe(10);
  });

  it("counts today when clocked hours are explicitly entered", () => {
    const entries = [makeEntry(today, 9)];
    const clocks = [makeClock(today, 8)];
    const stats = aggregateStatsWithSchedule(entries, clocks, range, ctx());
    expect(stats.denomHours).toBe(8);
    expect(stats.efficiency).toBeCloseTo(112.5, 1);
  });

  it("holds out an empty completed scheduled day and reports it unresolved", () => {
    // Mon logged; Tue/Wed/Thu silent workdays; Fri is today.
    const entries = [makeEntry("2026-07-06", 8)];
    const stats = aggregateStatsWithSchedule(entries, [], range, ctx());
    expect(stats.unresolvedDays).toEqual(["2026-07-07", "2026-07-08", "2026-07-09"]);
    expect(stats.denomHours).toBe(8); // held-out days contribute nothing yet
    expect(stats.efficiency).toBe(100);
  });

  it("excludes a resolved day off, counts a confirmed zero day", () => {
    const entries = [makeEntry("2026-07-06", 8)];
    const stats = aggregateStatsWithSchedule(entries, [], range, ctx({
      daysOff: [{ startDate: "2026-07-07", endDate: "2026-07-08" }],
      confirmedZeroDays: ["2026-07-09"],
    }));
    expect(stats.unresolvedDays).toEqual([]);
    // Mon 8h + confirmed-zero Thu 8h; flag only from Mon.
    expect(stats.denomHours).toBe(16);
    expect(stats.efficiency).toBe(50);
  });

  it("pairs numerator and denominator: unscheduled work without a clock is excluded", () => {
    // Came in on an off-Saturday, no clock entry — no honest denominator, so
    // that flag can't inflate efficiency (totals still show it).
    const entries = [makeEntry("2026-07-06", 8), makeEntry("2026-07-11", 5)];
    const stats = aggregateStatsWithSchedule(entries, [], range, ctx());
    expect(stats.efficiency).toBe(100);
    expect(stats.flagHours).toBe(13);
  });

  it("applies no fallback before the schedule's effective date", () => {
    const earlier = { start: "2026-06-29", end: "2026-07-05" };
    const entries = [makeEntry("2026-06-30", 8)];
    const stats = aggregateStatsWithSchedule(entries, [], earlier, ctx());
    expect(stats.efficiency).toBeNull();
    expect(stats.denomSource).toBeNull();
    expect(stats.unresolvedDays).toEqual([]);
  });

  it("keeps clocked-only behaviour identical to aggregateStats", () => {
    const entries = [makeEntry("2026-07-06", 9), makeEntry("2026-07-07", 7)];
    const clocks = [makeClock("2026-07-06", 8), makeClock("2026-07-07", 8)];
    const withSchedule = aggregateStatsWithSchedule(entries, clocks, range, ctx());
    const plain = aggregateStats(entries, clocks, range);
    expect(withSchedule.efficiency).toBe(plain.efficiency);
    expect(withSchedule.denomSource).toBe("clocked");
  });
});
