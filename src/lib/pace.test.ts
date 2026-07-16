import { describe, it, expect } from "vitest";
import { minutesNowInTz, shiftPace } from "./pace";
import type { ShiftDef } from "./schedule";

// 8–5 with an hour break: 9h wall, 8h paid.
const SHIFT_8: ShiftDef = { start: "08:00", end: "17:00", breakMin: 60 };

function min(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

describe("shiftPace", () => {
  it("is 'before' with no pace until the shift starts", () => {
    expect(shiftPace(SHIFT_8, 2, min("06:30"))).toEqual({
      status: "before",
      pacePct: null,
      elapsedPaidHours: 0,
    });
    expect(shiftPace(SHIFT_8, 2, min("08:00")).status).toBe("before");
  });

  it("withholds pace under the 1-hour floor (the 7:05 AM guard)", () => {
    const pace = shiftPace(SHIFT_8, 2, min("08:30"));
    expect(pace.status).toBe("early");
    expect(pace.pacePct).toBeNull();
  });

  it("shows the LOF-and-rotate scenario as on pace, not a bad day", () => {
    // 2.0 flag by 10 AM: 2h wall elapsed ≈ 1.78 paid hours → ~112%, not 25%.
    const pace = shiftPace(SHIFT_8, 2, min("10:00"));
    expect(pace.status).toBe("live");
    expect(pace.elapsedPaidHours).toBeCloseTo((2 / 9) * 8, 5);
    expect(pace.pacePct).toBeCloseTo(112.5, 1);
  });

  it("smears the break: halfway through the wall day is half the paid hours", () => {
    const pace = shiftPace(SHIFT_8, 4, min("12:30")); // 4.5h wall of 9h
    expect(pace.elapsedPaidHours).toBeCloseTo(4, 5);
    expect(pace.pacePct).toBeCloseTo(100, 1);
  });

  it("uses the full paid day once the shift is over", () => {
    const done = shiftPace(SHIFT_8, 9, min("17:00"));
    expect(done.status).toBe("done");
    expect(done.elapsedPaidHours).toBe(8);
    expect(done.pacePct).toBeCloseTo(112.5, 1);
    expect(shiftPace(SHIFT_8, 9, min("21:15")).pacePct).toBeCloseTo(112.5, 1);
  });

  it("reports an honest 0% pace when nothing is flagged mid-shift", () => {
    const pace = shiftPace(SHIFT_8, 0, min("14:00"));
    expect(pace.status).toBe("live");
    expect(pace.pacePct).toBe(0);
  });

  it("never exceeds the paid hours as elapsed time", () => {
    const tenHour: ShiftDef = { start: "07:00", end: "18:00", breakMin: 60 };
    const done = shiftPace(tenHour, 10, min("23:59"));
    expect(done.elapsedPaidHours).toBe(10);
  });
});

describe("minutesNowInTz", () => {
  // Fixed instant: 2026-07-15T19:30:00Z.
  const instant = new Date(Date.UTC(2026, 6, 15, 19, 30));

  it("converts an instant into zone-local minutes", () => {
    // PDT is UTC-7 in July → 12:30.
    expect(minutesNowInTz("America/Los_Angeles", instant)).toBe(12 * 60 + 30);
    // UTC control.
    expect(minutesNowInTz("UTC", instant)).toBe(19 * 60 + 30);
  });

  it("falls back to device-local time with an empty tz", () => {
    const local = new Date(2026, 6, 15, 9, 45);
    expect(minutesNowInTz("", local)).toBe(9 * 60 + 45);
  });
});
