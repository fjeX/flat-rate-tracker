import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHIFT,
  emptyWeek,
  inferScheduleWeek,
  mondayOf,
  scheduleForDate,
  scheduledHoursFor,
  shiftForDate,
  shiftFromHours,
  shiftPaidHours,
  validateWeeks,
  weekIndexFor,
  type ScheduleWeek,
  type ShiftDef,
  type WorkSchedule,
} from "./schedule";

// ── Helpers ────────────────────────────────────────────────────────────────────

const SHIFT_8: ShiftDef = { start: "08:00", end: "17:00", breakMin: 60 }; // 8h paid
const SHIFT_10: ShiftDef = { start: "07:00", end: "18:00", breakMin: 60 }; // 10h paid

function week(days: Partial<ScheduleWeek>): ScheduleWeek {
  return { ...emptyWeek(), ...days };
}

const MON_FRI = week({
  mon: SHIFT_8,
  tue: SHIFT_8,
  wed: SHIFT_8,
  thu: SHIFT_8,
  fri: SHIFT_8,
});

function makeSchedule(over: Partial<WorkSchedule>): WorkSchedule {
  return {
    id: "s1",
    effectiveFrom: "2026-07-06", // a Monday
    rotationWeeks: 1,
    anchorMonday: "2026-07-06",
    weeks: [MON_FRI],
    createdAt: "2026-07-06T00:00:00Z",
    ...over,
  };
}

// ── shiftPaidHours ─────────────────────────────────────────────────────────────

describe("shiftPaidHours", () => {
  it("subtracts the unpaid break", () => {
    expect(shiftPaidHours(SHIFT_8)).toBe(8);
    expect(shiftPaidHours(SHIFT_10)).toBe(10);
  });

  it("handles no break and half-hour boundaries", () => {
    expect(shiftPaidHours({ start: "07:30", end: "16:00", breakMin: 0 })).toBe(8.5);
    expect(shiftPaidHours({ start: "08:00", end: "12:30", breakMin: 30 })).toBe(4);
  });
});

// ── mondayOf ───────────────────────────────────────────────────────────────────

describe("mondayOf", () => {
  it("is identity on a Monday", () => {
    expect(mondayOf("2026-07-06")).toBe("2026-07-06");
  });

  it("maps mid-week and Sunday back to the same Monday", () => {
    expect(mondayOf("2026-07-08")).toBe("2026-07-06"); // Wednesday
    expect(mondayOf("2026-07-12")).toBe("2026-07-06"); // Sunday ends the week
  });
});

// ── scheduleForDate (effective dating) ─────────────────────────────────────────

describe("scheduleForDate", () => {
  const v1 = makeSchedule({ id: "v1", effectiveFrom: "2026-07-06" });
  const v2 = makeSchedule({
    id: "v2",
    effectiveFrom: "2026-09-07",
    anchorMonday: "2026-09-07",
  });

  it("is null before the earliest schedule (forward-only)", () => {
    expect(scheduleForDate([v1, v2], "2026-07-05")).toBeNull();
  });

  it("picks the latest version at or before the date, in any input order", () => {
    expect(scheduleForDate([v2, v1], "2026-07-06")?.id).toBe("v1");
    expect(scheduleForDate([v2, v1], "2026-09-06")?.id).toBe("v1");
    expect(scheduleForDate([v1, v2], "2026-09-07")?.id).toBe("v2");
  });
});

// ── rotation ───────────────────────────────────────────────────────────────────

describe("weekIndexFor / rotation", () => {
  // Week A: Mon–Sat, Monday off; Week B: Mon–Fri, Saturday off — the
  // alternating-Saturday shop pattern.
  const weekA = week({
    tue: SHIFT_8,
    wed: SHIFT_8,
    thu: SHIFT_8,
    fri: SHIFT_8,
    sat: SHIFT_8,
  });
  const rotating = makeSchedule({
    rotationWeeks: 2,
    weeks: [weekA, MON_FRI],
  });

  it("alternates week parity from the anchor Monday", () => {
    expect(weekIndexFor(rotating, "2026-07-06")).toBe(0); // anchor week
    expect(weekIndexFor(rotating, "2026-07-12")).toBe(0); // Sunday, same week
    expect(weekIndexFor(rotating, "2026-07-13")).toBe(1); // next Monday
    expect(weekIndexFor(rotating, "2026-07-20")).toBe(0); // back to A
  });

  it("resolves the alternating Saturday/Monday correctly", () => {
    expect(shiftForDate([rotating], "2026-07-06")).toBeNull(); // week A Monday off
    expect(shiftForDate([rotating], "2026-07-11")).toEqual(SHIFT_8); // week A Saturday on
    expect(shiftForDate([rotating], "2026-07-13")).toEqual(SHIFT_8); // week B Monday on
    expect(shiftForDate([rotating], "2026-07-18")).toBeNull(); // week B Saturday off
  });

  it("keeps parity for dates far after the anchor", () => {
    // 2026-07-06 + 52 weeks = 2027-07-05, even number of weeks → week A.
    expect(weekIndexFor(rotating, "2027-07-05")).toBe(0);
    expect(weekIndexFor(rotating, "2027-07-12")).toBe(1);
  });

  it("is always week 0 for a 1-week schedule", () => {
    const single = makeSchedule({});
    expect(weekIndexFor(single, "2026-07-06")).toBe(0);
    expect(weekIndexFor(single, "2026-08-21")).toBe(0);
  });
});

// ── scheduledHoursFor (the efficiency fallback denominator) ────────────────────

describe("scheduledHoursFor", () => {
  const schedule = makeSchedule({});

  it("returns paid hours on a scheduled workday", () => {
    expect(scheduledHoursFor([schedule], "2026-07-08")).toBe(8); // Wednesday
  });

  it("returns null on off days and before the schedule exists", () => {
    expect(scheduledHoursFor([schedule], "2026-07-11")).toBeNull(); // Saturday
    expect(scheduledHoursFor([schedule], "2026-07-01")).toBeNull(); // pre-schedule
    expect(scheduledHoursFor([], "2026-07-08")).toBeNull(); // no schedule at all
  });

  it("uses the 10-hour shift for a 4×10 pattern", () => {
    const four10s = makeSchedule({
      weeks: [week({ mon: SHIFT_10, tue: SHIFT_10, wed: SHIFT_10, thu: SHIFT_10 })],
    });
    expect(scheduledHoursFor([four10s], "2026-07-09")).toBe(10); // Thursday
    expect(scheduledHoursFor([four10s], "2026-07-10")).toBeNull(); // Friday off
  });
});

// ── shift overrides ────────────────────────────────────────────────────────────

describe("shift overrides", () => {
  const schedule = makeSchedule({});

  it("beats the pattern on a scheduled day", () => {
    const long = { start: "08:00", end: "19:00", breakMin: 60 }; // stayed late: 10h
    expect(
      scheduledHoursFor([schedule], "2026-07-08", { "2026-07-08": long }),
    ).toBe(10);
  });

  it("turns a pattern-off day into a workday", () => {
    expect(
      scheduledHoursFor([schedule], "2026-07-11", { "2026-07-11": SHIFT_8 }),
    ).toBe(8); // Saturday, normally off
  });

  it("applies even before any schedule exists (explicit wins)", () => {
    expect(scheduledHoursFor([], "2026-07-08", { "2026-07-08": SHIFT_8 })).toBe(8);
  });

  it("leaves other days untouched", () => {
    expect(
      scheduledHoursFor([schedule], "2026-07-09", { "2026-07-08": SHIFT_8 }),
    ).toBe(8); // Thursday still from the pattern
  });
});

// ── shiftFromHours (hours-first editor) ────────────────────────────────────────

describe("shiftFromHours", () => {
  it("derives the end time from hours + start + lunch", () => {
    expect(shiftFromHours(8, "08:00", 60)).toEqual(SHIFT_8);
    expect(shiftFromHours(10, "07:00", 60)).toEqual(SHIFT_10);
    expect(shiftFromHours(7, "08:00", 0)).toEqual({
      start: "08:00",
      end: "15:00",
      breakMin: 0,
    });
  });

  it("round-trips through shiftPaidHours", () => {
    expect(shiftPaidHours(shiftFromHours(8.5, "07:30", 30)!)).toBe(8.5);
  });

  it("rejects invalid inputs", () => {
    expect(shiftFromHours(0, "08:00", 60)).toBeNull();
    expect(shiftFromHours(-2, "08:00", 60)).toBeNull();
    expect(shiftFromHours(8, "8:00", 60)).toBeNull(); // bad time format
    expect(shiftFromHours(8, "08:00", -15)).toBeNull();
    expect(shiftFromHours(18, "08:00", 60)).toBeNull(); // spills past midnight
  });
});

// ── validateWeeks ──────────────────────────────────────────────────────────────

describe("validateWeeks", () => {
  it("accepts a valid single week and a valid rotation", () => {
    expect(validateWeeks([MON_FRI], 1)).toBeNull();
    expect(validateWeeks([MON_FRI, MON_FRI], 2)).toBeNull();
  });

  it("rejects week count not matching the rotation", () => {
    expect(validateWeeks([MON_FRI], 2)).toMatch(/rotation week/);
  });

  it("rejects an all-off schedule", () => {
    expect(validateWeeks([emptyWeek()], 1)).toMatch(/at least one workday/);
  });

  it("rejects bad times, inverted shifts, and break >= shift", () => {
    expect(
      validateWeeks([week({ mon: { start: "8:00", end: "17:00", breakMin: 0 } })], 1),
    ).toMatch(/HH:MM/);
    expect(
      validateWeeks([week({ mon: { start: "17:00", end: "08:00", breakMin: 0 } })], 1),
    ).toMatch(/after shift start/);
    expect(
      validateWeeks([week({ mon: { start: "08:00", end: "09:00", breakMin: 60 } })], 1),
    ).toMatch(/whole shift/);
    expect(
      validateWeeks([week({ mon: { start: "08:00", end: "17:00", breakMin: -5 } })], 1),
    ).toMatch(/zero or more/);
  });
});

// ── inferScheduleWeek ──────────────────────────────────────────────────────────

describe("inferScheduleWeek", () => {
  // today = Wed 2026-07-15. Four trailing weeks of Mon–Fri logging including
  // the current week (dates >= today are generated but filtered internally).
  const today = "2026-07-15";
  const monFriDates: string[] = [];
  for (const monday of ["2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13"]) {
    const [y, m, d] = monday.split("-").map(Number);
    for (let i = 0; i < 5; i++) {
      const dt = new Date(Date.UTC(y, m - 1, d + i));
      monFriDates.push(dt.toISOString().slice(0, 10));
    }
  }

  it("infers Mon–Fri with default shifts from consistent history", () => {
    const inferred = inferScheduleWeek(monFriDates, today);
    expect(inferred).not.toBeNull();
    expect(inferred!.mon).toEqual(DEFAULT_SHIFT);
    expect(inferred!.fri).toEqual(DEFAULT_SHIFT);
    expect(inferred!.sat).toBeNull();
    expect(inferred!.sun).toBeNull();
  });

  it("tolerates one missed occurrence (3 of 4 rule)", () => {
    const oneMissedMonday = monFriDates.filter((d) => d !== "2026-06-22");
    expect(inferScheduleWeek(oneMissedMonday, today)!.mon).toEqual(DEFAULT_SHIFT);
  });

  it("drops a weekday logged only twice in four weeks", () => {
    const spottyMondays = monFriDates.filter(
      (d) => d !== "2026-06-22" && d !== "2026-07-06",
    );
    expect(inferScheduleWeek(spottyMondays, today)!.mon).toBeNull();
  });

  it("ignores today itself (the day isn't over)", () => {
    // Only 3 past Wednesdays logged +
    // today; today must not count as a 4th.
    const withToday = [...monFriDates, today];
    const withoutToday = monFriDates;
    expect(inferScheduleWeek(withToday, today)!.wed).toEqual(
      inferScheduleWeek(withoutToday, today)!.wed,
    );
  });

  it("returns null with no usable history", () => {
    expect(inferScheduleWeek([], today)).toBeNull();
    expect(inferScheduleWeek(["2026-07-14"], today)).toBeNull(); // one day ever
  });
});
